import type { TransportClock } from '../transport/clock'
import type {
  SchedulerTimeline,
  TimelineBoundary,
} from '../transport/scheduler'
import type { ScriptHost } from './script-host'

export class ScriptTimeline implements SchedulerTimeline {
  private last = -Infinity
  private pending?: TimelineBoundary
  private mapSignature = ''
  constructor(
    private clock: TransportClock,
    private script: ScriptHost,
  ) {}
  reset(): void {
    this.last = -Infinity
    this.pending = undefined
  }
  next(waitOnly = false): TimelineBoundary | null {
    if (
      waitOnly ||
      !this.script.running ||
      !this.clock.playing ||
      this.clock.holding ||
      (!this.script.has('beat') && !this.script.has('bar'))
    )
      return null
    const c = this.clock
    const signature = JSON.stringify([
      c.map.tempos,
      c.map.signatures,
      c.loopRange,
    ])
    if (signature !== this.mapSignature) {
      this.mapSignature = signature
      this.reset()
    }
    if (this.pending) return this.pending
    const map = c.map,
      beat = this.script.has('beat')
    const reference = Number.isFinite(this.last) ? this.last : c.raw
    const song = c.songAt(reference),
      positionTick = map.secToTick(song)
    let tick = beat
      ? map.nextBeat(positionTick, !Number.isFinite(this.last))
      : map.nextBar(positionTick, !Number.isFinite(this.last))
    let raw = reference + map.tickToSec(tick) - song
    const loop = c.loopRange,
      end = map.tickToSec(loop.endTick)
    if (loop.enabled && map.tickToSec(tick) >= end - 1e-9) {
      tick = loop.startTick
      raw = reference + end - song
    }
    if (raw <= this.last + 1e-7) return null
    const position = map.tickToBarBeat(tick)
    this.pending = {
      raw,
      hold: false,
      run: () => {
        this.last = raw
        this.pending = undefined
        this.script.emit('beat', { bar: position.bar, beat: position.beat })
        if (position.beat === 1) this.script.emit('bar', { bar: position.bar })
      },
    }
    return this.pending
  }
}
export function combineTimelines(
  ...timelines: SchedulerTimeline[]
): SchedulerTimeline {
  return {
    next: (waitOnly) =>
      timelines
        .map((t) => t.next(waitOnly))
        .filter((t): t is TimelineBoundary => t !== null)
        .sort((a, b) => a.raw - b.raw)[0] ?? null,
  }
}
