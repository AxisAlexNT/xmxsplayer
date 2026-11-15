export interface TimeAxis {
  readonly pageCount: number
  readonly pageWidth: number
  pageOfTick(tick: number): number
  xInPage(tick: number, page?: number): number
  tickAt(page: number, x: number): number
  pageRange(page: number): readonly [number, number]
}
