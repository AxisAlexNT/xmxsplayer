import { PEAK_FRAMES } from '../../shared/audio'
export function audioPeaks(
  channels: readonly Float32Array[],
  blockSize = PEAK_FRAMES,
): number[] {
  const length = Math.max(0, ...channels.map((c) => c.length)),
    peaks = new Array<number>(Math.ceil(length / blockSize)).fill(0)
  for (const channel of channels)
    for (let offset = 0; offset < channel.length; offset += blockSize) {
      let max = peaks[offset / blockSize]
      for (
        let i = offset;
        i < Math.min(channel.length, offset + blockSize);
        i++
      )
        max = Math.max(max, Math.abs(channel[i]))
      peaks[offset / blockSize] = Math.min(1, max)
    }
  return peaks
}
