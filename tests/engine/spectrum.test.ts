import { expect, it } from 'vitest'
import { analyzeSpectrum } from '../../src/engine/audio/spectrum'
import { dbByte, readSpectrum } from '../../src/shared/spectrum'
it.each([
  [440, 144],
  [55, 36],
  [58.3, 39],
])('maps a %d Hz tone to its pitch bin', (hz, bin) => {
  const samples = Float32Array.from(
    { length: 16000 },
    (_, i) => 0.6 * Math.sin((2 * Math.PI * hz * i) / 48000),
  )
  const spectrum = readSpectrum(
    analyzeSpectrum(samples, undefined, 'left', 48000),
  )
  const row = spectrum.data.slice(16 * 264, 17 * 264)
  const maxima = Array.from(row.keys()).filter(
    (i) => row[i] === Math.max(...row),
  )
  expect(maxima).toContain(bin)
  expect(
    Math.abs(maxima.reduce((a, b) => a + b, 0) / maxima.length - bin),
  ).toBeLessThan(1)
})
it('rejects damaged headers and maps dB limits and stereo cancellation', () => {
  expect(() => readSpectrum(new ArrayBuffer(24))).toThrow()
  expect([dbByte(-110), dbByte(-45), dbByte(3)]).toEqual([0, 128, 255])
  const samples = new Float32Array(512).fill(0.5)
  expect(
    readSpectrum(analyzeSpectrum(samples, samples, 'side', 44100)).data.every(
      (v) => v === 0,
    ),
  ).toBe(true)
})
