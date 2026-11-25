import { expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import { recordedLength } from '../../src/shared/recording'
import { TimeMap } from '../../src/shared/time-map'

it('keeps one empty bar after the last sounding bar and preserves previous length', () => {
  const map = new TimeMap(newProject())
  const bar = map.barToTick(2)
  expect(recordedLength(bar, [[33 * bar, bar, 60, 96]], map)).toBe(35 * bar)
  expect(recordedLength(40 * bar, [[33 * bar, 1, 60, 96]], map)).toBe(40 * bar)
  expect(recordedLength(bar, [], map)).toBe(bar)
})
