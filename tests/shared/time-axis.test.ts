import { expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import { TimeMap } from '../../src/shared/time-map'
import { LinearAxis } from '../../src/ui/timeline/linear-axis'
import { Viewport, transportTick } from '../../src/ui/timeline/viewport'
it('fits whole measures and round trips every page including signature changes', () => {
  const p = newProject()
  p.lengthTicks = 16000
  p.timeSigs.push({ tick: 7680, num: 3, den: 4 })
  const axis = new LinearAxis(new TimeMap(p), 1296, 75)
  expect(axis.pageRange(0)).toEqual([0, 7680])
  expect(axis.pageOfTick(7680)).toBe(1)
  expect(axis.xInPage(0)).toBe(96)
  for (let page = 0; page < axis.pageCount; page++) {
    const [a, b] = axis.pageRange(page)
    for (let tick = a; tick < b; tick += 73)
      expect(axis.tickAt(page, axis.xInPage(tick, page))).toBeCloseTo(tick, 7)
  }
  const tiny = new LinearAxis(new TimeMap(p), 100, 75)
  expect(tiny.pageRange(0)).toEqual([0, 1920])
})
it('slides pages over 150ms and fixes the center playhead', () => {
  const p = newProject()
  p.lengthTicks = 16000
  const a = new LinearAxis(new TimeMap(p), 1296, 75),
    v = new Viewport()
  expect(v.frame(a, 7000, 'page', 0, true).offset).toBe(0)
  expect(v.frame(a, 7680, 'page', 1, true).offset).toBe(0)
  expect(v.frame(a, 7800, 'page', 151, true).offset).toBe(1296)
  const center = v.frame(a, 9000, 'center', 200, true)
  expect(center.headX).toBe(648)
  expect(center.offset).toBeCloseTo(1296 + a.xInPage(9000) - 648)
})
it('interpolates a shared playhead, freezes a hold and wraps the loop', () => {
  const p = newProject(),
    map = new TimeMap(p),
    s = {
      playing: true,
      recording: false,
      holding: false,
      tick: 0,
      rate: 0.5,
      followFactor: 1,
      perfTime: 1000,
    }
  expect(transportTick(s, map, p.loop, 1100)).toBeCloseTo(48)
  expect(transportTick({ ...s, holding: true }, map, p.loop, 1100)).toBe(0)
  expect(
    transportTick(
      { ...s, tick: 900, rate: 1 },
      map,
      { enabled: true, startTick: 0, endTick: 960 },
      1100,
    ),
  ).toBeCloseTo(36)
})
