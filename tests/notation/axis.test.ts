import { expect, it } from 'vitest'
import { NotationAxis } from '../../src/ui/timeline/notation-axis'
import type { NotationInfo } from '../../src/ui/notation/protocol'
const info: NotationInfo = {
  pageCount: 2,
  version: 'test',
  timemap: [],
  measures: [
    { qstamp: 0, end: 4, id: 'm1', page: 1 },
    { qstamp: 4, end: 8, id: 'm2', page: 1 },
    { qstamp: 8, end: 12, id: 'm3', page: 2 },
  ],
  end: 12,
}
const grid = [0, 1920, 3840].map((start) => ({
  start,
  end: start + 1920,
  num: 4,
  den: 4,
}))
it('interpolates engraved anchors in both directions and maps page boundaries consistently', () => {
  const a = new NotationAxis(
    info,
    1000,
    grid,
    new Map([
      [
        0,
        [
          { tick: 0, x: 96 },
          { tick: 480, x: 220 },
          { tick: 1920, x: 650 },
          { tick: 3840, x: 1000 },
        ],
      ],
    ]),
  )
  expect(a.pageOfTick(3839)).toBe(0)
  expect(a.pageOfTick(3840)).toBe(1)
  expect(a.xInPage(480)).toBe(220)
  expect(a.tickAt(0, 220)).toBe(480)
  for (const tick of [0, 100, 700, 2200, 3800])
    expect(a.tickAt(0, a.xInPage(tick, 0))).toBeCloseTo(tick)
  expect(a.pageRange(1)).toEqual([3840, 5760])
  expect(a.measures(1)[0].bar).toBe(3)
})
it('provides a monotonic fallback before pages are measured and clamps input', () => {
  const a = new NotationAxis(
    info,
    1000,
    grid,
    new Map([
      [
        0,
        [
          { tick: 0, x: 95 },
          { tick: 480, x: 90 },
          { tick: 960, x: 300 },
        ],
      ],
    ]),
  )
  expect(a.xInPage(0)).toBe(96)
  expect(a.xInPage(480)).toBe(96)
  expect(a.tickAt(0, -10)).toBe(0)
  expect(a.tickAt(1, 5000)).toBe(5760)
  expect(a.xInPage(4800)).toBeGreaterThan(96)
})

it('keeps barlines distinct from notehead anchors at the same musical tick', () => {
  const a = new NotationAxis(
    info,
    1000,
    grid,
    new Map([
      [
        0,
        [
          { tick: 0, x: 120 },
          { tick: 1920, x: 650 },
          { tick: 0, x: 96, bar: true },
          { tick: 1920, x: 630, bar: true },
        ],
      ],
    ]),
  )
  expect(a.xInPage(0)).toBe(120)
  expect(a.measureX(0)).toBe(96)
  expect(a.xInPage(1920)).toBe(650)
  expect(a.measureX(1920)).toBe(630)
  expect(a.tickAt(0, 630)).toBeLessThan(1920)
  expect(a.tickAt(0, 650)).toBe(1920)
})
