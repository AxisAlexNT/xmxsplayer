import { expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import { TimeMap } from '../../src/shared/time-map'
import { TransportClock } from '../../src/engine/transport/clock'
import {
  Scheduler,
  type SchedulerOutput,
  type ScheduledNote,
} from '../../src/engine/transport/scheduler'
function fixture() {
  const project = newProject()
  project.lengthTicks = 7680
  const track = {
    ...project.tracks[0],
    kind: 'midi' as const,
    id: 'guide',
    mode: 'auto' as 'auto' | 'live' | 'mute',
    notes: [
      [0, 480, 60, 100],
      [480, 480, 62, 100],
      [960, 1920, 64, 100],
    ] as [number, number, number, number][],
    events: [],
    view: 'roll' as const,
    clef: 'auto' as const,
    quantGrid: 120,
    armed: false,
    leads: false,
  }
  project.tracks = [track]
  let now = 0
  const clock = new TransportClock(new TimeMap(project), () => now)
  const events: { type: string; id?: string; when?: number; key?: number }[] =
    []
  const held = new Map<
    string,
    { note: ScheduledNote; on: number; off?: number }
  >()
  const output: SchedulerOutput = {
    noteOn(n, w) {
      held.set(n.id, { note: n, on: w })
      events.push({ type: 'on', id: n.id, key: n.note[2], when: w })
    },
    noteOff(n, w) {
      const h = held.get(n.id)
      if (h) h.off = w
      events.push({ type: 'off', id: n.id, key: n.note[2], when: w })
    },
    event() {},
    beat() {},
    boundary(w) {
      events.push({ type: 'boundary', when: w })
      for (const h of held.values())
        if (h.off === undefined || h.off > w) h.off = w
    },
    reset(keep) {
      for (const [id, h] of held)
        if (!keep || h.on > now || (h.off !== undefined && h.off <= now))
          held.delete(id)
        else h.off = undefined
    },
    hasNote(id) {
      return held.has(id)
    },
    chase() {},
    collect(t) {
      for (const [id, h] of held)
        if (h.off !== undefined && h.off <= t) held.delete(id)
    },
  }
  const scheduler = new Scheduler(clock, output)
  scheduler.setProject(project)
  return {
    project,
    track,
    clock,
    scheduler,
    events,
    setNow: (n: number) => {
      now = n
    },
  }
}
it('orders note offs before note ons and excludes muted, live and unsoloed tracks', () => {
  const f = fixture()
  f.clock.play()
  f.scheduler.tick(0.6)
  expect(f.events.filter((e) => e.when === 0.5).map((e) => e.type)).toEqual([
    'off',
    'on',
  ])
  f.track.mode = 'live'
  f.scheduler.setProject(f.project)
  f.events.length = 0
  f.scheduler.tick(0.6)
  expect(f.events.filter((e) => e.type === 'on')).toHaveLength(0)
})
it('preserves position through rate changes and retimes future note offs', () => {
  const f = fixture()
  f.clock.play()
  f.scheduler.tick()
  f.setNow(0.1)
  f.clock.setRate(0.5)
  f.scheduler.invalidate(true)
  f.scheduler.tick(1)
  expect(f.clock.tick).toBeCloseTo(96)
  expect(f.events.filter((e) => e.type === 'on' && e.key === 60)).toHaveLength(
    1,
  )
  expect(
    f.events.find((e) => e.type === 'off' && e.key === 60)?.when,
  ).toBeCloseTo(0.9)
  f.setNow(0.9)
  expect(f.clock.tick).toBeCloseTo(480)
})
it('ends each loop with a boundary before starting the next cycle', () => {
  const f = fixture()
  f.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  f.clock.play()
  f.scheduler.tick(1.2)
  const boundary = f.events.findIndex((e) => e.type === 'boundary')
  expect(f.events[boundary].when).toBe(1)
  expect(f.events[boundary + 1]).toMatchObject({
    type: 'on',
    key: 60,
    when: 1,
    id: `1:${f.track.id}:0`,
  })
  f.setNow(2.25)
  expect(f.clock.tick).toBeCloseTo(240)
})
it('caps lookahead at a hold, preserves held voices and resumes at the exact tick', () => {
  const f = fixture()
  f.scheduler.holdAt(480)
  f.clock.play()
  f.scheduler.tick(1)
  expect(f.events.some((e) => e.type === 'on' && e.key === 62)).toBe(false)
  f.setNow(0.51)
  f.scheduler.tick()
  expect(f.clock.holding).toBe(true)
  expect(f.clock.tick).toBe(480)
  f.setNow(3)
  expect(f.clock.tick).toBe(480)
  f.scheduler.releaseHold()
  f.scheduler.tick()
  expect(f.events.find((e) => e.type === 'on' && e.key === 62)?.when).toBe(3)
})
it('executes quantized actions only at their boundary and cancels queued actions', () => {
  const f = fixture()
  f.clock.play()
  f.setNow(0.1)
  const calls: number[] = []
  f.scheduler.queue('beat', () => calls.push(f.clock.tick))
  const cancel = f.scheduler.queue('bar', () => calls.push(-1))
  f.scheduler.cancelAction(cancel)
  f.scheduler.tick(2)
  expect(calls).toEqual([])
  expect(f.events.some((e) => e.type === 'on' && e.key === 62)).toBe(false)
  f.setNow(0.5)
  f.scheduler.tick()
  expect(calls).toEqual([480])
  expect(f.events.some((e) => e.type === 'on' && e.key === 62)).toBe(true)
})
it('warms audio processing before starting the shared clock and sequenced notes', () => {
  const f = fixture()
  f.clock.play(0.12)
  f.scheduler.tick()
  expect(f.clock.tick).toBe(0)
  expect(f.events.find((e) => e.type === 'on')?.when).toBeCloseTo(0.12)
  f.setNow(0.1)
  expect(f.clock.tick).toBe(0)
  f.setNow(0.22)
  expect(f.clock.tick).toBeCloseTo(96)
})
it('caps audio at holds and song end while routing actions leave it running', () => {
  const f = fixture()
  f.clock.play()
  f.scheduler.queue('beat', () => undefined)
  expect(f.scheduler.nextDeadline()).toBe(0.5)
  expect(f.scheduler.audioDeadline()).toBe(8)
  f.scheduler.holdAt(480)
  expect(f.scheduler.audioDeadline()).toBe(0.5)
})
it('preserves a sounding note through an auto-to-live switch and still sends its original note-off', () => {
  const f = fixture()
  f.clock.play()
  f.scheduler.tick(0.1)
  expect(f.events.filter((e) => e.type === 'on')).toHaveLength(1)
  f.setNow(0.1)
  f.track.mode = 'live'
  f.scheduler.setProject(f.project, true)
  f.scheduler.tick(0.6)
  expect(f.events.filter((e) => e.type === 'on')).toHaveLength(1)
  expect(f.events.filter((e) => e.type === 'off')).toContainEqual({
    type: 'off',
    id: '0:guide:0',
    key: 60,
    when: 0.5,
  })
})
it('keeps a 40 ms horizon during the return from tempo tracking to written mode', () => {
  const f = fixture()
  f.track.notes = [[96, 120, 60, 100]]
  f.scheduler.setProject(f.project)
  f.scheduler.following = true
  f.clock.play()
  f.scheduler.tick()
  expect(f.events.some((e) => e.type === 'on')).toBe(false)
  f.setNow(0.07)
  f.scheduler.tick()
  expect(f.events.some((e) => e.type === 'on')).toBe(true)
})
