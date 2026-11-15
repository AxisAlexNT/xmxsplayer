import { afterEach, expect, it, vi } from 'vitest'
import { Activity } from '../../src/engine/performance/activity'
import { activitySource, type ActivityState } from '../../src/shared/activity'
afterEach(() => vi.useRealTimers())
it('throttles reports, retains short note flashes and suppresses cancelled future events', () => {
  vi.useFakeTimers()
  let now = 0
  const frames: { state: ActivityState; time: number }[] = []
  const activity = new Activity(
    () => now,
    () => [],
    (state) => frames.push({ state, time: now }),
  )
  activity.start()
  const step = (ms: number): void => {
    for (let i = 0; i < ms; i++) {
      now++
      vi.advanceTimersByTime(1)
    }
  }
  activity.pulse(
    { sourceId: 'sequencer', trackId: 'lead', instrumentId: 'horn' },
    200,
    'sequencer',
  )
  step(140)
  expect(frames).toHaveLength(1)
  activity.cancel('sequencer', true)
  step(140)
  expect(frames).toHaveLength(1)
  activity.pulse({
    sourceId: 'screen',
    trackId: 'piano',
    instrumentId: 'piano',
  })
  step(70)
  expect(frames.at(-1)!.state.trackIds).toEqual(['piano'])
  step(140)
  expect(frames.at(-1)!.state.trackIds).toEqual([])
  expect(
    frames
      .slice(1)
      .every((frame, index) => frame.time - frames[index].time >= 70),
  ).toBe(true)
  activity.close()
  expect(vi.getTimerCount()).toBe(0)
})
it('keeps held routes lit past the flash window and republishes after reconnection', () => {
  let now = 0,
    held = true
  const frames: ActivityState[] = []
  const route = {
    sourceId: 'keys:controller',
    zoneId: 'lh',
    trackId: 'piano',
    instrumentId: 'piano',
  }
  const activity = new Activity(
    () => now,
    () => (held ? [route, route] : []),
    (state) => frames.push(state),
  )
  activity.tick()
  now = 1000
  activity.tick()
  expect(frames).toHaveLength(1)
  expect(frames[0].routes).toHaveLength(1)
  activity.invalidate()
  activity.tick()
  expect(frames).toHaveLength(2)
  held = false
  now += 70
  activity.tick()
  expect(frames.at(-1)!.instrumentIds).toEqual([])
})
it('normalizes controller, keyboard, cue and audition source identities', () => {
  expect(activitySource('binding:["keylab","pad.2"]')).toBe(
    'control:["keylab","pad.2"]',
  )
  expect(activitySource('pointer-3')).toBe('screen')
  expect(activitySource('cue-note:4')).toBe('cues')
  expect(activitySource('roll-piano')).toBe('audition')
  expect(activitySource('keylab')).toBe('keys:keylab')
})
