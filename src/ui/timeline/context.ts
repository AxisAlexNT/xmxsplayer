import type { ComputedRef, InjectionKey, ShallowRef } from 'vue'
import type { TimeAxis } from './time-axis'
import type { TimelineFrame } from './viewport'
export interface TimelineContext {
  axis: ComputedRef<TimeAxis>
  frame: ShallowRef<TimelineFrame>
  navigation: {
    freeze(): void
    pan(delta: number): void
    previewZoom(px: number, tick: number, x: number): void
    commitZoom(): void
    cancelZoom(): void
  }
}
export const timelineKey: InjectionKey<TimelineContext> = Symbol('timeline')
