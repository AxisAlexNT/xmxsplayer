import { expect, it } from 'vitest'
import {
  clipRate,
  clipTone,
  tempoDeadlines,
} from '../../src/engine/clips/timing'
import { TimeMap } from '../../src/shared/time-map'
import { newProject } from '../../src/shared/defaults'
import { TransportClock } from '../../src/engine/transport/clock'
import { clip } from './fixture'
it('converts fragment duration to quarter-beat sync rate at tempo, speed and follower changes', () => {
  expect(clipRate(8, 16, 120, 1)).toBe(1)
  expect(clipRate(8, 16, 150, 0.6)).toBeCloseTo(0.75)
  expect(clipRate(8, 16, 120, 0.6 * 1.2)).toBeCloseTo(0.72)
  expect(() => clipRate(8, 0, 120, 1)).toThrow('positive')
  const clock = new TransportClock(new TimeMap(newProject()), () => 0)
  expect(
    clipTone(
      clip('tape', { sync: false, pitchMode: 'tape', semitones: 12 }),
      2,
      clock,
    ),
  ).toMatchObject({ rate: 2, semitones: 0 })
  expect(
    clipTone(clip('pressure', { pressureToGain: true }), 2, clock, 0, 0.8, 0.5)
      .gain,
  ).toBeCloseTo(0.4)
})
it('finds tempo steps and loop wraps ahead of playback, including a speed change', () => {
  let now = 0
  const project = newProject()
  project.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 1920, bpm: 180 },
  ]
  const clock = new TransportClock(new TimeMap(project), () => now)
  clock.play()
  now = 1.9
  expect(tempoDeadlines(clock)).toEqual([2])
  expect(clipTone(clip(), 2, clock, 0, 1, 1, 2).rate).toBeCloseTo(1.5)
  clock.setRate(0.5)
  expect(tempoDeadlines(clock)[0]).toBeCloseTo(2.1)
  clock.setLoop({ enabled: true, startTick: 0, endTick: 1920 })
  expect(tempoDeadlines(clock)[0]).toBeCloseTo(2.1)
  expect(clipTone(clip(), 2, clock, 0, 1, 1, 2.1).rate).toBeCloseTo(0.5)
})
