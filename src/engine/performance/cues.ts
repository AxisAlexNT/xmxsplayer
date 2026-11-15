import type { Action, Cue, Timing } from '../../shared/model'
import type { TransportClock } from '../transport/clock'
import type {
  SchedulerTimeline,
  TimelineBoundary,
} from '../transport/scheduler'

export interface CueHost {
  clock: TransportClock
  queue(at: Timing, run: () => void): number
  cancel(id: number): void
  isQueued(id: number): boolean
  invalidate(): void
  changed(): void
  run(action: Action): void
  seek(tick: number): void
  warn?(message: string): void
}
interface Arrival extends TimelineBoundary {
  cue: Cue
  key: string
}
interface PendingCue {
  signature: string
  cueId: string
  tick: number
  actions: Action[]
}
export class Cues implements SchedulerTimeline {
  chaseOnSeek = true
  private cues: Cue[] = []
  private signature = ''
  private clockSignature = ''
  private floor = 0
  private seen = new Map<string, number>()
  private armed: Arrival | null = null
  private waiting = false
  private pending = new Map<number, PendingCue>()
  private firing = new Set<string>()
  constructor(private host: CueHost) {}
  get armedId(): string | null {
    return this.armed?.cue.id ?? null
  }
  get holding(): boolean {
    return this.waiting
  }
  get queuedIds(): string[] {
    this.collectPending()
    return [...new Set([...this.pending.values()].map((p) => p.cueId))]
  }
  get pendingActions(): { action: Action; tick: number }[] {
    this.collectPending()
    return [...this.pending.values()].flatMap((p) =>
      p.actions.map((action) => ({ action, tick: p.tick })),
    )
  }
  private collectPending(): void {
    for (const id of this.pending.keys())
      if (!this.host.isQueued(id)) this.pending.delete(id)
  }
  configure(cues: readonly Cue[]): void {
    const clockSignature = JSON.stringify([
      this.host.clock.map.tempos,
      this.host.clock.map.signatures,
      this.host.clock.loopRange,
    ])
    const signature = JSON.stringify([cues, clockSignature])
    if (signature === this.signature) return
    this.signature = signature
    if (clockSignature !== this.clockSignature) {
      this.clockSignature = clockSignature
      this.cancelPending()
      this.disarm()
      this.seen.clear()
    }
    const old = this.armed
    this.cues = [...cues].sort(
      (a, b) => a.tick - b.tick || a.id.localeCompare(b.id),
    )
    this.floor = this.host.clock.raw
    for (const [id, pending] of this.pending)
      if (
        !this.cues.some(
          (c) =>
            c.id === pending.cueId && JSON.stringify(c) === pending.signature,
        )
      ) {
        this.host.cancel(id)
        this.pending.delete(id)
      }
    if (old) {
      const replacement = this.cues.find((c) => c.id === old.cue.id)
      if (
        !replacement ||
        JSON.stringify(replacement) !== JSON.stringify(old.cue)
      )
        this.disarm()
    }
    this.host.invalidate()
    this.host.changed()
  }
  private occurrence(cue: Cue): Arrival | null {
    const c = this.host.clock,
      sec = c.map.tickToSec(cue.tick),
      loop = c.loopRange
    const start = c.map.tickToSec(loop.startTick),
      end = c.map.tickToSec(loop.endTick),
      length = end - start
    if (loop.enabled && (sec >= end - 1e-9 || length <= 0)) return null
    const repeats = loop.enabled && sec >= start - 1e-9
    let cycle = repeats
      ? Math.max(0, Math.ceil((this.floor - sec - 1e-9) / length))
      : 0
    for (let attempt = 0; attempt <= this.seen.size; attempt++, cycle++) {
      const raw = sec + (repeats ? cycle * length : 0),
        key = `${cue.id}:${cue.tick}:${cycle}`
      if (raw < this.floor - 1e-9) return null
      if (!this.seen.has(key))
        return {
          raw,
          key,
          cue,
          hold: cue.trigger === 'wait',
          run: () => this.arrive(cue, key, raw),
        }
      if (!repeats) return null
    }
    return null
  }
  next(waitOnly = false): Arrival | null {
    let next: Arrival | null = null
    for (const cue of this.cues) {
      if (waitOnly && cue.trigger !== 'wait') continue
      const arrival = this.occurrence(cue)
      if (arrival && (!next || arrival.raw < next.raw)) next = arrival
    }
    return next
  }
  private arrive(cue: Cue, key: string, raw: number): void {
    this.floor = raw
    this.seen.set(key, raw)
    const loop = this.host.clock.loopRange,
      map = this.host.clock.map
    const length = map.tickToSec(loop.endTick) - map.tickToSec(loop.startTick)
    if (loop.enabled)
      for (const [id, time] of this.seen)
        if (time < raw - length) this.seen.delete(id)
    this.armed = null
    this.waiting = false
    if (cue.trigger === 'auto') this.execute(cue, true)
    else {
      this.armed = {
        cue,
        key,
        raw,
        hold: cue.trigger === 'wait',
        run: () => undefined,
      }
      this.waiting = cue.trigger === 'wait'
      if (this.waiting) this.host.invalidate()
    }
    this.host.changed()
  }
  private disarm(): void {
    this.armed = null
    if (this.waiting) {
      this.waiting = false
      this.host.clock.release()
      this.host.invalidate()
    }
  }
  control(controlId: string, pressed: boolean): boolean {
    if (
      !pressed ||
      !this.armed?.cue.control ||
      this.armed.cue.control !== controlId
    )
      return false
    this.fire(this.armed.cue.id)
    return true
  }
  key(liveZone: boolean): boolean {
    if (!liveZone || !this.waiting || !this.armed || this.armed.cue.control)
      return false
    this.fire(this.armed.cue.id)
    return true
  }
  skip(): boolean {
    if (!this.waiting || !this.armed) return false
    this.fire(this.armed.cue.id)
    return true
  }
  private execute(cue: Cue, automatic = false): void {
    if (this.queuedIds.includes(cue.id) || this.firing.has(cue.id)) return
    let at = cue.at ?? 'now'
    const map = this.host.clock.map
    if (
      automatic &&
      ((at === 'beat' &&
        Math.abs(map.nextBeat(cue.tick, true) - cue.tick) < 1e-7) ||
        (at === 'bar' &&
          Math.abs(map.nextBar(cue.tick, true) - cue.tick) < 1e-7))
    )
      at = 'now'
    const tick =
      at === 'now' || !this.host.clock.playing
        ? this.host.clock.tick
        : at === 'beat'
          ? map.nextBeat(this.host.clock.tick)
          : map.nextBar(this.host.clock.tick)
    let id = 0,
      ran = false
    id = this.host.queue(at, () => {
      ran = true
      this.pending.delete(id)
      this.firing.add(cue.id)
      try {
        for (const [index, action] of cue.actions.entries()) {
          try {
            this.host.run(action)
          } catch (reason) {
            this.host.warn?.(
              `${cue.name}, action ${index + 1}: ${String(reason)}`,
            )
          }
        }
      } finally {
        this.firing.delete(cue.id)
        this.host.changed()
      }
    })
    if (id && !ran)
      this.pending.set(id, {
        cueId: cue.id,
        tick,
        actions: cue.actions,
        signature: JSON.stringify(cue),
      })
    this.host.changed()
  }
  fire(id?: string): void {
    const selected = id ? this.cues.find((c) => c.id === id) : undefined
    if (id && !selected) return
    const arrival = selected
      ? this.armed?.cue.id === id
        ? this.armed
        : this.occurrence(selected)
      : (this.armed ?? this.next())
    const cue = selected ?? arrival?.cue
    if (!cue || this.queuedIds.includes(cue.id) || this.firing.has(cue.id))
      return
    if (arrival) this.seen.set(arrival.key, arrival.raw)
    if (this.armed?.cue.id === cue.id) this.disarm()
    this.execute(cue)
  }
  navigate(direction: 'prev' | 'next'): void {
    const tick = this.host.clock.tick
    const cue =
      direction === 'prev'
        ? this.cues.filter((c) => c.tick < tick - 1e-7).at(-1)
        : this.cues.find((c) => c.tick > tick + 1e-7)
    if (cue) this.host.seek(cue.tick)
  }
  seek(): void {
    this.cancelPending()
    this.disarm()
    this.seen.clear()
    this.floor = this.host.clock.raw
    if (this.chaseOnSeek) {
      const last = this.cues
        .filter(
          (c) =>
            c.tick < this.host.clock.tick - 1e-7 &&
            c.actions.some((a) => a.type === 'scene'),
        )
        .at(-1)
      for (const action of last?.actions ?? [])
        if (
          action.type === 'scene' ||
          action.type === 'register' ||
          action.type === 'trackMode'
        )
          this.host.run(action)
    }
    this.host.changed()
  }
  private cancelPending(): void {
    for (const id of this.pending.keys()) this.host.cancel(id)
    this.pending.clear()
  }
  pause(): void {
    if (!this.waiting || !this.armed) return
    const key = this.armed.key
    this.disarm()
    this.seen.delete(key)
    this.floor = this.host.clock.raw
  }
  stop(): void {
    this.pause()
    this.cancelPending()
    this.disarm()
    this.host.changed()
  }
  reset(): void {
    this.stop()
    this.seen.clear()
    this.floor = this.host.clock.raw
    this.signature = ''
    this.cues = []
  }
}
