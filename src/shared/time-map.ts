import { PPQ, type Project } from './model'
export interface BarBeat {
  bar: number
  beat: number
  sixteenth: number
  tickInBeat: number
  num: number
  den: number
}
export interface Measure {
  bar: number
  start: number
  end: number
  num: number
  den: number
  beats: number[]
}
type Maps = Pick<
  Project,
  'tempos' | 'timeSigs' | 'keySigs' | 'beatAnchors' | 'mapOwner' | 'lengthTicks'
>
interface Tempo {
  tick: number
  bpm: number
  sec: number
}
interface Signature {
  tick: number
  num: number
  den: number
  bar: number
}
function ordered<T extends { tick: number }>(values: readonly T[]): T[] {
  const result = new Map<number, T>()
  for (const value of values) result.set(value.tick, value)
  return [...result.values()].sort((a, b) => a.tick - b.tick)
}
function lastAt<T>(
  values: readonly T[],
  value: number,
  key: (entry: T) => number,
): T {
  let lo = 0,
    hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (key(values[mid]) <= value) lo = mid + 1
    else hi = mid
  }
  return values[Math.max(0, lo - 1)]
}
export function anchorTempos(
  anchors: Project['beatAnchors'],
): Project['tempos'] {
  const sorted = ordered(anchors)
  if (sorted.length < 2) return []
  const result: Project['tempos'] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i],
      b = sorted[i + 1]
    if (b.sec <= a.sec || b.tick <= a.tick)
      throw Error('Beat anchors must advance in both ticks and seconds')
    result.push({
      tick: i === 0 ? 0 : a.tick,
      bpm: (60 * (b.tick - a.tick)) / (PPQ * (b.sec - a.sec)),
    })
  }
  return result
}
export class TimeMap {
  readonly tempos: Tempo[]
  readonly signatures: Signature[]
  readonly lengthTicks: number
  private keys: Project['keySigs']
  constructor(maps: Maps) {
    this.lengthTicks = maps.lengthTicks
    let tempos = ordered(
      maps.mapOwner === null && maps.beatAnchors.length >= 2
        ? anchorTempos(maps.beatAnchors)
        : maps.tempos,
    )
    if (!tempos.length || tempos[0].tick > 0)
      tempos = [{ tick: 0, bpm: 120 }, ...tempos]
    let sec = 0
    this.tempos = tempos.map((tempo, i) => {
      if (tempo.bpm <= 0 || !Number.isFinite(tempo.bpm))
        throw Error('Tempo must be positive and finite')
      if (i)
        sec +=
          ((tempo.tick - tempos[i - 1].tick) * 60) / (PPQ * tempos[i - 1].bpm)
      return { ...tempo, sec }
    })
    let signatures = ordered(maps.timeSigs)
    if (!signatures.length || signatures[0].tick > 0)
      signatures = [{ tick: 0, num: 4, den: 4 }, ...signatures]
    let bar = 1
    this.signatures = signatures.map((signature, i) => {
      if (i) {
        const previous = signatures[i - 1]
        bar += Math.ceil(
          (signature.tick - previous.tick) /
            ((PPQ * 4 * previous.num) / previous.den),
        )
      }
      return { ...signature, bar }
    })
    this.keys = ordered(maps.keySigs)
  }
  tickToSec(tick: number): number {
    const tempo = lastAt(this.tempos, tick, (t) => t.tick)
    return tempo.sec + ((tick - tempo.tick) * 60) / (PPQ * tempo.bpm)
  }
  secToTick(sec: number): number {
    const tempo = lastAt(this.tempos, sec, (t) => t.sec)
    return tempo.tick + ((sec - tempo.sec) * PPQ * tempo.bpm) / 60
  }
  tempoAt(tick: number): number {
    return lastAt(this.tempos, tick, (t) => t.tick).bpm
  }
  signatureAt(tick: number): Signature {
    return lastAt(this.signatures, tick, (t) => t.tick)
  }
  keyAt(tick: number): Project['keySigs'][number] {
    return this.keys.length
      ? lastAt(this.keys, tick, (t) => t.tick)
      : { tick: 0, fifths: 0, minor: false }
  }
  tickToBarBeat(tick: number): BarBeat {
    tick = Math.max(0, tick)
    const signature = this.signatureAt(tick)
    const beatTicks = (PPQ * 4) / signature.den,
      barTicks = beatTicks * signature.num
    const offset = tick - signature.tick,
      bar = signature.bar + Math.floor(offset / barTicks)
    const within = offset % barTicks,
      beat = Math.floor(within / beatTicks) + 1,
      tickInBeat = within % beatTicks
    return {
      bar,
      beat,
      sixteenth: Math.floor(tickInBeat / (PPQ / 4)) + 1,
      tickInBeat,
      num: signature.num,
      den: signature.den,
    }
  }
  barToTick(bar: number, beat = 1): number {
    bar = Math.max(1, Math.floor(bar))
    const signature = lastAt(this.signatures, bar, (s) => s.bar)
    return (
      signature.tick +
      ((bar - signature.bar) * PPQ * 4 * signature.num) / signature.den +
      ((beat - 1) * PPQ * 4) / signature.den
    )
  }
  nextBeat(tick: number, inclusive = false): number {
    const signature = this.signatureAt(tick),
      step = (PPQ * 4) / signature.den
    const offset = (tick - signature.tick) / step
    const next =
      signature.tick +
      (inclusive ? Math.ceil(offset - 1e-9) : Math.floor(offset + 1e-9) + 1) *
        step
    const following = this.signatures.find((s) => s.tick > tick + 1e-9)
    return following ? Math.min(next, following.tick) : next
  }
  nextBar(tick: number, inclusive = false): number {
    const position = this.tickToBarBeat(tick),
      start = this.barToTick(position.bar)
    return inclusive && Math.abs(tick - start) < 1e-8
      ? start
      : this.barToTick(position.bar + 1)
  }
  measures(from = 0, to = this.lengthTicks): Measure[] {
    const result: Measure[] = []
    let bar = this.tickToBarBeat(from).bar,
      start = this.barToTick(bar)
    while (start < to) {
      const signature = this.signatureAt(start),
        end = this.barToTick(bar + 1)
      if (end <= start) throw Error('Invalid measure map')
      const beats = Array.from(
        { length: signature.num },
        (_, i) => start + (i * PPQ * 4) / signature.den,
      ).filter((t) => t < end)
      result.push({
        bar,
        start,
        end,
        num: signature.num,
        den: signature.den,
        beats,
      })
      start = end
      bar++
    }
    return result
  }
}
