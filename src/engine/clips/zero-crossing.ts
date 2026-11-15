/** Snap to a nearby crossing in the first channel, favouring quiet stereo samples. */
export function zeroCrossing(
  channels: readonly Float32Array[],
  sampleRate: number,
  seconds: number,
  radiusSec = 0.005,
): number {
  if (!channels.length || !channels[0].length || !Number.isFinite(seconds))
    return Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const length = Math.min(...channels.map((c) => c.length)),
    center = Math.max(
      0,
      Math.min(length - 1, Math.round(seconds * sampleRate)),
    ),
    radius = Math.max(1, Math.round(radiusSec * sampleRate))
  let best = center,
    score = Infinity
  for (
    let index = Math.max(1, center - radius);
    index <= Math.min(length - 1, center + radius);
    index++
  ) {
    const left = channels[0][index - 1],
      right = channels[0][index]
    if (left !== 0 && right !== 0 && Math.sign(left) === Math.sign(right))
      continue
    const energy =
      channels.reduce((sum, channel) => sum + Math.abs(channel[index]), 0) /
      channels.length
    const candidate =
      Math.abs(index - center) / radius + Math.min(1, energy) * 0.2
    if (candidate < score) {
      score = candidate
      best = index
    }
  }
  return best / sampleRate
}
