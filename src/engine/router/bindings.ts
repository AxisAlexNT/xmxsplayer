import { ScheduledQueue } from '../synth/scheduled-queue'
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
  hit?(deviceId: string, controlId: string, velocity: number): void
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
  gateId?: number
  pending: number
  started: boolean
  context: { delta?: number; at?: Timing }
}
export class Bindings {
  private movement = new Map<
    string,
    { binding: string; position: number; time: number; remainder: number }
  >()
  private gates = new ScheduledQueue<() => void>()
  private gateSerial = 0
  private timer?: ReturnType<typeof setTimeout>
  resetMovement() {
    this.movement.clear()
  }
  private armGateTimer() {
    clearTimeout(this.timer)
    const next = this.gates.nextTime
    if (next === undefined) return
    this.timer = setTimeout(
      () => {
        this.gates.drain(performance.now(), (release) => release())
        this.armGateTimer()
      },
      Math.max(0, Math.ceil(next - performance.now())),
    )
  }
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
          action.type === 'note' && event.edge === 'change'
            ? true
            : event.pressed,
          source,
          entry.context,
        )
        if (action.type === 'note' && event.edge === 'change')
          this.host.hit?.(event.deviceId, event.controlId,
            typeof action.velocity === 'number' ? action.velocity : Math.max(1, Math.round(value * 127)))
        if (
          action.type === 'note' &&
          action.gateMs &&
          this.held.get(key) === entry
        ) {
          entry.gateId = ++this.gateSerial
          this.gates.push(
            performance.now() + action.gateMs,
            entry.gateId,
            () => {
              this.held.delete(key)
              this.release(entry)
            },
          )
          this.armGateTimer()
        }
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
    if (entry.gateId !== undefined) this.gates.cancel(entry.gateId)
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
    let hits = 1
    const fromSpeed = action.type === 'note' && action.velocity === 'speed'
    if (
      event.edge === 'change' &&
      (binding.every || binding.direction || fromSpeed)
    ) {
      const key = JSON.stringify([event.deviceId, event.controlId])
      const signature = JSON.stringify(binding)
      const position = Math.round(event.value * 127)
      let state = this.movement.get(key)
      if (!state || state.binding !== signature) {
        state = {
          binding: signature,
          position,
          time: event.timestamp,
          remainder: 0,
        }
        this.movement.set(key, state)
      }
      const delta = event.delta ?? position - state.position
      const elapsed = event.timestamp - state.time
      state.position = position
      state.time = event.timestamp
      if (
        !delta ||
        (binding.direction === 'up' && delta < 0) ||
        (binding.direction === 'down' && delta > 0)
      )
        return
      if (fromSpeed)
        value =
          Math.min(
            127,
            Math.max(
              20,
              elapsed > 0 ? Math.round((Math.abs(delta) * 250) / elapsed) : 20,
            ),
          ) / 127
      if (binding.every) {
        state.remainder += Math.abs(delta)
        hits = Math.floor(state.remainder / binding.every)
        state.remainder %= binding.every
      }
    }
    for (let hit = 0; hit < hits; hit++)
      this.dispatch(binding, event, action, value)
  }
  disconnect(deviceId: string): void {
    for (const key of this.movement.keys())
      if (JSON.parse(key)[0] === deviceId) this.movement.delete(key)
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
    this.resetMovement()
    this.gates.cancel()
    clearTimeout(this.timer)
    for (const entry of this.held.values()) this.release(entry)
    this.held.clear()
    this.pickup.clear()
  }
}
