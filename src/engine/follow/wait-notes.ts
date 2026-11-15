import {
  expectedOnsets,
  type ExpectedOnset,
} from '../../shared/expected-onsets'
import type { Project } from '../../shared/model'
import type { RoutedNote } from '../../shared/recording'
import type { TransportClock } from '../transport/clock'
import type {
  SchedulerTimeline,
  TimelineBoundary,
} from '../transport/scheduler'
interface Arrival {
  onset: ExpectedOnset
  raw: number
  met: boolean
  matchedFrom?: number
}
interface Press {
  key: number
  trackId: string
  when: number
}
export interface WaitHost {
  clock: TransportClock
  invalidate(): void
  changed(): void
}
export class WaitNotes implements SchedulerTimeline {
  private onsets: ExpectedOnset[] = []
  private options?: Project['follow']
  private enabled = false
  private signature = ''
  private clockSignature = ''
  private floor = 0
  private consumed = -Infinity
  private arrival?: Arrival
  private waiting = false
  private down = new Map<string, Press>()
  private wasPlaying = false
  private length = 0
  constructor(private host: WaitHost) {}
  get holding(): boolean {
    return this.waiting
  }
  get expected(): ExpectedOnset | null {
    this.next()
    return this.enabled ? (this.arrival?.onset ?? null) : null
  }
  configure(project: Project): boolean {
    const onsets = expectedOnsets(project),
      signature = JSON.stringify([onsets, project.follow, project.lengthTicks])
    if (signature === this.signature) return false
    this.signature = signature
    this.options = project.follow
    this.onsets = onsets
    this.enabled = project.follow.mode === 'waitNotes'
    this.length = project.lengthTicks
    this.reset()
    this.host.invalidate()
    return true
  }
  reset(): void {
    if (this.waiting) this.host.clock.release()
    this.waiting = false
    this.arrival = undefined
    this.down.clear()
    this.floor = this.host.clock.raw
    this.consumed = -Infinity
  }
  pause(): void {
    if (this.wasPlaying && !this.host.clock.playing) this.reset()
    this.wasPlaying = this.host.clock.playing
  }
  private find(): Arrival | undefined {
    const c = this.host.clock,
      map = c.map,
      loop = c.loopRange
    const reference = Math.max(
      this.floor,
      Number.isFinite(this.consumed) ? this.consumed + 1e-7 : this.floor,
    )
    const song = c.songAt(reference),
      end = map.tickToSec(loop.endTick),
      start = map.tickToSec(loop.startTick)
    for (const onset of this.onsets) {
      if (
        onset.tick >= this.length ||
        (loop.enabled && onset.tick >= loop.endTick)
      )
        continue
      const sec = map.tickToSec(onset.tick),
        raw = reference + sec - song
      if (sec >= song - 1e-9 && raw > this.consumed + 1e-9)
        return { onset, raw, met: false }
    }
    if (loop.enabled && end > start)
      for (const onset of this.onsets) {
        if (
          onset.tick < loop.startTick ||
          onset.tick >= loop.endTick ||
          onset.tick >= this.length
        )
          continue
        return {
          onset,
          raw: reference + end - song + map.tickToSec(onset.tick) - start,
          met: false,
        }
      }
  }
  next(waitOnly = false): TimelineBoundary | null {
    this.pause()
    const c = this.host.clock
    if (!this.enabled || !c.playing) return null
    const signature = JSON.stringify([c.map.tempos, c.loopRange])
    if (signature !== this.clockSignature) {
      this.clockSignature = signature
      this.reset()
    }
    if (!this.arrival) this.arrival = this.find()
    const arrival = this.arrival
    if (
      arrival?.met &&
      !this.waiting &&
      arrival.matchedFrom !== undefined &&
      arrival.matchedFrom <
        c.contextAt(arrival.raw) - this.options!.earlyMs / 1000 - 1e-9
    )
      arrival.met = false
    if (!arrival || this.waiting || (waitOnly && arrival.met)) return null
    return {
      raw: arrival.raw,
      hold: !arrival.met,
      run: () => {
        if (this.arrival !== arrival) return
        if (arrival.met) this.consume()
        else this.waiting = true
        this.host.changed()
      },
    }
  }
  private consume(): void {
    if (!this.arrival) return
    this.consumed = this.arrival.raw
    this.arrival = undefined
    const release = this.waiting
    this.waiting = false
    if (release) this.host.clock.release()
    this.host.invalidate()
  }
  note(note: RoutedNote): void {
    if (!note.on) {
      this.down.delete(note.id)
      return
    }
    const c = this.host.clock
    if (!this.enabled || !c.playing || note.live === false) return
    this.next()
    const arrival = this.arrival
    if (!arrival || arrival.met) return
    const when = note.when ?? c.now(),
      deadline = c.contextAt(arrival.raw),
      options = this.options!
    if (when < deadline - options.earlyMs / 1000 || when > c.now() + 0.05)
      return
    if (
      !arrival.onset.notes.some(
        (n) => n.trackId === note.trackId && n.key === note.key,
      )
    )
      return
    this.down.set(note.id, { key: note.key, trackId: note.trackId, when })
    let met = options.strictness === 'any',
      matchedFrom = when
    if (!met) {
      const times = arrival.onset.keys.map((key) =>
        Math.max(
          -Infinity,
          ...[...this.down.values()]
            .filter(
              (press) =>
                press.key === key &&
                press.when >= deadline - options.earlyMs / 1000 &&
                arrival.onset.notes.some(
                  (n) => n.trackId === press.trackId && n.key === key,
                ),
            )
            .map((press) => press.when),
        ),
      )
      matchedFrom = Math.min(...times)
      met =
        times.every(Number.isFinite) &&
        Math.max(...times) - Math.min(...times) <=
          options.chordWindowMs / 1000 + 1e-9
    }
    if (!met) return
    arrival.met = true
    arrival.matchedFrom = matchedFrom
    if (this.waiting) this.consume()
    else this.host.invalidate()
    this.host.changed()
  }
  skip(): boolean {
    if (!this.waiting) return false
    this.consume()
    this.host.changed()
    return true
  }
}
