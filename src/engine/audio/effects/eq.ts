import type { Builder } from './stage'

export const eq: Builder = (ctx, { params: p }) => {
  function band(type: BiquadFilterType, hz: number, gain = 0) {
    const node = ctx.createBiquadFilter()
    node.type = type
    node.frequency.value = Math.min(ctx.sampleRate / 2, hz)
    node.gain.value = gain
    return node
  }
  const input = band('highpass', p.highpass)
  const output = input
    .connect(band('lowshelf', 250, p.low))
    .connect(band('peaking', 1200, p.mid))
    .connect(band('highshelf', 4500, p.high))
    .connect(band('lowpass', p.lowpass))
  return { input, output }
}
