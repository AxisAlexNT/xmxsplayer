import { blend, type Builder } from './stage'
export const drive: Builder = (ctx, { params: p }) => {
  const node = ctx.createWaveShaper()
  const amplitude = 10 ** (p.drive / 20)
  node.curve = Float32Array.from(
    { length: 4097 },
    (_, i) => Math.tanh((i / 2048 - 1) * amplitude) / Math.tanh(amplitude),
  )
  node.oversample = '2x'
  return blend(ctx, { input: node, output: node }, p.mix)
}
