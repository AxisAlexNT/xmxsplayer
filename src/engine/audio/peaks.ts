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

export async function audioPeaksAsync(
  channels: readonly Float32Array[],
  yieldWork: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<number[]> {
  const length = Math.max(0, ...channels.map((c) => c.length)),
    result: number[] = [],
    chunkFrames = 65536
  for (let offset = 0; offset < length; offset += chunkFrames) {
    result.push(
      ...audioPeaks(
        channels.map((c) => c.subarray(offset, offset + chunkFrames)),
      ),
    )
    if (offset + chunkFrames < length) await yieldWork()
  }
  return result
}
