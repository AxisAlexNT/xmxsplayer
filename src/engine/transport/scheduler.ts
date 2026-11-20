import type { MidiTrack, Note, Project } from '../../shared/model'
import { TransportClock } from './clock'
export interface ScheduledNote {
  id: string
  track: MidiTrack
  note: Note
  start: number
  end: number
  cycle: number
}
export interface SchedulerOutput {
  noteOn(note: ScheduledNote, when: number): void
  noteOff(note: ScheduledNote, when: number): void
  event(
    track: MidiTrack,
    event: MidiTrack['events'][number],
    when: number,
  ): void
  beat(tick: number, when: number): void
  boundary(when: number): void
  reset(keepHeld: boolean): void
  hasNote(id: string): boolean
  chase(track: MidiTrack, tick: number, when: number): void
  collect(now: number): void
}
export interface TimelineBoundary {
  raw: number
  hold: boolean
  run(): void
}
export interface SchedulerTimeline {
  next(waitOnly?: boolean): TimelineBoundary | null
}
interface MusicalEvent {
  sec: number
  order: number
  track: MidiTrack
  index?: number
  note?: Note
  event?: MidiTrack['events'][number]
  on?: boolean
}
interface PendingAction {
  id: number
  raw: number
  run: () => void
}
export class Scheduler {
  private events: MusicalEvent[] = []
  private project?: Project
  private scheduledUntil = 0
  private needChase = true
  private actions: PendingAction[] = []
  private actionSerial = 0
  private holdRaw: number | null = null
  private ticking = false
  following = false
  timeline?: SchedulerTimeline
  onBoundary: () => void = () => undefined
  onEnd: () => void = () => undefined
  constructor(
    readonly clock: TransportClock,
    private output: SchedulerOutput,
  ) {}
  setProject(project: Project, keepHeld = false): void {
    this.project = project
    this.events = []
    for (const track of project.tracks) {
      if (track.kind !== 'midi') continue
      track.notes.forEach((note, index) => {
        this.events.push({
          sec: this.clock.map.tickToSec(note[0]),
          order: 2,
          track,
          index,
          note,
          on: true,
        })
        this.events.push({
          sec: this.clock.map.tickToSec(note[0] + note[1]),
          order: 0,
          track,
          index,
          note,
          on: false,
        })
      })
      for (const event of track.events)
        this.events.push({
          sec: this.clock.map.tickToSec(event.tick),
          order: 1,
          track,
          event,
        })
    }
    this.events.sort((a, b) => a.sec - b.sec || a.order - b.order)
    this.invalidate(keepHeld)
  }
  private plays(track: MidiTrack, raw = this.clock.raw): boolean {
    return (
      track.mode === 'auto' &&
      !(
        track.armed &&
        this.clock.recording &&
        this.project?.record?.mode === 'replace' &&
        raw >= this.clock.punchRaw
      ) &&
      (!this.project?.tracks.some((t) => t.solo) || track.solo)
    )
  }
  invalidate(keepHeld = false): void {
    this.output.reset(keepHeld)
    this.scheduledUntil = this.clock.raw
    this.needChase = true
  }
  queue(at: 'now' | 'beat' | 'bar', run: () => void): number {
    if (at === 'now' || !this.clock.playing) {
      run()
      return 0
    }
    const tick = this.clock.tick,
      song = this.clock.songAt()
    const target =
      at === 'beat'
        ? this.clock.map.nextBeat(tick)
        : this.clock.map.nextBar(tick)
    let delta = this.clock.map.tickToSec(target) - song
    const loop = this.clock.loopRange
    if (loop.enabled)
      delta = Math.min(delta, this.clock.map.tickToSec(loop.endTick) - song)
    const raw = this.clock.raw + Math.max(0, delta)
    const id = ++this.actionSerial
    this.actions.push({ id, raw, run })
    this.actions.sort((a, b) => a.raw - b.raw)
    // Nothing beyond this boundary may use the old routing.
    this.invalidate(true)
    return id
  }
  isQueued(id: number): boolean {
    return this.actions.some((a) => a.id === id)
  }
  cancelAction(id: number): void {
    this.actions = this.actions.filter((a) => a.id !== id)
  }
  clearActions(): void {
    this.actions = []
  }
  holdAt(tick: number | null): void {
    this.holdRaw =
      tick === null
        ? null
        : this.clock.raw +
          Math.max(0, this.clock.map.tickToSec(tick) - this.clock.songAt())
    this.invalidate(true)
  }
  releaseHold(): void {
    this.holdRaw = null
    this.clock.release()
    this.invalidate(true)
  }
  private cycle(raw: number): number {
    const loop = this.clock.loopRange
    const end = this.clock.map.tickToSec(loop.endTick),
      start = this.clock.map.tickToSec(loop.startTick)
    return loop.enabled && raw >= end - 1e-9
      ? Math.floor((raw - end) / (end - start) + 1e-9) + 1
      : 0
  }
  private descriptor(event: MusicalEvent, cycle: number): ScheduledNote {
    return {
      id: `${cycle}:${event.track.id}:${event.index}`,
      track: event.track,
      note: event.note!,
      start: event.note![0],
      end: event.note![0] + event.note![1],
      cycle,
    }
  }
  private chase(raw: number, when: number): void {
    const tick = this.clock.map.secToTick(this.clock.songAt(raw)),
      cycle = this.cycle(raw)
    const tracks = new Set(this.events.map((e) => e.track))
    for (const track of tracks) {
      if (!this.plays(track, raw)) continue
      this.output.chase(track, tick, when)
      track.notes.forEach((note, index) => {
        const id = `${cycle}:${track.id}:${index}`
        if (
          note[0] < tick - 1e-7 &&
          note[0] + note[1] > tick + 1e-7 &&
          !this.output.hasNote(id)
        )
          this.output.noteOn(
            { id, track, note, start: note[0], end: note[0] + note[1], cycle },
            when,
          )
      })
    }
  }
  tick(lookahead = 0.12): void {
    if (this.ticking) return
    this.ticking = true
    try {
      this.schedule(lookahead)
    } finally {
      this.ticking = false
    }
  }
  private schedule(lookahead: number): void {
    const now = this.clock.now()
    this.output.collect(now)
    if (!this.clock.playing || this.clock.holding) return
    let rawNow = this.clock.raw
    let boundary = this.timeline?.next() ?? null
    let boundaries = 0
    while (boundaries++ < 1000) {
      const action = this.actions[0]
      const nextRaw = Math.min(
        action?.raw ?? Infinity,
        boundary?.raw ?? Infinity,
        this.holdRaw ?? Infinity,
      )
      if (nextRaw > rawNow + 1e-9 || this.clock.contextAt(nextRaw) > now + 1e-9)
        break
      if (
        this.holdRaw !== null &&
        this.holdRaw === nextRaw &&
        action?.raw !== nextRaw &&
        boundary?.raw !== nextRaw
      ) {
        this.clock.hold(this.holdRaw)
        this.onBoundary()
        return
      }
      if (action?.raw === nextRaw) {
        this.actions.shift()
        action.run()
      } else if (boundary) {
        if (boundary.hold) this.clock.hold(boundary.raw)
        boundary.run()
      }
      this.onBoundary()
      if (!this.clock.playing || this.clock.holding) return
      rawNow = this.clock.raw
      boundary = this.timeline?.next() ?? null
    }
    const horizon =
      this.following ||
      this.timeline?.next(true) ||
      this.project?.follow.mode !== 'written'
        ? Math.min(lookahead, 0.04)
        : lookahead
    let until = rawNow + horizon * this.clock.speed
    if (this.holdRaw !== null) until = Math.min(until, this.holdRaw)
    if (boundary) until = Math.min(until, boundary.raw)
    if (this.actions[0]) until = Math.min(until, this.actions[0].raw)
    if (!this.clock.loopRange.enabled && this.project)
      until = Math.min(
        until,
        this.clock.map.tickToSec(this.project.lengthTicks),
      )
    if (this.needChase) {
      this.chase(rawNow, Math.max(now, this.clock.contextAt(rawNow)))
      this.needChase = false
    }
    let cursor = this.scheduledUntil
    const loop = this.clock.loopRange
    let iterations = 0
    while (cursor < until - 1e-9 && iterations++ < 10000) {
      const startSong = this.clock.songAt(cursor),
        cycle = this.cycle(cursor)
      const loopEnd = this.clock.map.tickToSec(loop.endTick)
      const distance = loop.enabled
        ? Math.max(0, loopEnd - startSong)
        : Infinity
      const end = Math.min(until, cursor + distance)
      if (end <= cursor + 1e-10) break
      const endSong = startSong + (end - cursor)
      for (const event of this.events) {
        if (event.sec < startSong - 1e-9) continue
        if (event.sec >= endSong - 1e-9) break
        const when = this.clock.contextAt(cursor + event.sec - startSong)
        if (event.event) {
          if (this.plays(event.track, cursor + event.sec - startSong))
            this.output.event(event.track, event.event, when)
        } else {
          const note = this.descriptor(event, cycle)
          if (event.on) {
            if (
              this.plays(event.track, cursor + event.sec - startSong) &&
              !this.output.hasNote(note.id)
            )
              this.output.noteOn(note, when)
          } else if (this.output.hasNote(note.id))
            this.output.noteOff(note, when)
        }
      }
      const punch = this.clock.punchRaw
      if (
        this.clock.recording &&
        this.project?.record?.mode === 'replace' &&
        cursor < punch &&
        punch <= end
      ) {
        const when = this.clock.contextAt(punch)
        for (const track of this.project.tracks)
          if (track.kind === 'midi' && track.armed) {
            this.output.event(
              track,
              {
                tick: this.clock.map.secToTick(this.clock.songAt(punch)),
                type: 'cc',
                num: 64,
                value: 0,
              },
              when,
            )
          }
        for (const e of this.events)
          if (e.on && e.track.armed) {
            const note = this.descriptor(e, cycle)
            if (this.output.hasNote(note.id)) this.output.noteOff(note, when)
          }
      }
      let beat = this.clock.map.nextBeat(
        this.clock.map.secToTick(startSong),
        true,
      )
      while (this.clock.map.tickToSec(beat) < endSong - 1e-9) {
        this.output.beat(
          beat,
          this.clock.contextAt(
            cursor + this.clock.map.tickToSec(beat) - startSong,
          ),
        )
        beat = this.clock.map.nextBeat(beat)
      }
      const wraps = loop.enabled && end >= cursor + distance - 1e-9
      if (wraps) {
        this.output.boundary(this.clock.contextAt(end))
        this.chase(end, this.clock.contextAt(end))
      }
      cursor = end
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, cursor)
    if (
      !loop.enabled &&
      this.project &&
      rawNow >= this.clock.map.tickToSec(this.project.lengthTicks) - 1e-9
    ) {
      this.output.boundary(now)
      this.clock.pause()
      this.onEnd()
    }
  }
  queuedTime(id: number): number | null {
    const action = this.actions.find((action) => action.id === id)
    return action ? this.clock.contextAt(action.raw) : null
  }
  holdDeadline(): number | null {
    if (!this.clock.playing || this.clock.holding) return null
    const raw = Math.min(
      this.holdRaw ?? Infinity,
      this.timeline?.next(true)?.raw ?? Infinity,
    )
    return Number.isFinite(raw) ? this.clock.contextAt(raw) : null
  }
  audioDeadline(): number | null {
    if (!this.clock.playing || this.clock.holding) return null
    const targets: number[] = []
    if (this.holdRaw !== null) targets.push(this.holdRaw)
    const wait = this.timeline?.next(true)
    if (wait) targets.push(wait.raw)
    if (!this.clock.loopRange.enabled && this.project)
      targets.push(this.clock.map.tickToSec(this.project.lengthTicks))
    return targets.length ? this.clock.contextAt(Math.min(...targets)) : null
  }
  nextDeadline(): number | null {
    const candidates = [
      this.holdRaw,
      this.actions[0]?.raw,
      this.timeline?.next()?.raw,
    ].filter((v): v is number => typeof v === 'number')
    if (!this.clock.loopRange.enabled && this.project)
      candidates.push(this.clock.map.tickToSec(this.project.lengthTicks))
    if (!this.clock.playing || this.clock.holding || !candidates.length)
      return null
    return this.clock.contextAt(Math.min(...candidates))
  }
}
