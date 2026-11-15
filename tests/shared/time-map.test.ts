import { expect, it } from 'vitest'
import { TimeMap, anchorTempos } from '../../src/shared/time-map'
import { newProject } from '../../src/shared/defaults'
it('converts ticks and seconds across tempo changes in both directions', () => {
  const project = newProject()
  project.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 1920, bpm: 60 },
    { tick: 2880, bpm: 180 },
  ]
  const map = new TimeMap(project)
  expect(map.tickToSec(1920)).toBe(2)
  expect(map.tickToSec(2880)).toBe(4)
  expect(map.tickToSec(4320)).toBe(5)
  for (let tick = 0; tick <= 10000; tick += 17)
    expect(map.secToTick(map.tickToSec(tick))).toBeCloseTo(tick, 8)
})
it('uses denominator-aware bars, beats and partial bars at a signature change', () => {
  const project = newProject()
  project.timeSigs = [
    { tick: 0, num: 4, den: 4 },
    { tick: 1440, num: 6, den: 8 },
    { tick: 4320, num: 3, den: 4 },
  ]
  const map = new TimeMap(project)
  expect(map.barToTick(2)).toBe(1440)
  expect(map.barToTick(3)).toBe(2880)
  expect(map.barToTick(4)).toBe(4320)
  expect(map.tickToBarBeat(1920)).toMatchObject({
    bar: 2,
    beat: 3,
    sixteenth: 1,
    num: 6,
    den: 8,
  })
  expect(map.measures(0, 5000).map((m) => [m.bar, m.start, m.end])).toEqual([
    [1, 0, 1440],
    [2, 1440, 2880],
    [3, 2880, 4320],
    [4, 4320, 5760],
  ])
  expect(map.nextBeat(1400)).toBe(1440)
  expect(map.nextBeat(1440)).toBe(1680)
  expect(map.nextBeat(1440, true)).toBe(1440)
})
it('derives piecewise tempos from beat anchors only while maps are editable', () => {
  const project = newProject()
  project.beatAnchors = [
    { tick: 0, sec: 10 },
    { tick: 480, sec: 11 },
    { tick: 960, sec: 11.5 },
  ]
  expect(anchorTempos(project.beatAnchors)).toEqual([
    { tick: 0, bpm: 60 },
    { tick: 480, bpm: 120 },
  ])
  expect(new TimeMap(project).tickToSec(960)).toBe(1.5)
  project.mapOwner = 'score'
  expect(new TimeMap(project).tickToSec(960)).toBe(1)
  expect(() =>
    anchorTempos([
      { tick: 0, sec: 0 },
      { tick: 480, sec: 0 },
    ]),
  ).toThrow('advance')
})
