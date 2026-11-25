import { blend, type Builder } from './stage'
export const chorus: Builder = (ctx, { params: p }) => {
  const delay = ctx.createDelay(),
    oscillator = ctx.createOscillator(),
    depth = ctx.createGain()
  delay.delayTime.value = 0.018
  depth.gain.value = p.depth
  oscillator.frequency.value = p.rate
  oscillator.connect(depth).connect(delay.delayTime)
  oscillator.start()
  return blend(
    ctx,
    {
      input: delay,
      output: delay,
      close() {
        oscillator.stop()
        oscillator.disconnect()
        depth.disconnect()
      },
    },
    p.mix,
  )
}
