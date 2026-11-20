export const spectrumBins = 264
export const spectrumHop = 512
const headerSize = 24
export const binHz = (bin: number) => 27.5 * 2 ** (bin / 36)
export const dbByte = (db: number) =>
  Math.round(255 * Math.min(1, Math.max(0, (db + 90) / 90)))
export function createSpectrum(sampleRate: number, frames: number) {
  const buffer = new ArrayBuffer(headerSize + frames * spectrumBins)
  new Uint32Array(buffer, 0, 6).set([
    0x53584d58,
    1,
    sampleRate,
    spectrumHop,
    spectrumBins,
    frames,
  ])
  return readSpectrum(buffer)
}
export function readSpectrum(buffer: ArrayBuffer) {
  if (buffer.byteLength < headerSize) throw Error('Truncated spectrum')
  const [magic, version, sampleRate, hop, bins, frames] = new Uint32Array(
    buffer,
    0,
    6,
  )
  if (
    magic !== 0x53584d58 ||
    version !== 1 ||
    !sampleRate ||
    hop !== spectrumHop ||
    bins !== spectrumBins ||
    buffer.byteLength !== headerSize + frames * bins
  )
    throw Error('Invalid spectrum header')
  return {
    buffer,
    sampleRate,
    hop,
    bins,
    frames,
    data: new Uint8Array(buffer, headerSize),
  }
}
