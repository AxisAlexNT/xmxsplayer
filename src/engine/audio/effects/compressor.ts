import type { Builder } from './stage'
export const compressor: Builder = (ctx, { params: p }) => {
  const node = ctx.createDynamicsCompressor()
  for (const key of [
    'threshold',
    'ratio',
    'attack',
    'release',
    'knee',
  ] as const)
    node[key].value = p[key]
  return { input: node, output: node }
}
