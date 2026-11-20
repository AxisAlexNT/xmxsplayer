import { expect, it } from 'vitest'
import { replaceRange } from '../../src/shared/recording'

it('cuts straddling notes and removes only notes and events starting in passed ranges', () => {
  const event = (tick: number) => ({
    tick,
    type: 'cc' as const,
    num: 1,
    value: 90,
  })
  const result = replaceRange(
    [
      [0, 90, 60, 80],
      [50, 30, 61, 80],
      [70, 10, 62, 80],
    ],
    [event(45), event(70)],
    [
      [40, 55],
      [55, 70],
    ],
  )
  expect(result).toEqual({
    notes: [
      [0, 40, 60, 80],
      [70, 10, 62, 80],
    ],
    events: [event(70)],
  })
})
