import type { Clip } from '../../shared/model'
import type { TransportClock } from '../transport/clock'
export interface ClipTone {
  rate: number
  semitones: number
  gain: number
  pan: number
  loop: boolean
  fadeMs: number
}
export function clipRate(
  fragmentSec: number,
  beats: number,
  bpm: number,
  speed: number,
): number {
  if (
    ![fragmentSec, beats, bpm, speed].every((n) => Number.isFinite(n) && n > 0)
  )
    throw Error(
      'Clip sync requires a positive fragment length, beat count, tempo and speed',
    )
  return (fragmentSec * bpm * speed) / (beats * 60)
}
export function clipTone(
  clip: Clip,
  duration: number,
  clock: TransportClock,
  semitones = clip.semitones,
  gain = clip.gain,
  pressure = 1,
  at = clock.now(),
): ClipTone {
  const tick = clock.playing
    ? clock.map.secToTick(clock.songAt(clock.rawAt(at) + 1e-8))
    : clock.tick
  const rate = clip.sync
    ? clipRate(duration, clip.beats, clock.map.tempoAt(tick), clock.speed)
    : 1
  const pitchFactor = 2 ** (semitones / 12)
  const tapeRate = clip.pitchMode === 'tape' ? pitchFactor : 1
  const volume = gain * (clip.pressureToGain ? pressure : 1)
  if (
    !Number.isFinite(pitchFactor) ||
    pitchFactor < 1.175e-38 ||
    pitchFactor > 3.4e38 ||
    !Number.isFinite(rate * tapeRate) ||
    rate * tapeRate > 3.4e38 ||
    rate * tapeRate <= 0 ||
    !Number.isFinite(volume) ||
    Math.abs(volume) > 3.4e38
  )
    throw Error('Clip pitch or gain exceeds the audio engine range')
  return {
    rate: rate * tapeRate,
    semitones: clip.pitchMode === 'tape' ? 0 : semitones,
    gain: volume,
    pan: clip.pan,
    loop: clip.loop && clip.launch !== 'oneShot',
    fadeMs: clip.fadeMs,
  }
}
/** Future map changes let the worklet change rate on the audio clock. */
export function tempoDeadlines(
  clock: TransportClock,
  horizon = 0.25,
): number[] {
  if (!clock.playing || clock.holding) return []
  const result: number[] = [],
    map = clock.map,
    loop = clock.loopRange
  let raw = clock.raw,
    tick = clock.tick
  const limit = clock.now() + horizon
  for (let count = 0; count < 64; count++) {
    const next = map.tempos.find((t) => t.tick > tick + 1e-7)
    const wrap = loop.enabled && (!next || next.tick >= loop.endTick)
    if (!next && !wrap) break
    const boundary = wrap ? loop.endTick : next!.tick
    raw += map.tickToSec(boundary) - map.tickToSec(tick)
    const when = clock.contextAt(raw)
    if (when > limit + 1e-9) break
    if (when >= clock.now() - 1e-9) result.push(when)
    tick = wrap ? loop.startTick : boundary
    if (loop.enabled && loop.endTick <= loop.startTick) break
  }
  return result
}
