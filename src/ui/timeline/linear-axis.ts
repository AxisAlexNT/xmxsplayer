import { TimeMap } from '../../shared/time-map'
import type { TimeAxis } from './time-axis'
export class LinearAxis implements TimeAxis {
  private pages: [number, number][] = []
  readonly pageWidth: number
  constructor(
    readonly map: TimeMap,
    width: number,
    readonly pxPerQuarter = 75,
    readonly gutter = 96,
  ) {
    this.pageWidth = Math.max(gutter + 1, width)
    const capacity = Math.max(
      1,
      ((this.pageWidth - gutter) * 480) / pxPerQuarter,
    )
    let start = 0,
      end = 0
    for (const measure of map.measures(0, Math.max(1, map.lengthTicks))) {
      if (end > start && measure.end - start > capacity) {
        this.pages.push([start, end])
        start = measure.start
      }
      end = measure.end
    }
    this.pages.push([start, Math.max(start + 1, end)])
  }
  get pageCount(): number {
    return this.pages.length
  }
  pageRange(page: number): readonly [number, number] {
    return this.pages[
      Math.max(0, Math.min(this.pages.length - 1, Math.floor(page)))
    ]
  }
  pageOfTick(tick: number): number {
    let lo = 0,
      hi = this.pages.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.pages[mid][0] <= tick) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo - 1)
  }
  xInPage(tick: number, page = this.pageOfTick(tick)): number {
    const [start, end] = this.pageRange(page)
    return (
      this.gutter +
      ((tick - start) / (end - start)) * (this.pageWidth - this.gutter)
    )
  }
  tickAt(page: number, x: number): number {
    const [start, end] = this.pageRange(page)
    return Math.max(
      start,
      Math.min(
        end,
        start +
          ((x - this.gutter) / (this.pageWidth - this.gutter)) * (end - start),
      ),
    )
  }
}
