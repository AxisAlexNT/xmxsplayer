import { expect, it } from 'vitest'
import type { Action, Cue } from '../../src/shared/model'
import { liveProject } from '../../src/shared/template'
import { TimeMap } from '../../src/shared/time-map'
import { TransportClock } from '../../src/engine/transport/clock'
import {
  Scheduler,
  type SchedulerOutput,
} from '../../src/engine/transport/scheduler'
import { Cues } from '../../src/engine/performance/cues'
function fixture(list: Cue[], handler?: (action: Action, cues: Cues) => void) {
  const project = liveProject('Cues'),
    actions: Action[] = [],
    notes: { key: number; when: number }[] = []
  const track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  track.mode = 'auto'
  track.notes = [
    [480, 480, 60, 100],
    [960, 480, 62, 100],
  ]
  let now = 0
  const clock = new TransportClock(new TimeMap(project), () => now)
  const output: SchedulerOutput = {
    noteOn(note, when) {
      notes.push({ key: note.note[2], when })
    },
    noteOff() {},
    event() {},
    beat() {},
    boundary() {},
    reset() {},
    hasNote: () => false,
    chase() {},
    collect() {},
  }
  const scheduler = new Scheduler(clock, output)
  scheduler.setProject(project)
  const cues = new Cues({
    clock,
    queue: (at, run) => scheduler.queue(at, run),
    cancel: (id) => scheduler.cancelAction(id),
    isQueued: (id) => scheduler.isQueued(id),
    run(action) {
      actions.push(action)
      handler?.(action, cues)
    },
    invalidate: () => scheduler.invalidate(true),
    changed() {},
    seek(tick) {
      clock.seek(tick)
      cues.seek()
    },
  })
  scheduler.timeline = cues
  cues.configure(list)
  return {
    project,
    clock,
    scheduler,
    cues,
    actions,
    notes,
    setNow(value: number) {
      now = value
    },
  }
}
const cue = (
  id: string,
  tick: number,
  trigger: Cue['trigger'] = 'auto',
): Cue => ({
  id,
  tick,
  name: id,
  trigger,
  actions: [{ type: 'scene', cmd: 'activate', sceneId: id }],
})
it('clamps note lookahead at automatic cue boundaries and fires in chronological order after a late tick', () => {
  const f = fixture([cue('one', 480), cue('two', 960)])
  f.clock.play()
  f.scheduler.tick(2)
  expect(f.notes).toHaveLength(0)
  expect(f.actions).toHaveLength(0)
  f.setNow(1.1)
  f.scheduler.tick()
  expect(f.actions).toEqual([
    cue('one', 480).actions[0],
    cue('two', 960).actions[0],
  ])
  f.scheduler.tick()
  expect(f.actions).toHaveLength(2)
})
it('arms only at its tick, consumes only its matching press and expires at the next cue', () => {
  const first = { ...cue('armed', 480, 'armed'), control: 'pad.2' }
  const f = fixture([first, cue('next', 960, 'armed')])
  f.clock.play()
  f.scheduler.tick(2)
  expect(f.cues.control('pad.2', true)).toBe(false)
  f.setNow(0.5)
  f.scheduler.tick()
  expect(f.cues.armedId).toBe('armed')
  expect(f.cues.control('pad.1', true)).toBe(false)
  expect(f.cues.control('pad.2', false)).toBe(false)
  expect(f.cues.control('pad.2', true)).toBe(true)
  expect(f.actions).toEqual(first.actions)
  expect(f.cues.armedId).toBeNull()
  f.setNow(1)
  f.scheduler.tick()
  expect(f.cues.armedId).toBe('next')
})
it('holds exactly at a wait marker and caps audio there, then releases only on the specified control', () => {
  const f = fixture([{ ...cue('wait', 480, 'wait'), control: 'pad.2' }])
  f.clock.play()
  f.scheduler.tick(2)
  expect(f.scheduler.audioDeadline()).toBe(0.5)
  expect(f.notes).toHaveLength(0)
  f.setNow(0.6)
  f.scheduler.tick()
  expect(f.clock.holding).toBe(true)
  expect(f.clock.tick).toBe(480)
  expect(f.cues.key(true)).toBe(false)
  expect(f.cues.control('pad.1', true)).toBe(false)
  f.setNow(2)
  expect(f.clock.tick).toBe(480)
  expect(f.cues.control('pad.2', true)).toBe(true)
  expect(f.clock.holding).toBe(false)
  f.scheduler.tick()
  expect(f.actions).toEqual(cue('wait', 480).actions)
  expect(f.notes[0]).toEqual({ key: 60, when: 2 })
})
it('releases an unassigned wait cue on a live-zone key or skip, with quantized actions queued after release', () => {
  const f = fixture([{ ...cue('wait', 480, 'wait'), at: 'bar' }])
  f.clock.play()
  f.setNow(0.5)
  f.scheduler.tick()
  expect(f.cues.key(false)).toBe(false)
  expect(f.cues.key(true)).toBe(true)
  expect(f.clock.holding).toBe(false)
  expect(f.actions).toHaveLength(0)
  expect(f.cues.queuedIds).toEqual(['wait'])
  expect(f.cues.pendingActions[0].tick).toBe(1920)
  f.setNow(2)
  f.scheduler.tick()
  expect(f.actions).toHaveLength(1)
  expect(f.cues.queuedIds).toEqual([])
  f.clock.seek(0)
  f.cues.seek()
  f.setNow(2.5)
  f.scheduler.tick()
  expect(f.cues.skip()).toBe(true)
})
it('re-arms looped markers once per cycle and processes cues at the same position in stable order', () => {
  const f = fixture([cue('b', 480), cue('a', 480)])
  f.clock.setLoop({ enabled: true, startTick: 0, endTick: 1920 })
  f.cues.configure([cue('b', 480), cue('a', 480)])
  f.clock.play()
  f.setNow(0.5)
  f.scheduler.tick()
  expect(f.actions.map((a) => (a.type === 'scene' ? a.sceneId : ''))).toEqual([
    'a',
    'b',
  ])
  f.setNow(2.5)
  f.scheduler.tick()
  expect(f.actions.map((a) => (a.type === 'scene' ? a.sceneId : ''))).toEqual([
    'a',
    'b',
    'a',
    'b',
  ])
})
it('chases the last scene-affecting cue on seek without replaying notes, and can disable chasing', () => {
  const f = fixture([
    {
      ...cue('scene', 480),
      actions: [
        ...cue('scene', 480).actions,
        { type: 'register', cmd: 'set', index: 1, on: true },
        { type: 'note', trackId: 'piano', key: 38, velocity: 100 },
      ],
    },
    cue('later', 1920),
  ])
  f.clock.seek(1000)
  f.cues.seek()
  expect(f.actions.map((a) => a.type)).toEqual(['scene', 'register'])
  f.cues.chaseOnSeek = false
  f.clock.seek(3000)
  f.cues.seek()
  expect(f.actions).toHaveLength(2)
  expect(f.cues.armedId).toBeNull()
})
it('does not delay automatic actions at an exact quantized boundary and ignores missing cue ids', () => {
  const f = fixture([{ ...cue('exact', 1920), at: 'bar' }])
  f.clock.play()
  f.setNow(2)
  f.scheduler.tick()
  expect(f.actions).toHaveLength(1)
  expect(() => f.cues.fire('missing')).not.toThrow()
})
it('cancels pending cue actions on seek and releases a held marker removed by a live edit', () => {
  const f = fixture([
    { ...cue('armed', 480, 'armed'), at: 'bar', control: 'pad.2' },
  ])
  f.clock.play()
  f.setNow(0.5)
  f.scheduler.tick()
  f.cues.control('pad.2', true)
  expect(f.cues.queuedIds).toEqual(['armed'])
  f.cues.chaseOnSeek = false
  f.clock.seek(0)
  f.cues.seek()
  expect(f.cues.queuedIds).toEqual([])
  f.cues.configure([cue('wait', 480, 'wait')])
  f.setNow(1)
  f.scheduler.tick()
  expect(f.clock.holding).toBe(true)
  f.cues.configure([])
  expect(f.clock.holding).toBe(false)
  expect(f.cues.armedId).toBeNull()
})
it('waits for the clock lead-in before executing a cue at tick zero', () => {
  const f = fixture([cue('start', 0)])
  f.clock.play(1)
  f.scheduler.tick()
  expect(f.actions).toHaveLength(0)
  expect(f.scheduler.nextDeadline()).toBe(1)
  f.setNow(1)
  f.scheduler.tick()
  expect(f.actions).toHaveLength(1)
})
it('re-enters a wait marker when paused there and restarts cue occurrences after changing the loop epoch', () => {
  const f = fixture([cue('wait', 480, 'wait')])
  f.clock.play()
  f.setNow(0.5)
  f.scheduler.tick()
  f.clock.pause()
  f.cues.pause()
  expect(f.cues.holding).toBe(false)
  f.clock.play()
  f.scheduler.tick()
  expect(f.cues.holding).toBe(true)
  f.cues.skip()
  f.clock.setLoop({ enabled: true, startTick: 0, endTick: 1920 })
  f.cues.configure([cue('wait', 480, 'wait')])
  f.scheduler.tick()
  expect(f.cues.holding).toBe(true)
})
it('blocks recursive cue firing and isolates one failing action from later actions', () => {
  const f = fixture(
    [
      {
        ...cue('recursive', 0),
        actions: [
          { type: 'cue', cmd: 'fire', cueId: 'recursive' },
          { type: 'app', cmd: 'undo' },
          { type: 'register', cmd: 'set', index: 0, on: true },
        ],
      },
    ],
    (action, cues) => {
      if (action.type === 'cue') cues.fire(action.cueId)
      if (action.type === 'app') throw Error('Action failed')
    },
  )
  f.clock.play()
  f.scheduler.tick()
  expect(f.actions.map((a) => a.type)).toEqual(['cue', 'app', 'register'])
})
