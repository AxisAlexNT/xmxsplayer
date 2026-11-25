import { replaceRange } from '../../shared/recording'
import type { Project } from '../../shared/model'
import type {
  RecordedTake,
  RecordedTrack,
  RecordingProgress,
  RoutedNote,
} from '../../shared/recording'
import type { TimeMap } from '../../shared/time-map'
import { TransportClock } from './clock'
interface Span {
  context: number
  start: number
  raw: number
  speed: number
  map: TimeMap
  loop: Project['loop']
}
interface Held {
  id: string
  source: string
  channel: number
  trackId: string
  key: number
  velocity: number
  tick: number
}
interface Take extends RecordedTrack {
  changed: boolean
  seeded: boolean
}
export class Recorder {
  private scope = ''
  private spans: Span[] = []
  private enabled = false
  private held = new Map<string, Held>()
  private takes = new Map<string, Take>()
  private controllers = new Map<
    string,
    { cc: Map<number, number>; bend: number; tracks: Set<string> }
  >()
  private loop: Project['loop'] = { enabled: false, startTick: 0, endTick: 1 }
  private map: TimeMap
  private nextWrap = Infinity
  private passStart = 0
  private replace = false
  private collected = new Map<string, RecordedTrack>()
  private serial = 0
  private barEnd = -1
  private progressDirty = false
  private lastProgress = -Infinity
  private startContext = 0
  constructor(
    private clock: TransportClock,
    private project: () => Project | undefined,
    private latencyMs: () => number,
    private emit: (take: RecordedTake) => void,
    private progress?: (value: RecordingProgress) => void,
  ) {
    this.map = clock.map
    this.clockChanged()
  }
  setScope(scope: string): void {
    if (this.scope === scope) return
    this.scope = scope
    this.enabled = false
    this.clock.recording = false
    this.held.clear()
    this.takes.clear()
    this.controllers.clear()
    this.spans = []
    this.clockChanged()
  }
  private owner(source: string, channel: number): string {
    return JSON.stringify([source, channel])
  }
  private state(source: string, channel: number) {
    const id = this.owner(source, channel)
    let state = this.controllers.get(id)
    if (!state) {
      state = {
        cc: new Map<number, number>(),
        bend: 8192,
        tracks: new Set<string>(),
      }
      this.controllers.set(id, state)
    }
    return state
  }
  private rawAt(context: number): number {
    let span = this.spans[0]
    for (let i = this.spans.length - 1; i >= 0; i--)
      if (this.spans[i].context <= context) {
        span = this.spans[i]
        break
      }
    return span
      ? span.raw + Math.max(0, context - span.start) * span.speed
      : this.clock.raw
  }
  private corrected(when = this.clock.now()): number {
    return this.rawAt(when - this.latencyMs() / 1000)
  }
  private tickAt(raw: number): number {
    const start = this.map.tickToSec(this.loop.startTick),
      end = this.map.tickToSec(this.loop.endTick),
      length = end - start
    const song =
      this.loop.enabled && raw >= end
        ? start + ((((raw - end) % length) + length) % length)
        : raw
    return Math.max(0, Math.round(this.map.secToTick(song)))
  }
  private setup(raw: number): void {
    this.map = this.clock.map
    this.loop = { ...this.clock.loopRange }
    const start = this.map.tickToSec(this.loop.startTick),
      end = this.map.tickToSec(this.loop.endTick),
      length = end - start
    this.nextWrap =
      this.loop.enabled && length > 0
        ? raw < end
          ? end
          : end + (Math.floor((raw - end) / length) + 1) * length
        : Infinity
  }
  clockChanged(): void {
    const now = this.clock.now(),
      previous = this.spans.at(-1),
      expected = previous
        ? previous.raw + Math.max(0, now - previous.start) * previous.speed
        : this.clock.raw
    const loop = this.clock.loopRange,
      mapChanged =
        previous &&
        previous.map !== this.clock.map &&
        JSON.stringify(previous.map.tempos) !==
          JSON.stringify(this.clock.map.tempos)
    const jumped =
      !!previous &&
      (Math.abs(expected - this.clock.raw) > 1e-5 ||
        mapChanged ||
        JSON.stringify(previous.loop) !== JSON.stringify(loop))
    const wants = this.clock.playing && this.clock.recording
    if (this.enabled && (!wants || jumped)) {
      this.finish(this.corrected())
      this.enabled = false
      if (jumped) this.spans = []
    }
    this.spans.push({
      context: now,
      start: Math.max(now, this.clock.contextAt(this.clock.raw)),
      raw: this.clock.raw,
      speed: this.clock.playing && !this.clock.holding ? this.clock.speed : 0,
      map: this.clock.map,
      loop: { ...loop },
    })
    const cutoff = now - Math.max(1, this.latencyMs() / 1000 + 1)
    while (this.spans.length > 2 && this.spans[1].context < cutoff)
      this.spans.shift()
    if (wants && !this.enabled) {
      this.enabled = true
      this.serial++
      this.barEnd = -1
      this.progressDirty = false
      this.lastProgress = -Infinity
      this.startContext = Math.max(now, this.clock.contextAt(this.clock.raw))
      if (jumped) this.clock.punchRaw = this.clock.raw
      this.setup(this.corrected())
      this.passStart = this.tickAt(
        Math.max(this.corrected(), this.clock.punchRaw),
      )
      this.replace = this.project()?.record?.mode === 'replace'
      this.collected.clear()
    }
    if (this.enabled) this.tick()
  }
  private ready(when: number): boolean {
    return (
      this.enabled &&
      this.corrected(when) >= this.clock.punchRaw &&
      when >= this.startContext - 1e-6
    )
  }
  private take(trackId: string): Take {
    let take = this.takes.get(trackId)
    if (!take) {
      take = { trackId, notes: [], events: [], changed: false, seeded: false }
      this.takes.set(trackId, take)
    }
    return take
  }
  private seed(
    trackId: string,
    state: ReturnType<Recorder['state']>,
    tick: number,
  ): void {
    const take = this.take(trackId)
    if (take.seeded) return
    take.seeded = true
    // Live controls can precede the first note. Seed each missing controller independently.
    const recordedCc = new Set(take.events.filter(e => e.type === 'cc').map(e => e.num))
    if (!recordedCc.has(64)) take.events.push({
      tick,
      type: 'cc',
      num: 64,
      value: state.cc.get(64) ?? 0,
    })
    if (state.cc.has(1) && !recordedCc.has(1))
      take.events.push({ tick, type: 'cc', num: 1, value: state.cc.get(1)! })
    if (state.bend !== 8192 && !take.events.some(e => e.type === 'bend'))
      take.events.push({ tick, type: 'bend', num: 0, value: state.bend })
  }
  note(note: RoutedNote): void {
    const when = note.when ?? this.clock.now()
    if (!this.enabled) return
    const raw = this.corrected(when)
    this.advance(raw)
    if (note.on) {
      const track = this.project()?.tracks.find((t) => t.id === note.trackId)
      if (track?.kind !== 'midi' || !track.armed || !this.ready(when)) return
      const tick = this.tickAt(raw),
        state = this.state(note.source, note.channel)
      this.seed(note.trackId, state, tick)
      if ((state.cc.get(64) ?? 0) >= 64) state.tracks.add(note.trackId)
      this.held.set(note.id, { ...note, tick })
    } else {
      const held = this.held.get(note.id)
      if (!held) return
      this.close(held, this.tickAt(raw))
      this.held.delete(note.id)
    }
    this.progressDirty = true
    this.reportProgress(raw, when)
  }
  control(
    source: string,
    channel: number,
    type: 'cc' | 'bend',
    num: number,
    value: number,
    trackIds: Iterable<string>,
    when = this.clock.now(),
  ): void {
    if (type === 'cc' && num !== 64 && num !== 1) return
    const ready = this.ready(when)
    const raw = this.corrected(when)
    if (ready) this.advance(raw)
    const state = this.state(source, channel)
    if (type === 'cc') state.cc.set(num, value)
    else state.bend = value
    if (!ready) return
    const targets = new Set(trackIds)
    for (const held of this.held.values())
      if (held.source === source && held.channel === channel)
        targets.add(held.trackId)
    if ((state.cc.get(64) ?? 0) >= 64 || (type === 'cc' && num === 64))
      for (const id of state.tracks) targets.add(id)
    const tick = this.tickAt(raw)
    for (const id of targets) {
      const t = this.project()?.tracks.find((t) => t.id === id)
      if (t?.kind !== 'midi' || (!t.armed && !this.takes.has(id))) continue
      const take = this.take(id)
      take.events.push({ tick, type, num, value })
      take.changed = true
      if ((state.cc.get(64) ?? 0) >= 64) state.tracks.add(id)
    }
    if (type === 'cc' && num === 64 && value < 64) state.tracks.clear()
  }
  private close(held: Held, end: number): void {
    const take = this.take(held.trackId)
    take.notes.push([
      held.tick,
      Math.max(1, end - held.tick),
      held.key,
      held.velocity,
    ])
    take.changed = true
  }
  private releasePedals(tick: number): void {
    for (const state of this.controllers.values())
      if ((state.cc.get(64) ?? 0) >= 64)
        for (const id of state.tracks) {
          const take = this.takes.get(id)
          if (take) take.events.push({ tick, type: 'cc', num: 64, value: 0 })
        }
  }
  private send(end: number, final: boolean): void {
    if (this.replace) {
      if (end > this.passStart) {
        const covered: [number, number][] = [[this.passStart, end]]
        for (const track of this.project()?.tracks ?? []) {
          if (track.kind !== 'midi' || !track.armed) continue
          const prev = this.collected.get(track.id)
          const kept = replaceRange(
            prev?.notes ?? [],
            prev?.events ?? [],
            covered,
          )
          const take = this.takes.get(track.id)
          this.collected.set(track.id, {
            trackId: track.id,
            covered: [...(prev?.covered ?? []), ...covered],
            notes: [...kept.notes, ...(take?.notes ?? [])],
            events: [...kept.events, ...(take?.events ?? [])],
          })
        }
      }
      this.takes.clear()
      if (final && this.collected.size)
        this.emit({
          takeId: `take-${this.serial}`,
          scope: this.scope,
          mode: 'replace',
          stopTick: end,
          tracks: [...this.collected.values()],
        })
      return
    }
    const tracks = [...this.takes.values()]
      .filter((t) => t.changed)
      .map(({ trackId, notes, events }) => ({
        trackId,
        covered: (end > this.passStart ? [[this.passStart, end]] : []) as [
          number,
          number,
        ][],
        notes: notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]),
        events: events.sort((a, b) => a.tick - b.tick),
      }))
    this.takes.clear()
    if (tracks.length)
      this.emit({ takeId: `take-${this.serial}`, scope: this.scope, ...(final && { stopTick: end }), tracks })
  }
  private advance(raw: number): void {
    const length =
      this.map.tickToSec(this.loop.endTick) -
      this.map.tickToSec(this.loop.startTick)
    while (this.enabled && this.loop.enabled && raw >= this.nextWrap - 1e-9) {
      for (const held of this.held.values()) this.close(held, this.loop.endTick)
      this.releasePedals(this.loop.endTick)
      this.send(this.loop.endTick, false)
      if (!this.replace) this.serial++
      this.barEnd = -1
      this.progressDirty = true
      this.passStart = this.loop.startTick
      for (const held of this.held.values()) {
        held.tick = this.loop.startTick
        this.seed(
          held.trackId,
          this.state(held.source, held.channel),
          held.tick,
        )
      }
      this.nextWrap += length
    }
  }
  coverage(): [number, number][] | undefined {
    if (!this.replace || !this.enabled) return undefined
    const raw = this.corrected()
    if (raw < this.clock.punchRaw) return []
    const prior = this.collected.values().next().value?.covered ?? []
    return [...prior, [this.passStart, this.tickAt(raw)]]
  }
  private reportProgress(raw: number, when: number): void {
    if (!this.progress || !this.ready(when)) return
    const map = this.map
    const boundary = map.barToTick(map.tickToBarBeat(this.tickAt(raw)).bar)
    if (boundary === this.barEnd && (!this.progressDirty || when - this.lastProgress < 0.1)) return
    this.barEnd = boundary
    this.lastProgress = when
    this.progressDirty = false
    const tracks = [...this.takes.values()].map(take => ({
      trackId: take.trackId,
      closed: take.notes.slice(),
      open: [...this.held.values()].filter(h => h.trackId === take.trackId)
        .map(h => ({ key: h.key, tick: h.tick, vel: h.velocity })),
    }))
    this.progress({ takeId: `take-${this.serial}`, scope: this.scope, barEnd: boundary, tracks })
  }
  tick(): void {
    if (!this.enabled) return
    const raw = this.corrected()
    this.advance(raw)
    this.reportProgress(raw, this.clock.now())
  }
  private finish(raw: number): void {
    this.advance(raw)
    const tick = this.tickAt(raw)
    for (const held of this.held.values()) this.close(held, tick)
    this.held.clear()
    this.releasePedals(tick)
    this.send(tick, true)
  }
  disconnect(source: string): void {
    const raw = this.corrected()
    if (this.enabled) this.advance(raw)
    for (const [id, held] of this.held)
      if (held.source === source) {
        this.close(held, this.tickAt(raw))
        this.progressDirty = true
        this.held.delete(id)
      }
    for (const [id, state] of this.controllers)
      if (JSON.parse(id)[0] === source) {
        for (const trackId of state.tracks) {
          const take = this.takes.get(trackId)
          if (take)
            take.events.push({
              tick: this.tickAt(raw),
              type: 'cc',
              num: 64,
              value: 0,
            })
        }
        this.controllers.delete(id)
      }
  }
}
