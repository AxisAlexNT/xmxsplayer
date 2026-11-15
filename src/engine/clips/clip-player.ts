import type { Clip, Timing } from '../../shared/model'
import type { TransportClock } from '../transport/clock'
import type { ClipVoice, VoiceChange } from './clip-voice'
import { clipTone, tempoDeadlines } from './timing'
export type ClipState = 'stopped' | 'queued' | 'playing'
export interface ClipFrame {
  states: Record<string, ClipState>
  progress: Record<string, number>
}
export interface ClipHost {
  clock: TransportClock
  prepare(clip: Clip): Promise<ClipVoice>
  validVoice?(voice: ClipVoice, clip: Clip): boolean
  queue(at: Timing, run: () => void): number
  cancel(id: number): void
  queuedTime(id: number): number | null
  holdDeadline(): number | null
  advance(): void
  report(frame: ClipFrame): void
  warn(message: string): void
}
interface Entry {
  clip: Clip
  voice?: ClipVoice
  loading?: Promise<ClipVoice>
  playing: boolean
  desired: boolean
  held: Set<string>
  pending: number
  transition?: 'start' | 'stop'
  revision: number
  pressure: number
  semitones: number
  gain: number
  plan: string
  plannedAt?: number
  plannedStart?: number
  plannedStop?: number
}
const mediaKey = (clip: Clip): string =>
  JSON.stringify([clip.file, clip.startSec, clip.endSec, clip.toCue])
