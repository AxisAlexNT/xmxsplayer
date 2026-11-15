import {
  expectedOnsets,
  type ExpectedOnset,
} from '../../shared/expected-onsets'
import { PPQ, type Project } from '../../shared/model'
import type { RoutedNote } from '../../shared/recording'
import type { TransportClock } from '../transport/clock'
interface Entry {
  onset: ExpectedOnset
  index: number
  raw: number
  tick: number
}
interface Match extends Entry {
  when: number
}
export interface TempoHost {
  clock: TransportClock
  apply(factor: number): void
}
const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value))
export class TempoTrack {
  private base: ExpectedOnset[] = []
  private repeat: ExpectedOnset[] = []
  private options?: Project['follow']
  private signature = ''
  private enabled = false
  private pointer = 0
  private previous?: Match
  private gesture?: Match
  private phase = 1
  private phaseEnd = Infinity
  private estimate = 1
  private held = false
  private userRate = 1
  private ticking = false
  private exit?: { raw: number; end: number; from: number }
  constructor(private host: TempoHost) {}
  get factor(): number {
    return this.estimate
  }
  get active(): boolean {
    return this.enabled || !!this.exit
  }
  get expected(): ExpectedOnset | null {
    return this.enabled && this.host.clock.playing
      ? (this.entry(this.pointer)?.onset ?? null)
      : null
  }
  private entry(index: number): Entry | undefined {
    if (index < 0) return
    const c = this.host.clock,
      loop = c.loopRange,
      map = c.map
    if (index < this.base.length) {
      const onset = this.base[index]
      return { onset, index, raw: map.tickToSec(onset.tick), tick: onset.tick }
    }
    if (!loop.enabled || !this.repeat.length) return
    const offset = index - this.base.length,
      cycle = Math.floor(offset / this.repeat.length) + 1,
      onset = this.repeat[offset % this.repeat.length]
    const start = map.tickToSec(loop.startTick),
      end = map.tickToSec(loop.endTick)
    return {
      onset,
      index,
      raw:
        end + (cycle - 1) * (end - start) + map.tickToSec(onset.tick) - start,
      tick: onset.tick + cycle * (loop.endTick - loop.startTick),
    }
  }
  private at(raw: number): number {
    const c = this.host.clock,
      loop = c.loopRange,
      end = c.map.tickToSec(loop.endTick),
      start = c.map.tickToSec(loop.startTick)
    let list = this.base,
      offset = 0,
      song = raw
    if (loop.enabled && this.repeat.length && raw >= end - 1e-9) {
      const cycle = Math.max(
        1,
        Math.floor((raw - end) / (end - start) + 1e-9) + 1,
      )
      list = this.repeat
      offset = this.base.length + (cycle - 1) * list.length
      song = c.songAt(raw)
    }
    const tick = c.map.secToTick(song)
    let lo = 0,
      hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (list[mid].tick < tick - 1e-7) lo = mid + 1
      else hi = mid
    }
    return offset + lo
  }
  private tickAt(raw: number): number {
    const c = this.host.clock,
      loop = c.loopRange,
      end = c.map.tickToSec(loop.endTick),
      start = c.map.tickToSec(loop.startTick)
    if (!loop.enabled || raw < end - 1e-9) return c.map.secToTick(raw)
    const cycle = Math.max(
      1,
      Math.floor((raw - end) / (end - start) + 1e-9) + 1,
    )
    return (
      c.map.secToTick(c.songAt(raw)) + cycle * (loop.endTick - loop.startTick)
    )
  }
  configure(project: Project): boolean {
    const onsets = expectedOnsets(project).filter(
      (onset) => onset.tick < project.lengthTicks,
    )
    const signature = JSON.stringify([
      onsets,
      project.follow,
      project.loop,
      project.tempos,
      project.timeSigs,
      project.beatAnchors,
      project.mapOwner,
    ])
    if (signature === this.signature) return false
    this.signature = signature
    const wasEnabled = this.enabled,
      c = this.host.clock
    this.options = project.follow
    this.enabled = project.follow.mode === 'tempoTrack'
    this.base = project.loop.enabled
      ? onsets.filter((onset) => onset.tick < project.loop.endTick)
      : onsets
    this.repeat = project.loop.enabled
      ? this.base.filter((onset) => onset.tick >= project.loop.startTick)
      : []
    this.previous = undefined
    this.gesture = undefined
    this.pointer = this.at(c.raw)
    this.phase = 1
    this.phaseEnd = Infinity
    if (this.enabled) {
      this.exit = undefined
      const [lo, hi] = [...project.follow.range].sort((a, b) => a - b)
      this.estimate = clamp(wasEnabled ? this.estimate : c.followFactor, lo, hi)
      this.apply(this.estimate)
    } else if (wasEnabled && c.playing && Math.abs(c.followFactor - 1) > 1e-9) {
      const tick = c.tick,
        sig = c.map.signatureAt(tick),
        endTick = tick + ((2 * sig.num * 4) / sig.den) * PPQ
      this.exit = {
        raw: c.raw,
        end: c.raw + c.map.tickToSec(endTick) - c.map.tickToSec(tick),
        from: c.followFactor,
      }
    } else if (!c.playing) {
      this.exit = undefined
      this.estimate = 1
      this.apply(1)
    }
    return true
  }
  reset(keepFactor = true): void {
    this.previous = undefined
    this.gesture = undefined
    this.phase = 1
    this.phaseEnd = Infinity
    this.exit = undefined
    this.pointer = this.at(this.host.clock.raw)
    if (!keepFactor || !this.enabled) this.estimate = 1
    this.apply(this.estimate)
  }
  private apply(value: number): void {
    if (Math.abs(value - this.host.clock.followFactor) > 1e-9)
      this.host.apply(value)
  }
  tick(): void {
    if (this.ticking) return
    this.ticking = true
    try {
      const c = this.host.clock
      if (!c.playing) {
        if (this.active || c.followFactor !== 1) this.reset(false)
        this.held = false
        return
      }
      if (c.rate !== this.userRate) {
        this.userRate = c.rate
        this.previous = undefined
        this.gesture = undefined
        if (this.enabled) {
          this.phase = 1
          this.phaseEnd = Infinity
          this.apply(this.estimate)
        }
      }
      if (c.holding !== this.held) {
        this.previous = undefined
        this.gesture = undefined
        this.held = c.holding
      }
      if (this.exit) {
        const progress = clamp(
          (c.raw - this.exit.raw) / (this.exit.end - this.exit.raw),
          0,
          1,
        )
        const value = this.exit.from + (1 - this.exit.from) * progress
        if (progress >= 1) {
          this.exit = undefined
          this.estimate = 1
        }
        this.apply(value)
        return
      }
      if (!this.enabled) return
      if (c.raw >= this.phaseEnd - 1e-9) {
        this.phase = 1
        this.phaseEnd = Infinity
        this.apply(this.estimate)
      }
      const next = this.entry(this.pointer)
      if (next && this.tickAt(c.raw) - next.tick >= 2 * PPQ - 1e-7)
        this.pointer = Math.max(this.pointer, this.at(c.raw))
    } finally {
      this.ticking = false
    }
  }
  note(note: RoutedNote): void {
    const c = this.host.clock
    this.tick()
    if (
      !this.enabled ||
      !c.playing ||
      c.holding ||
      !note.on ||
      note.live === false ||
      !this.options
    )
      return
    if (c.now() < c.contextAt(c.raw) - 1e-7) return
    const when = note.when ?? c.now()
    if (!Number.isFinite(when) || when > c.now() + 0.05) return
    const raw = c.rawAt(when),
      predicted = this.previous
        ? this.previous.raw +
          Math.max(0, when - this.previous.when) * c.rate * this.estimate
        : raw
    const candidates: Entry[] = []
    for (
      let index = Math.max(0, this.pointer - 2);
      index < this.pointer + 8;
      index++
    ) {
      const entry = this.entry(index)
      if (
        entry?.onset.notes.some(
          (n) => n.key === note.key && n.trackId === note.trackId,
        )
      )
        candidates.push(entry)
    }
    candidates.sort(
      (a, b) =>
        Math.abs(a.raw - predicted) - Math.abs(b.raw - predicted) ||
        b.index - a.index,
    )
    const match = candidates[0]
    if (
      !match ||
      (this.gesture?.index === match.index &&
        when - this.gesture.when <=
          Math.max(0.001, this.options.chordWindowMs / 1000))
    )
      return
    const previous = this.previous,
      elapsed = previous ? when - previous.when : 0
    if (previous && match.index > previous.index && elapsed > 1e-4) {
      const instant = (match.raw - previous.raw) / (elapsed * c.rate),
        [lo, hi] = [...this.options.range].sort((a, b) => a - b)
      if (Number.isFinite(instant) && instant > 0)
        this.estimate = clamp(
          this.estimate + (instant - this.estimate) * this.options.smoothing,
          lo,
          hi,
        )
    }
    const accepted = { ...match, when }
    if (!previous || match.index > previous.index) this.previous = accepted
    this.gesture = accepted
    this.pointer = match.index + 1
    const error = (match.tick - this.tickAt(raw)) / PPQ
    this.phase = 1 + clamp(this.options.phaseGain * error, -0.25, 0.25)
    const beatTicks = (PPQ * 4) / c.map.signatureAt(c.tick).den,
      distance = c.map.tickToSec(c.tick + beatTicks) - c.map.tickToSec(c.tick)
    this.phaseEnd = c.raw + Math.max(1e-6, distance)
    this.apply(this.estimate * this.phase)
  }
}
