import { compressor } from './compressor'
import type { Builder } from './stage'
export const limiter: Builder = (ctx, effect) =>
  compressor(ctx, {
    ...effect,
    params: { ...effect.params, ratio: 20, attack: 0.001, knee: 0 },
  })
