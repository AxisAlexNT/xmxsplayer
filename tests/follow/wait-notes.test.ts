import { expect, it, vi } from 'vitest'
import { expectedOnsets } from '../../src/shared/expected-onsets'
import { WaitNotes } from '../../src/engine/follow/wait-notes'
import { TransportClock } from '../../src/engine/transport/clock'
import { TimeMap } from '../../src/shared/time-map'
import { liveProject } from '../../src/shared/template'
import type { RoutedNote } from '../../src/shared/recording'
function rig(strictness: 'any' | 'all' = 'any') {
  let now = 0
  const project = liveProject('Follow'),
    track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  track.leads = true
  track.mode = 'live'
  track.notes = [
    [480, 120, 60, 100],
    [500, 120, 64, 100],
    [960, 120, 67, 100],
  ]
  project.follow.mode = 'waitNotes'
  project.follow.strictness = strictness
  project.tempos = [{ tick: 0, bpm: 120 }]
  const clock = new TransportClock(new TimeMap(project), () => now),
    changed = vi.fn(),
    wait = new WaitNotes({ clock, changed, invalidate: vi.fn() })
  wait.configure(project)
  clock.play()
  const press = (
    key: number,
    id = String(key),
    on = true,
    trackId = track.id,
  ) =>
    wait.note({
      id,
      key,
      on,
      trackId,
      source: 'keyboard',
      channel: 0,
      velocity: on ? 100 : 0,
      when: now,
    } as RoutedNote)
  const arrive = () => {
    const next = wait.next()!
    now = clock.contextAt(next.raw)
    if (next.hold) clock.hold(next.raw)
    next.run()
  }
  return {
    project,
    clock,
    wait,
    press,
    arrive,
    time: (value: number) => {
      now = value
    },
  }
}
it('groups only live lead tracks within 30 ticks of the first onset without mutating notes', () => {
  const r = rig(),
    track = r.project.tracks[0]
  if (track.kind !== 'midi') throw Error('MIDI')
  track.notes.push([530, 100, 65, 90])
  const before = JSON.stringify(track.notes)
  const onsets = expectedOnsets(r.project)
  expect(onsets.map((o) => [o.tick, o.keys])).toEqual([
    [480, [60, 64]],
    [530, [65]],
    [960, [67]],
  ])
  expect(JSON.stringify(track.notes)).toBe(before)
  track.mode = 'auto'
  expect(expectedOnsets(r.project)).toEqual([])
})
it('holds for any expected note, ignores wrong pitches and other tracks, and advances on a match', () => {
  const r = rig()
  r.arrive()
  expect(r.clock.holding).toBe(true)
  r.press(61)
  r.press(60, 'other', true, 'unrelated')
  expect(r.wait.holding).toBe(true)
  r.press(64)
  expect(r.clock.holding).toBe(false)
  expect(r.wait.expected?.tick).toBe(960)
})
it('requires the whole chord down inside the configured window and accepts re-pressed keys', () => {
  const r = rig('all')
  r.arrive()
  r.press(60)
  r.time(0.7)
  r.press(64)
  expect(r.wait.holding).toBe(true)
  r.press(60, '60', false)
  r.time(0.72)
  r.press(60)
  expect(r.wait.holding).toBe(false)
})
it('counts early completed chords but ignores notes older than the early window', () => {
  const r = rig('all')
  r.time(0.1)
  r.press(60)
  r.time(0.35)
  r.press(64)
  expect(r.wait.next()?.hold).toBe(true)
  r.time(0.36)
  r.press(60)
  r.press(60, '60', false)
  r.press(64, '64', false)
  expect(r.wait.next()?.hold).toBe(false)
  r.arrive()
  expect(r.clock.holding).toBe(false)
})
it('skips only its own hold, re-arms after seeking and revisits onsets in loops', () => {
  const r = rig()
  expect(r.wait.skip()).toBe(false)
  r.arrive()
  expect(r.wait.skip()).toBe(true)
  expect(r.wait.expected?.tick).toBe(960)
  r.clock.seek(0)
  r.wait.reset()
  expect(r.wait.expected?.tick).toBe(480)
  r.clock.setLoop({ enabled: true, startTick: 480, endTick: 960 })
  r.wait.reset()
  r.arrive()
  r.press(60)
  expect(r.wait.next()?.raw).toBeCloseTo(1)
})
it('does not release a separate cue hold from an early melody note or a disabled follower', () => {
  const r = rig()
  const boundary = r.wait.next()!
  r.time(0.5)
  r.clock.hold(boundary.raw)
  r.press(60)
  expect(r.clock.holding).toBe(true)
  expect(r.wait.skip()).toBe(false)
  r.project.follow.mode = 'written'
  r.wait.configure(r.project)
  expect(r.clock.holding).toBe(true)
})
it('wraps a held loop boundary despite sub-nanosecond rounding', () => {
  const r = rig()
  r.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  expect(r.clock.songAt(1 - 1e-12)).toBe(0)
  expect(r.clock.songAt(2 - 1e-12)).toBe(0)
  r.clock.hold(1 - 1e-12)
  expect(r.clock.raw).toBe(1)
  expect(r.clock.tick).toBe(0)
})

it('rechecks early eligibility when a speed change moves the onset later', () => {
  const r = rig()
  r.time(0.35)
  r.press(60)
  expect(r.wait.next()?.hold).toBe(false)
  r.clock.setRate(0.25)
  expect(r.wait.next()?.hold).toBe(true)
})
it('requires simultaneous down keys for an incomplete chord', () => {
  const r = rig('all')
  r.arrive()
  r.press(60)
  r.press(60, '60', false)
  r.press(64)
  expect(r.wait.holding).toBe(true)
  r.press(60)
  expect(r.wait.holding).toBe(false)
})
