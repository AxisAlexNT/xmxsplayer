import type { Builder } from './stage'
export const filter: Builder = (ctx, { params: p }) => {
  const node = ctx.createBiquadFilter(),
    oscillator = ctx.createOscillator(),
    depth = ctx.createGain()
  node.type = (['lowpass', 'highpass', 'bandpass'] as const)[Math.round(p.mode)]
  node.frequency.value = Math.min(ctx.sampleRate / 2, p.cutoff)
  node.Q.value = p.resonance
  depth.gain.value = p.depth
  oscillator.connect(depth).connect(node.detune)
  oscillator.start()
  return {
    input: node,
    output: node,
    tempo(bpm) {
      oscillator.frequency.setTargetAtTime(
        p.sync ? bpm / (60 * p.beats) : p.rate,
        ctx.currentTime,
        0.01,
      )
    },
    close() {
      oscillator.stop()
      oscillator.disconnect()
      depth.disconnect()
    },
  }
}
