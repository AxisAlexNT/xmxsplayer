import { TimeMap } from '../../shared/time-map'
import type { Project } from '../../shared/model'
export class TransportClock {
  playing = false
  holding = false
  recording = false
  rate = 1
  followFactor = 1
  private anchorRaw = 0
  private anchorContext = 0
  private loop: Project['loop'] = { enabled: false, startTick: 0, endTick: 1 }
  constructor(
    public map: TimeMap,
    readonly now: () => number,
  ) {}
  get speed(): number {
    return this.rate * this.followFactor
  }
  rawAt(contextTime = this.now()): number {
    return (
      this.anchorRaw +
      (this.playing && !this.holding
        ? Math.max(0, contextTime - this.anchorContext) * this.speed
        : 0)
    )
  }
  get raw(): number {
    return this.rawAt()
  }
  songAt(raw = this.raw): number {
    if (!this.loop.enabled) return raw
    const start = this.map.tickToSec(this.loop.startTick),
      end = this.map.tickToSec(this.loop.endTick),
      length = end - start
    return length > 0 && raw >= end
      ? start + ((((raw - end) % length) + length) % length)
      : raw
  }
  get tick(): number {
    return this.map.secToTick(this.songAt())
  }
  get loopRange(): Project['loop'] {
    return this.loop
  }
  contextAt(raw: number): number {
    return this.anchorContext + (raw - this.anchorRaw) / this.speed
  }
  private anchor(raw: number, context = this.now()): void {
    this.anchorRaw = raw
    this.anchorContext = context
  }
  play(leadSec = 0): void {
    if (this.playing && !this.holding) return
    this.anchor(this.raw, this.now() + Math.max(0, leadSec))
    this.playing = true
    this.holding = false
  }
  pause(): void {
    this.anchor(this.raw)
    this.playing = false
    this.holding = false
    this.recording = false
  }
  seek(tick: number): void {
    if (!Number.isFinite(tick)) throw Error('Seek position must be finite')
    this.anchor(this.map.tickToSec(Math.max(0, tick)))
    this.holding = false
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 2)
      throw Error('Speed must be between 25% and 200%')
    this.anchor(this.raw)
    this.rate = rate
  }
  setFollowFactor(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0)
      throw Error('Follow factor must be positive')
    this.anchor(this.raw)
    this.followFactor = factor
  }
  setMap(map: TimeMap): void {
    const tick = this.tick
    this.map = map
    this.anchor(map.tickToSec(tick))
  }
  setLoop(loop: Project['loop']): void {
    const song = this.songAt()
    this.loop = { ...loop }
    this.anchor(song)
  }
  hold(raw = this.raw): void {
    this.anchor(raw)
    this.holding = true
  }
  release(): void {
    if (!this.holding) return
    this.anchor(this.anchorRaw)
    this.holding = false
  }
}
