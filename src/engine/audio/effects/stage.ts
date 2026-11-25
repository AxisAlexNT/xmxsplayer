import type { Effect } from '../../../shared/effects'

export interface Stage {
  input: AudioNode
  output: AudioNode
  tempo?: (bpm: number) => void
  trigger?: (track: string, time: number) => void
  cancelTriggers?: () => void
  close?: () => void
}
export type Builder = (ctx: AudioContext, effect: Effect) => Stage

export function blend(ctx: AudioContext, stage: Stage, mix: number): Stage {
  const input = ctx.createGain(),
    output = ctx.createGain()
  const dry = ctx.createGain(),
    wet = ctx.createGain()
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  input.connect(dry).connect(output)
  input.connect(stage.input)
  stage.output.connect(wet).connect(output)
  return {
    ...stage,
    input,
    output,
    close() {
      stage.close?.()
      for (const node of [input, stage.output, dry, wet, output])
        node.disconnect()
    },
  }
}
