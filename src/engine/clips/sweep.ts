import type { Clip } from '../../shared/model'
export interface SweepResult {
  value: number
  semitones: number
  start: boolean
  stop: boolean
  deadline: number | null
}
const clamp = (value: number): number => Math.max(0, Math.min(1, value))
/** Controller values and deadlines stay independent of audio and transport time. */
export class Sweep {
  private position: number
  private previous?: number
  private active = false
  private until: number | null = null
  constructor(
    readonly config: Clip['sweep'],
    semitones = 0,
  ) {
    const span = config.range[1] - config.range[0]
    const normalized = span ? clamp((semitones - config.range[0]) / span) : 0
    this.position =
      config.mode === 'position'
        ? config.offBelow + normalized * (1 - config.offBelow)
        : normalized
  }
  get running(): boolean {
    return this.active
  }
  get value(): number {
    return this.position
  }
  get deadline(): number | null {
    return this.until
  }
  private pitch(): number {
    const normalized =
      this.config.mode === 'position'
        ? this.config.offBelow >= 1
          ? 0
          : clamp(
              (this.position - this.config.offBelow) /
                (1 - this.config.offBelow),
            )
        : this.position
    return (
      this.config.range[0] +
      normalized * (this.config.range[1] - this.config.range[0])
    )
  }
  private result(start = false, stop = false): SweepResult {
    return {
      value: this.position,
      semitones: this.pitch(),
      start,
      stop,
      deadline: this.until,
    }
  }
  change(value: number, now: number, delta?: number): SweepResult {
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(value) ||
      (delta !== undefined && !Number.isFinite(delta))
    )
      return this.result()
    const next =
      delta === undefined ? clamp(value) : clamp(this.position + delta / 127)
    const moved =
      delta === undefined
        ? this.previous === undefined || Math.abs(next - this.previous) > 1e-9
        : delta !== 0
    this.position = next
    this.previous = next
    if (this.config.mode === 'pitchOnly') return this.result()
    if (this.config.mode === 'position') {
      const nextActive = next > this.config.offBelow,
        start = nextActive && !this.active,
        stop = !nextActive && this.active
      this.active = nextActive
      this.until = null
      return this.result(start, stop)
    }
    if (!moved) return this.result()
    const start = !this.active
    this.active = true
    this.until = now + this.config.releaseMs
    return this.result(start)
  }
  tick(now: number): SweepResult {
    if (
      this.config.mode !== 'moving' ||
      !this.active ||
      this.until === null ||
      now < this.until
    )
      return this.result()
    this.active = false
    this.until = null
    return this.result(false, true)
  }
  reset(): void {
    this.active = false
    this.until = null
  }
}
