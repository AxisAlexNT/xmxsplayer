export interface TimeAxis {
  measureX?(tick: number, page?: number): number
  measures?(page: number): import('../../shared/time-map').Measure[]
  readonly pageCount: number
  readonly pageWidth: number
  pageOfTick(tick: number): number
  xInPage(tick: number, page?: number): number
  tickAt(page: number, x: number): number
  pageRange(page: number): readonly [number, number]
}
