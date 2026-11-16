import { expect, it } from 'vitest'
import { FluidChannels } from '../../src/engine/synth/fluid-channels'
it('reserves channel 10 in each MIDI group for drums, exhausts safely and reuses released channels', () => {
  const channels = new FluidChannels()
  const drums = Array.from({ length: 4 }, () => channels.allocate(true))
  const melodic = Array.from({ length: 60 }, () => channels.allocate(false))
  expect(drums).toEqual([9, 25, 41, 57])
  expect(new Set([...drums, ...melodic]).size).toBe(64)
  expect(() => channels.allocate(true)).toThrow('no free drum')
  expect(() => channels.allocate(false)).toThrow('no free melodic')
  channels.release(25)
  expect(channels.allocate(true)).toBe(25)
  channels.clear()
  expect(channels.allocate(false)).toBe(0)
})
