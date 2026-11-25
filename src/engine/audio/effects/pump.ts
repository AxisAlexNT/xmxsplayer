import type { Builder } from './stage'
export const pump: Builder = (ctx, effect) => {
  const node = ctx.createGain(),
    p = effect.params
  return {
    input: node,
    output: node,
    cancelTriggers() {
      node.gain.cancelAndHoldAtTime(ctx.currentTime)
      node.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.015)
    },
    trigger(track, time) {
      if (track !== effect.trigger?.trackId) return
      const start = Math.max(time, ctx.currentTime)
      node.gain.cancelAndHoldAtTime(start)
      node.gain.linearRampToValueAtTime(1 - p.depth, start + p.attack)
      for (let i = 1; i <= 16; i++) {
        const t = i / 16
        node.gain.linearRampToValueAtTime(
          1 - p.depth * (1 - t) ** (1 + 4 * p.curve),
          start + p.attack + p.release * t,
        )
      }
    },
  }
}
