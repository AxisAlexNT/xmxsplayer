import type { Action, Clip, Project, Timing } from '../../shared/model'
import { ClipPlayer } from './clip-player'
import { Sweep } from './sweep'
export interface ClipActionContext {
  delta?: number
  at?: Timing
}
interface ControlSweep {
  clipId: string
  source: string
  signature: string
  sweep: Sweep
}
export class ClipActions {
  private sweeps = new Map<string, ControlSweep>()
  private timer?: ReturnType<typeof setInterval>
  constructor(
    private player: ClipPlayer,
    private project: () => Project | undefined,
    private now: () => number = () => performance.now(),
  ) {}
  private clip(id: string): Clip | undefined {
    return this.project()?.clips.find((clip) => clip.id === id)
  }
  run(
    action: Extract<Action, { type: 'clip' }>,
    value = 1,
    pressed = true,
    source = 'action',
    context: ClipActionContext = {},
  ): void {
    if (action.cmd === 'stopAll' || action.cmd === 'stopGroup') {
      const group = action.cmd === 'stopGroup' ? action.group : undefined
      if (action.cmd === 'stopGroup' && !group) return
      this.clearWhere(
        (entry) =>
          group === undefined || this.clip(entry.clipId)?.group === group,
      )
      this.player.stopAll(group)
      return
    }
    const clip = action.clipId ? this.clip(action.clipId) : undefined
    if (!clip) return
    if (action.cmd === 'launch') {
      this.player.launch(clip.id, pressed, value, source, context.at)
      return
    }
    if (action.cmd === 'stop') {
      this.clearWhere((entry) => entry.clipId === clip.id)
      this.player.stop(clip.id, context.at)
      return
    }
    if (
      !Number.isFinite(value) ||
      (context.delta !== undefined && !Number.isFinite(context.delta))
    )
      return
    if (action.cmd === 'gain') {
      this.player.setGain(
        clip.id,
        this.value(value, context.delta, this.player.gain(clip.id)),
      )
      return
    }
    if (action.cmd === 'pitch') {
      const [lo, hi] = clip.sweep.range,
        span = hi - lo
      const current = span ? (this.player.pitch(clip.id) - lo) / span : 0
      this.player.setPitch(
        clip.id,
        lo + this.value(value, context.delta, current) * span,
      )
      return
    }
    if (action.cmd !== 'sweep') return
    const key = JSON.stringify([source, clip.id]),
      signature = JSON.stringify(clip.sweep)
    let entry = this.sweeps.get(key)
    if (entry?.signature !== signature) {
      if (entry) {
        entry.sweep.reset()
        this.sweeps.delete(key)
        this.stopIfUnused(clip.id)
      }
      entry = {
        clipId: clip.id,
        source,
        signature,
        sweep: new Sweep(clip.sweep, this.player.pitch(clip.id)),
      }
      this.sweeps.set(key, entry)
    }
    if (this.player.state(clip.id) === 'stopped') entry.sweep.reset()
    const result = entry.sweep.change(value, this.now(), context.delta)
    this.player.setPitch(clip.id, result.semitones)
    if (result.start) this.player.startSweep(clip.id, source)
    if (result.stop) this.stopIfUnused(clip.id)
    if (result.deadline !== null && !this.timer)
      this.timer = setInterval(() => this.tick(), 10)
  }
  private value(
    value: number,
    delta: number | undefined,
    current: number,
  ): number {
    return Math.max(
      0,
      Math.min(1, delta === undefined ? value : current + delta / 127),
    )
  }
  pressure(action: Action, value: number, source: string): void {
    if (
      action.type === 'clip' &&
      action.cmd === 'launch' &&
      action.clipId &&
      this.clip(action.clipId)?.pressureToGain
    )
      this.player.pressure(action.clipId, value, source)
  }
  private stopIfUnused(clipId: string): void {
    if (
      [...this.sweeps.values()].some(
        (entry) => entry.clipId === clipId && entry.sweep.running,
      )
    )
      return
    if (this.player.owner(clipId)?.startsWith('sweep:'))
      this.player.stop(clipId, 'now')
  }
  tick(): void {
    this.configure()
    for (const entry of this.sweeps.values())
      if (entry.sweep.tick(this.now()).stop) this.stopIfUnused(entry.clipId)
    if (
      ![...this.sweeps.values()].some((entry) => entry.sweep.deadline !== null)
    ) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
  configure(): void {
    this.clearWhere(
      (entry) =>
        !this.clip(entry.clipId) ||
        JSON.stringify(this.clip(entry.clipId)!.sweep) !== entry.signature,
    )
  }
  private clearWhere(matches: (entry: ControlSweep) => boolean): void {
    const clips = new Set<string>()
    for (const [key, entry] of this.sweeps)
      if (matches(entry)) {
        entry.sweep.reset()
        this.sweeps.delete(key)
        clips.add(entry.clipId)
      }
    for (const id of clips) this.stopIfUnused(id)
  }
  disconnect(deviceId: string): void {
    this.clearWhere((entry) => {
      if (!entry.source.startsWith('binding:')) return false
      try {
        return JSON.parse(entry.source.slice(8))[0] === deviceId
      } catch {
        return false
      }
    })
  }
  clearSources(matches: (source: string) => boolean): void {
    this.clearWhere((entry) => matches(entry.source))
    this.player.releaseSources(matches)
  }
  clear(): void {
    this.clearWhere(() => true)
    clearInterval(this.timer)
    this.timer = undefined
  }
}
