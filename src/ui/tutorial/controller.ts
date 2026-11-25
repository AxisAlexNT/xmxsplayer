import type { ControlDef } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'
import type { TourStep } from './tours'

type ControlType = NonNullable<TourStep['controller']>
export type ControlAddress = Pick<EventMap['control'], 'deviceId' | 'controlId'>

export function matchesKind(expected: ControlType, actual: ControlDef['kind'] | undefined) {
  return expected === actual || (expected === 'knob' && actual === 'encoder')
}

export function matchesGesture(expected: ControlType, event: EventMap['control'], address?: ControlAddress) {
  if (address && (event.deviceId !== address.deviceId || event.controlId !== address.controlId)) return false
  if (!matchesKind(expected, event.controlKind)) return false
  return expected === 'pad' ? event.edge === 'press' : event.edge === 'change'
}
