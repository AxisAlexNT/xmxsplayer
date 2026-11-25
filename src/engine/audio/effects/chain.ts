import { effectDefaults, type Effect } from '../../../shared/effects'
import { chorus } from './chorus'
import { compressor } from './compressor'
import { reverb } from './convolver'
import { delay } from './delay'
import { drive } from './drive'
import { eq } from './eq'
import { filter } from './filter'
import { limiter } from './limiter'
import { pump } from './pump'
import type { Stage } from './stage'
import { width } from './width'

const builders = {
  chorus,
  compressor,
  reverb,
  delay,
  drive,
  eq,
  filter,
  limiter,
  pump,
  width,
}
const fadeSeconds = 0.015
interface Branch {
  entry: AudioNode
  stages: Stage[]
  volume: GainNode
}

export class EffectChain {
  private current?: Branch
  private signature = '[]'
  private retiring = new Map<Branch, ReturnType<typeof setTimeout>>()
  private bpm = 120
  constructor(
    private ctx: AudioContext,
    private source: AudioNode,
    private target: AudioNode,
  ) {
    source.connect(target)
  }
  private branch(effects: Effect[]): Branch {
    const volume = this.ctx.createGain()
    const stages: Stage[] = []
    try {
      for (const effect of effects) {
        const stage = builders[effect.type](this.ctx, {
          ...effect,
          params: { ...effectDefaults(effect.type), ...effect.params },
        })
        stages.at(-1)?.output.connect(stage.input)
        stages.push(stage)
        stage.tempo?.(this.bpm)
      }
      stages.at(-1)?.output.connect(volume)
      volume.connect(this.target)
      const entry = stages[0]?.input ?? volume
      this.source.connect(entry)
      return { entry, stages, volume }
    } catch (error) {
      for (const stage of stages) {
        stage.close?.()
        stage.output.disconnect()
      }
      volume.disconnect()
      throw error
    }
  }
  set(effects: Effect[] = []): void {
    const enabled = effects.filter((effect) => effect.enabled)
    const signature = JSON.stringify(enabled)
    if (signature === this.signature) return
    const next = this.branch(enabled)
    const time = this.ctx.currentTime
    next.volume.gain.setValueAtTime(0, time)
    next.volume.gain.linearRampToValueAtTime(1, time + fadeSeconds)
    if (!this.current) {
      this.source.disconnect(this.target)
      this.current = this.branch([])
    }
    const old = this.current
    old.volume.gain.cancelAndHoldAtTime(time)
    old.volume.gain.linearRampToValueAtTime(0, time + fadeSeconds)
    this.retiring.set(
      old,
      setTimeout(() => this.remove(old), 50),
    )
    this.current = next
    this.signature = signature
  }
  tempo(bpm: number): void {
    if (this.bpm === bpm || !Number.isFinite(bpm) || bpm <= 0) return
    this.bpm = bpm
    for (const stage of this.current?.stages ?? []) stage.tempo?.(bpm)
  }
  trigger(track: string, when: number): void {
    for (const stage of this.current?.stages ?? []) stage.trigger?.(track, when)
  }
  cancelTriggers(): void {
    for (const stage of this.current?.stages ?? []) stage.cancelTriggers?.()
  }
  private remove(branch: Branch): void {
    clearTimeout(this.retiring.get(branch))
    this.retiring.delete(branch)
    this.source.disconnect(branch.entry)
    for (const stage of branch.stages) {
      stage.close?.()
      stage.output.disconnect()
    }
    branch.volume.disconnect()
  }
  close(): void {
    for (const branch of this.retiring.keys()) this.remove(branch)
    if (this.current) this.remove(this.current)
    else this.source.disconnect(this.target)
  }
}
