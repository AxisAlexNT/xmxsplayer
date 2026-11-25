import { expect, it } from 'vitest'
import { matchesGesture } from '../../src/ui/tutorial/controller'
import type { EventMap } from '../../src/shared/protocol'

const event: EventMap['control'] = {
  controlKind: 'encoder', deviceId: 'keyboard', controlId: 'wheel', edge: 'change', value: .6, pressed: false,
}
it('recognizes encoders by profile kind and respects the selected controller and control', () => {
  expect(matchesGesture('knob', event, event)).toBe(true)
  expect(matchesGesture('knob', event, { ...event, deviceId: 'other' })).toBe(false)
  expect(matchesGesture('knob', event, { ...event, controlId: 'other' })).toBe(false)
  expect(matchesGesture('fader', event)).toBe(false)
})
it('requires a fresh pad press rather than pressure or release', () => {
  expect(matchesGesture('pad', { ...event, controlKind:'pad', edge:'press' })).toBe(true)
  for (const edge of ['change','release'] as const)
    expect(matchesGesture('pad', { ...event, controlKind:'pad', edge })).toBe(false)
})
