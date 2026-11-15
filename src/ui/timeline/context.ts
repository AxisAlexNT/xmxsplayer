import type { ComputedRef, InjectionKey, ShallowRef } from 'vue'
import type { TimeAxis } from './time-axis'
import type { TimelineFrame } from './viewport'
export interface TimelineContext {
  axis: ComputedRef<TimeAxis>
  frame: ShallowRef<TimelineFrame>
}
export const timelineKey: InjectionKey<TimelineContext> = Symbol('timeline')
