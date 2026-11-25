import { blend, type Builder } from './stage'
export const delay: Builder = (ctx, { params: p }) => {
  const node = ctx.createDelay(60),
    damping = ctx.createBiquadFilter(),
    feedback = ctx.createGain()
  damping.frequency.value = Math.min(ctx.sampleRate / 2, p.damping)
  feedback.gain.value = p.feedback
  node.connect(damping).connect(feedback)
  if (p.pingPong) {
    const split = ctx.createChannelSplitter(2),
      swap = ctx.createChannelMerger(2)
    feedback.connect(split)
    split.connect(swap, 0, 1)
    split.connect(swap, 1, 0)
    swap.connect(node)
    const first = ctx.createChannelMerger(2)
    const mono = ctx.createGain()
    mono.channelCount = 1
    mono.channelCountMode = 'explicit'
    mono.connect(first, 0, 0)
    first.connect(node)
    return blend(ctx, { input: mono, output: node, tempo, close }, p.mix)
  }
  feedback.connect(node)
  return blend(ctx, { input: node, output: node, tempo, close }, p.mix)
  function tempo(bpm: number) {
    node.delayTime.setTargetAtTime(
      Math.min(60, (60 * p.beats) / bpm),
      ctx.currentTime,
      0.015,
    )
  }
  function close() {
    feedback.disconnect()
    node.disconnect()
  }
}
