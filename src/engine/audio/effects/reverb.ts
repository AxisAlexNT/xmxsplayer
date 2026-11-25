// Generate the same stereo room response on every reload without blocking the audio thread.
export function roomImpulse(
  sampleRate: number,
  params: Record<string, number>,
): Float32Array<ArrayBuffer>[] {
  const frames = Math.max(1, Math.round(sampleRate * params.size))
  const offset = Math.round(sampleRate * params.preDelay)
  let seed = 0x234561
  const pole = params.damping * 0.97
  return Array.from({ length: 2 }, () => {
    const channel = new Float32Array(frames + offset)
    let previous = 0
    for (let frame = 0; frame < frames; frame++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
      const noise = seed / 0x80000000 - 1
      previous = pole * previous + (1 - pole) * noise
      channel[offset + frame] = previous * (1 - frame / frames) ** params.decay
    }
    return channel
  })
}
