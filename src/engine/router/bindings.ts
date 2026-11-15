import type {
  Action,
  Binding,
  ControlDef,
  Project,
  Timing,
} from '../../shared/model'
import type { ControlEvent } from '../midi/profile'
import {
  matchesCondition,
  type ConditionContext,
} from '../../shared/conditions'
import { effectiveSetup, isUnbound } from '../../shared/overlay'
export type ParamAction = Extract<Action, { type: 'param' }>
export interface BindingHost {
  project(): Project | undefined
  context(): ConditionContext & { holding: boolean }
  profile(deviceId: string): { id: string; controls: ControlDef[] } | undefined
  queue(at: Timing, run: () => void): number
  cancel(id: number): void
  isQueued?(id: number): boolean
  run(
    action: Action,
    value: number,
    pressed: boolean,
    source: string,
    context?: { delta?: number; at?: Timing },
  ): void
  pressure?(action: Action, value: number, source: string): void
  parameter(action: ParamAction): number | undefined
}
interface Pickup {
  previous: number
  latched: boolean
  lastSent?: number
  time: number
}
export class SoftTakeover {
  private values = new Map<string, Pickup>()
  accept(key: string, value: number, target: number, time: number): boolean {
    let state = this.values.get(key)
    if (!state) {
      state = { previous: value, latched: false, time }
      this.values.set(key, state)
    }
    if (
      time - state.time > 250 &&
      state.lastSent !== undefined &&
      Math.abs(target - state.lastSent) > 2 / 127
    )
      state.latched = false
    state.latched ||=
      Math.abs(value - target) <= 1 / 127 ||
      (state.previous - target) * (value - target) < 0
    state.previous = value
    state.time = time
    if (state.latched) state.lastSent = value
    return state.latched
  }
  clear(prefix = ''): void {
    for (const key of this.values.keys())
      if (key.startsWith(prefix)) this.values.delete(key)
  }
}
interface HeldAction {
  action: Action
  value: number
  source: string
  pending: number
  started: boolean
  context: { delta?: number; at?: Timing }
}
export class Bindings {
  private pickup = new SoftTakeover()
  private held = new Map<string, HeldAction>()
  private pending = new Map<number, { deviceId: string; controlId: string }>()
  constructor(private host: BindingHost) {}
  private dispatch(
    binding: Binding,
    event: ControlEvent,
    action: Action,
    value: number,
  ): void {
    const key = JSON.stringify([event.deviceId, event.controlId]),
      source = `binding:${key}`,
      release =
        action.type === 'note' ||
        (action.type === 'register' && action.cmd === 'momentary') ||
        (action.type === 'clip' && action.cmd === 'launch')
    if (release && event.edge === 'release') return
    const entry: HeldAction = {
      action,
      value,
      source,
      pending: 0,
      started: false,
      context: { delta: event.delta, at: binding.at },
    }
    if (release) {
      const old = this.held.get(key)
      if (old) this.release(old)
      this.held.set(key, entry)
    }
    entry.pending = this.host.queue(
      action.type === 'clip' ? 'now' : (binding.at ?? 'now'),
      () => {
        this.pending.delete(entry.pending)
        entry.started = true
        this.host.run(
          entry.action,
          entry.value,
          event.pressed,
          source,
          entry.context,
        )
      },
    )
    if (entry.pending && !entry.started)
      this.pending.set(entry.pending, {
        deviceId: event.deviceId,
        controlId: event.controlId,
      })
  }
  queued(deviceId: string): ReadonlySet<string> {
    const result = new Set<string>()
    for (const [id, pending] of this.pending) {
      if (this.host.isQueued && !this.host.isQueued(id)) this.pending.delete(id)
      else if (pending.deviceId === deviceId) result.add(pending.controlId)
    }
    return result
  }
  private release(entry: HeldAction): void {
    if (entry.pending) {
      this.host.cancel(entry.pending)
      this.pending.delete(entry.pending)
    }
    if (entry.started) {
      if (entry.action.type === 'clip')
        this.host.run(
          entry.action,
          entry.value,
          false,
          entry.source,
          entry.context,
        )
      else this.host.run(entry.action, entry.value, false, entry.source)
    }
  }
  releaseControl(event: ControlEvent): void {
    if (event.edge !== 'release') return
    const key = JSON.stringify([event.deviceId, event.controlId]),
      old = this.held.get(key)
    if (old) {
      this.release(old)
      this.held.delete(key)
    }
  }
  receive(event: ControlEvent): void {
    const p = this.host.project(),
      profile = this.host.profile(event.deviceId)
    if (!p || !profile) return
    this.releaseControl(event)
    const held = this.held.get(
      JSON.stringify([event.deviceId, event.controlId]),
    )
    if (
      held?.action.type === 'clip' &&
      held.action.cmd === 'launch' &&
      event.edge === 'change' &&
      event.pressed
    ) {
      held.value = event.value
      if (held.started)
        this.host.pressure?.(held.action, event.value, held.source)
    }
    const context = this.host.context(),
      setup = effectiveSetup(p, context.activeSceneId, [profile.id]),
      binding = setup.bindings.find(
        (b) => b.control === event.controlId && b.edge === event.edge,
      )
    if (
      isUnbound(binding) ||
      !binding ||
      !matchesCondition(binding.when, context)
    )
      return
    let action = binding.action,
      value = event.delta ?? event.value
    if (
      action.type === 'transport' &&
      action.cmd === 'forward' &&
      context.holding
    )
      action = { ...action, cmd: 'skipHold' }
    if (action.type === 'param') {
      if (
        !action.id &&
        (action.target === 'track.volume' || action.target === 'track.pan')
      ) {
        const n = /^fader\.(\d+)$/.exec(event.controlId),
          track = n ? p.tracks[Number(n[1]) - 1] : undefined
        if (!track) return
        action = { ...action, id: track.id }
      }
      const current = this.host.parameter(action),
        range = action.max - action.min
      if (current === undefined) return
      const target = range
        ? Math.max(0, Math.min(1, (current - action.min) / range))
        : 0
      if (event.delta !== undefined)
        value = Math.max(0, Math.min(1, target + event.delta / 127))
      else {
        const control = profile.controls.find((c) => c.id === event.controlId)
        if (
          range !== 0 &&
          control?.mode === 'absolute' &&
          !this.pickup.accept(
            `${event.deviceId}:${event.controlId}:${context.activeSceneId}:${JSON.stringify(action)}`,
            value,
            target,
            event.timestamp,
          )
        )
          return
      }
    }
    if (action.type === 'clip') value = event.value
    this.dispatch(binding, event, action, value)
  }
  disconnect(deviceId: string): void {
    this.pickup.clear(`${deviceId}:`)
    for (const [id, pending] of this.pending)
      if (pending.deviceId === deviceId) {
        this.host.cancel(id)
        this.pending.delete(id)
      }
    for (const [key, entry] of this.held)
      if (JSON.parse(key)[0] === deviceId) {
        this.release(entry)
        this.held.delete(key)
      }
  }
  clear(): void {
    for (const id of this.pending.keys()) this.host.cancel(id)
    this.pending.clear()
    for (const entry of this.held.values()) this.release(entry)
    this.held.clear()
    this.pickup.clear()
  }
}
