import type { TransportState } from '../../shared/protocol'
import type { Project } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import type { TimeAxis } from './time-axis'
export interface TimelineFrame {
  tick: number
  offset: number
  headX: number
  pages: number[]
  edge: number
}
export function transportTick(
  state: TransportState,
  map: TimeMap,
  loop: Project['loop'],
  now: number,
): number {
  let sec = map.tickToSec(state.tick)
  if (state.playing && !state.holding)
    sec +=
      Math.max(0, Math.min(0.25, (now - state.perfTime) / 1000)) *
      state.rate *
      state.followFactor
  if (loop.enabled) {
    const start = map.tickToSec(loop.startTick),
      end = map.tickToSec(loop.endTick)
    if (sec >= end) sec = start + ((sec - end) % (end - start))
  }
  return Math.max(0, Math.min(map.lengthTicks, map.secToTick(sec)))
}
export class Viewport {
  private previousPage = -1
  private slideFrom = 0
  private slideStart = -Infinity
  private lastOffset = 0
  frame(
    axis: TimeAxis,
    tick: number,
    mode: 'page' | 'center',
    now: number,
    animate: boolean,
  ): TimelineFrame {
    const page = axis.pageOfTick(tick),
      global = page * axis.pageWidth + axis.xInPage(tick)
    const target =
      mode === 'center' ? global - axis.pageWidth / 2 : page * axis.pageWidth
    if (page !== this.previousPage && mode === 'page') {
      if (animate && this.previousPage >= 0 && page === this.previousPage + 1) {
        this.slideStart = now
        this.slideFrom = this.lastOffset
      } else this.slideStart = -Infinity
    }
    this.previousPage = page
    const progress = Math.min(1, Math.max(0, (now - this.slideStart) / 150)),
      eased = 1 - (1 - progress) ** 3
    const offset =
      mode === 'page' && progress < 1
        ? this.slideFrom + (target - this.slideFrom) * eased
        : target
    this.lastOffset = offset
    const first = Math.max(0, Math.floor(offset / axis.pageWidth)),
      last = Math.min(
        axis.pageCount - 1,
        Math.floor((offset + axis.pageWidth) / axis.pageWidth),
      )
    return {
      tick,
      offset,
      headX: mode === 'center' ? axis.pageWidth / 2 : global - offset,
      pages: Array.from(
        { length: Math.max(0, last - first + 1) },
        (_, i) => first + i,
      ),
      edge:
        mode === 'page'
          ? Math.max(0, (axis.xInPage(tick) / axis.pageWidth - 0.82) / 0.18)
          : 0,
    }
  }
}