export class ClipPlayer {
  private entries = new Map<string, Entry>()
  private timer?: ReturnType<typeof setInterval>
  private lastReport = -Infinity
  private signature = ''
  private stateSignature = ''
  private mapSignature = ''
  private retiring = new Map<ClipVoice, ReturnType<typeof setTimeout>>()
  private disposed = false
  private ticking = false
  constructor(private host: ClipHost) {}
  configure(clips: readonly Clip[]): void {
    for (const [id, entry] of this.entries) {
      const clip = clips.find((c) => c.id === id)
      if (
        !clip ||
        mediaKey(clip) !== mediaKey(entry.clip) ||
        (entry.voice &&
          this.host.validVoice &&
          !this.host.validVoice(entry.voice, clip))
      ) {
        this.cancel(entry)
        this.retire(entry)
        this.entries.delete(id)
      }
    }
    for (const clip of clips) {
      let entry = this.entries.get(clip.id)
      if (!entry) {
        entry = {
          clip,
          playing: false,
          desired: false,
          held: new Set(),
          pending: 0,
          revision: 0,
          pressure: 1,
          semitones: clip.semitones,
          gain: clip.gain,
          plan: '',
        }
        this.entries.set(clip.id, entry)
      } else {
        if (entry.clip.semitones !== clip.semitones)
          entry.semitones = clip.semitones
        if (entry.clip.gain !== clip.gain) entry.gain = clip.gain
        entry.clip = clip
      }
    }
    this.tick()
  }
  state(id: string): ClipState {
    const e = this.entries.get(id)
    return !e
      ? 'stopped'
      : e.pending || (e.desired && !e.playing)
        ? 'queued'
        : e.playing
          ? 'playing'
          : 'stopped'
  }
  launch(id: string, pressed = true, value = 1, source = 'action'): void {
    const e = this.entries.get(id)
    if (!e || this.disposed) return
    if (!pressed) {
      if (e.held.delete(source) && !e.held.size) this.stop(id)
      return
    }
    e.pressure = Math.max(0, Math.min(1, value))
    if (e.clip.launch === 'hold') {
      e.held.add(source)
      if (!e.desired) this.start(e, e.clip.quantize, false)
    } else if (e.clip.launch === 'toggle' && e.desired) this.stop(id)
    else
      this.start(
        e,
        e.clip.quantize,
        e.clip.launch === 'retrigger' || e.clip.launch === 'oneShot',
      )
    this.ensureTimer()
    this.tick()
  }
  private start(e: Entry, at: Timing, retrigger: boolean): void {
    this.cancel(e)
    e.desired = true
    if (e.clip.group)
      for (const other of this.entries.values()) {
        if (
          other === e ||
          other.clip.group !== e.clip.group ||
          (!other.transition && (other.playing || !other.desired))
        )
          continue
        if (other.transition === 'stop') continue
        this.cancel(other)
        other.desired = other.playing
        other.held.clear()
        this.render(other)
      }
    if (e.playing && !retrigger) {
      this.tick()
      return
    }
    const revision = e.revision
    const prepared = this.ensure(e)
    void prepared
      .then(() => {
        if (!this.current(e) || e.revision !== revision || !e.desired) return
        let ran = false
        e.transition = 'start'
        e.pending = this.host.queue(at, () => {
          ran = true
          e.pending = 0
          e.transition = undefined
          if (!this.current(e) || e.revision !== revision || !e.desired) return
          if (e.clip.group)
            for (const other of this.entries.values())
              if (other !== e && other.clip.group === e.clip.group)
                this.stopNow(other)
          const preplanned =
            e.plannedStart !== undefined &&
            e.plannedStart <= this.host.clock.now() + 1e-7
          e.plannedStart = undefined
          e.playing = true
          e.plan = ''
          this.render(e, !preplanned)
          this.report(true)
        })
        if (ran) e.pending = 0
        this.tick()
      })
      .catch((error) => {
        if (!this.current(e) || e.revision !== revision) return
        e.desired = false
        e.playing = false
        e.voice?.close()
        e.voice = undefined
        e.held.clear()
        e.transition = undefined
        this.host.warn(`${e.clip.name}: ${String(error)}`)
        this.report(true)
      })
    this.ensureTimer()
  }
  private current(e: Entry): boolean {
    return !this.disposed && this.entries.get(e.clip.id) === e
  }
  private ensure(e: Entry): Promise<ClipVoice> {
    if (e.voice) return Promise.resolve(e.voice)
    if (!e.loading) {
      const key = mediaKey(e.clip)
      e.loading = Promise.resolve()
        .then(() => this.host.prepare(e.clip))
        .then((voice) => {
          if (!this.current(e) || mediaKey(e.clip) !== key) {
            voice.close()
            throw Error('Clip changed while loading')
          }
          e.voice = voice
          return voice
        })
        .finally(() => {
          e.loading = undefined
        })
    }
    return e.loading
  }
  stop(id: string, at?: Timing): void {
    const e = this.entries.get(id)
    if (!e) return
    this.cancel(e)
    e.desired = false
    e.held.clear()
    if (!e.playing) {
      this.render(e)
      this.tick()
      this.report(true)
      return
    }
    let ran = false
    e.transition = 'stop'
    e.pending = this.host.queue(at ?? e.clip.quantize, () => {
      ran = true
      e.pending = 0
      e.transition = undefined
      this.stopNow(e)
      this.tick()
    })
    if (ran) e.pending = 0
    this.ensureTimer()
    this.tick()
  }
  private stopNow(e: Entry): void {
    const preplanned =
      e.plannedStop !== undefined &&
      e.plannedStop <= this.host.clock.now() + 1e-7
    this.cancel(e)
    e.desired = false
    e.playing = false
    e.held.clear()
    e.plan = ''
    if (!preplanned) this.render(e)
    else e.plan = 'stopped'
  }
  stopAll(group?: string): void {
    for (const e of this.entries.values())
      if (group === undefined || e.clip.group === group) this.stopNow(e)
    this.tick()
    this.report(true)
  }
  private cancel(e: Entry): void {
    e.revision++
    if (e.pending) this.host.cancel(e.pending)
    e.pending = 0
    e.transition = undefined
    e.plannedStart = undefined
    e.plannedStop = undefined
    e.plan = ''
  }
  private ensureTimer(): void {
    if (!this.timer && !this.disposed)
      this.timer = setInterval(() => this.tick(), 20)
  }
  tick(): void {
    if (this.disposed || this.ticking) return
    this.ticking = true
    try {
      this.update()
    } finally {
      this.ticking = false
    }
  }
  private update(): void {
    if ([...this.entries.values()].some((e) => e.pending)) this.host.advance()
    const signature = JSON.stringify([
      this.host.clock.map.tempos,
      this.host.clock.map.signatures,
      this.host.clock.loopRange,
    ])
    if (signature !== this.mapSignature) {
      if (this.mapSignature)
        for (const e of this.entries.values())
          if (e.pending) {
            this.cancel(e)
            e.desired = e.playing
          }
      this.mapSignature = signature
    }
    for (const e of this.entries.values()) {
      if (e.pending && this.host.queuedTime(e.pending) === null) {
        this.cancel(e)
        e.desired = e.playing
      }
      if (e.voice?.error) {
        this.host.warn(`${e.clip.name}: ${e.voice.error}`)
        this.stopNow(e)
        e.voice.close()
        e.voice = undefined
      }
      if (
        e.playing &&
        !e.transition &&
        e.voice?.position(this.host.clock.now()).ended
      )
        this.stopNow(e)
      if (e.voice && (e.playing || e.pending || e.desired || !e.plan)) {
        try {
          this.render(e)
        } catch (error) {
          this.cancel(e)
          e.playing = false
          e.desired = false
          e.held.clear()
          e.voice.close()
          e.voice = undefined
          this.host.warn(`${e.clip.name}: ${String(error)}`)
        }
      }
    }
    this.report()
    if (
      ![...this.entries.values()].some(
        (e) => e.playing || e.pending || e.loading || e.desired,
      )
    ) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
  private render(e: Entry, restart = false): void {
    if (!e.voice) return
    const c = this.host.clock,
      now = c.now(),
      hold = this.host.holdDeadline()
    const tone = (at: number) =>
      clipTone(
        e.clip,
        e.voice!.duration,
        c,
        e.semitones,
        e.gain,
        e.pressure,
        at,
      )
    const changes: VoiceChange[] = [
      {
        at: now,
        kind: restart
          ? 'start'
          : !e.playing
            ? 'stop'
            : e.clip.sync && c.holding
              ? 'hold'
              : 'update',
        tone: tone(now),
        ...(restart &&
        e.clip.sync &&
        (c.holding || (hold !== null && hold <= now + 1e-7))
          ? { active: false }
          : {}),
      },
    ]
    const future: { at: number; kind: VoiceChange['kind'] }[] = []
    if (e.clip.sync && e.playing && !c.holding) {
      for (const at of tempoDeadlines(c))
        if (hold === null || at < hold) future.push({ at, kind: 'update' })
      if (hold !== null) future.push({ at: Math.max(now, hold), kind: 'hold' })
    }
    if (!c.holding) {
      if (e.pending && e.transition) {
        const at = this.host.queuedTime(e.pending)
        if (at !== null && (hold === null || at < hold - 1e-7))
          future.push({ at, kind: e.transition })
      }
      if (e.playing && e.clip.group)
        for (const other of this.entries.values()) {
          if (
            other === e ||
            other.clip.group !== e.clip.group ||
            other.transition !== 'start' ||
            !other.pending
          )
            continue
          const at = this.host.queuedTime(other.pending)
          if (at !== null && (hold === null || at < hold - 1e-7))
            future.push({ at, kind: 'stop' })
        }
    }
    e.plannedStart = future.find((change) => change.kind === 'start')?.at
    e.plannedStop = future.find((change) => change.kind === 'stop')?.at
    future.sort((a, b) => a.at - b.at)
    for (const change of future)
      changes.push({ ...change, tone: tone(change.at) })
    // Current position moves continuously; only changes to the plan reschedule it.
    const key = JSON.stringify([
      changes[0].kind === 'start' ? 'start' : changes[0].kind,
      changes[0].tone,
      changes[0].active,
      changes.slice(1),
    ])
    if (
      restart ||
      key !== e.plan ||
      now - (e.plannedAt ?? -Infinity) >=
        (e.voice.alignmentInterval ?? Infinity)
    ) {
      e.plan = key
      e.plannedAt = now
      e.voice.plan(now, changes)
    }
  }
  private report(force = false): void {
    const now = this.host.clock.now()
    const frame: ClipFrame = { states: {}, progress: {} }
    for (const [id, e] of this.entries) {
      frame.states[id] = this.state(id)
      frame.progress[id] = e.playing
        ? (e.voice?.position(now).progress ?? 0)
        : 0
    }
    const states = JSON.stringify(frame.states)
    if (
      !force &&
      states === this.stateSignature &&
      now - this.lastReport < 0.07
    )
      return
    const signature = JSON.stringify(frame)
    if (signature !== this.signature) {
      this.signature = signature
      this.stateSignature = states
      this.lastReport = now
      this.host.report(frame)
    }
  }
  private retire(e: Entry, immediate = false): void {
    const voice = e.voice
    if (!voice) return
    if (immediate) {
      voice.close()
      return
    }
    try {
      const now = this.host.clock.now()
      voice.plan(now, [
        {
          at: now,
          kind: 'stop',
          tone: clipTone(
            e.clip,
            voice.duration,
            this.host.clock,
            e.semitones,
            e.gain,
            e.pressure,
          ),
        },
      ])
      const timer = setTimeout(() => {
        voice.close()
        this.retiring.delete(voice)
      }, e.clip.fadeMs + 20)
      this.retiring.set(voice, timer)
    } catch {
      voice.close()
    }
  }
  reset(immediate = false): void {
    for (const e of this.entries.values()) {
      this.cancel(e)
      this.retire(e, immediate)
    }
    this.entries.clear()
    clearInterval(this.timer)
    this.timer = undefined
    this.signature = ''
    this.mapSignature = ''
    this.report(true)
  }
  close(): void {
    this.reset(true)
    for (const [voice, timer] of this.retiring) {
      clearTimeout(timer)
      voice.close()
    }
    this.retiring.clear()
    this.disposed = true
  }
}
