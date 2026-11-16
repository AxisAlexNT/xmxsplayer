import { PPQ } from '../../shared/model'
import type { Measure } from '../../shared/time-map'
import type { ScoreMeasure } from '../notation/notes-to-musicxml'
import type { NotationInfo } from '../notation/protocol'
import type { TimeAxis } from './time-axis'
import type { AxisPoint } from '../notation/protocol'
export type { AxisPoint } from '../notation/protocol'

export class NotationAxis implements TimeAxis {
  readonly pageCount: number
  private ranges: [number, number][] = []
  private points: AxisPoint[][] = []
  private bars: Map<number, number>[] = []
  constructor(
    readonly info: NotationInfo,
    readonly pageWidth: number,
    readonly grid: ScoreMeasure[],
    geometry: ReadonlyMap<number, readonly AxisPoint[]> = new Map(),
  ) {
    this.pageCount = info.pageCount
    for (let p = 0; p < info.pageCount; p++) {
      const measures = info.measures.filter((m) => m.page === p + 1),
        start = (measures[0]?.qstamp ?? 0) * PPQ,
        end =
          (info.measures.find((m) => m.page > p + 1)?.qstamp ?? info.end) * PPQ
      this.ranges.push([start, Math.max(start + 1, end)])
      const points = [...(geometry.get(p) ?? [])]
        .filter((n) => n.tick >= start && n.tick <= end && Number.isFinite(n.x))
        .sort((a, b) => a.tick - b.tick || a.x - b.x)
      this.bars.push(
        new Map(points.filter((p) => p.bar).map((p) => [p.tick, p.x])),
      )
      const unique = new Map<number, number>()
      for (const n of points)
        if (!n.bar && !unique.has(n.tick))
          unique.set(n.tick, Math.max(96, Math.min(pageWidth, n.x)))
      if (!unique.has(start)) unique.set(start, 96)
      if (!unique.has(end)) unique.set(end, pageWidth)
      let previous = 96
      this.points.push(
        [...unique]
          .sort((a, b) => a[0] - b[0])
          .map(([tick, x]) => ({
            tick,
            x: (previous = Math.max(previous, x)),
          })),
      )
    }
  }
  pageRange(page: number): readonly [number, number] {
    return (
      this.ranges[
        Math.max(0, Math.min(this.pageCount - 1, Math.floor(page)))
      ] ?? [0, 1]
    )
  }
  pageOfTick(tick: number): number {
    let lo = 0,
      hi = this.ranges.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ranges[mid][0] <= tick) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo - 1)
  }
  xInPage(tick: number, page = this.pageOfTick(tick)): number {
    const list = this.points[
      Math.max(0, Math.min(this.pageCount - 1, page))
    ] ?? [
      { tick: 0, x: 96 },
      { tick: 1, x: this.pageWidth },
    ]
    let i = 0
    while (i + 1 < list.length && list[i + 1].tick <= tick) i++
    const a = list[i],
      b = list[i + 1] ?? a
    return b.tick === a.tick
      ? a.x
      : a.x + ((b.x - a.x) * (tick - a.tick)) / (b.tick - a.tick)
  }
  measureX(tick: number, page = this.pageOfTick(tick)): number {
    return this.bars[page]?.get(tick) ?? this.xInPage(tick, page)
  }
  tickAt(page: number, x: number): number {
    const list = this.points[
      Math.max(0, Math.min(this.pageCount - 1, page))
    ] ?? [
      { tick: 0, x: 96 },
      { tick: 1, x: this.pageWidth },
    ]
    if (x <= list[0].x) return list[0].tick
    let i = 0
    while (i + 1 < list.length && list[i + 1].x <= x) i++
    const a = list[i],
      b = list[i + 1] ?? a
    return b.x === a.x
      ? a.tick
      : a.tick + ((b.tick - a.tick) * (x - a.x)) / (b.x - a.x)
  }
  measures(page: number): Measure[] {
    const [start, end] = this.pageRange(page)
    return this.grid.flatMap((m, index) =>
      m.start >= start && m.start < end
        ? [
            {
              bar: index + 1,
              start: m.start,
              end: m.end,
              num: m.num,
              den: m.den,
              beats: Array.from(
                { length: Math.ceil((m.end - m.start) / ((PPQ * 4) / m.den)) },
                (_, i) => m.start + (i * PPQ * 4) / m.den,
              ),
            },
          ]
        : [],
    )
  }
}
