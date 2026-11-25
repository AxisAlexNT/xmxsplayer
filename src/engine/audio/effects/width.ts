import type { Builder } from './stage'
export const width: Builder = (ctx, { params: p }) => {
  const input = ctx.createGain(),
    split = ctx.createChannelSplitter(2),
    output = ctx.createChannelMerger(2)
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  input.connect(split)
  for (let source = 0; source < 2; source++) {
    for (let target = 0; target < 2; target++) {
      const gain = ctx.createGain()
      gain.gain.value = (1 + (source === target ? p.width : -p.width)) / 2
      split.connect(gain, source).connect(output, 0, target)
    }
  }
  return { input, output }
}
