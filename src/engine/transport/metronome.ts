import { AudioGraph } from '../audio/graph'
export class Metronome {
  private counting:
    | {
        start: number
        num: number
        beats: number
        beatSec: number
        toCue: boolean
        index: number
      }
    | undefined
  private sounds = new Set<{
    osc: OscillatorNode
    gain: GainNode
    countIn: boolean
  }>()
  constructor(private graph: AudioGraph) {}
  click(when: number, accent: boolean, toCue: boolean, countIn = false): void {
    const route = this.graph.route(toCue),
      ctx = route.context,
      time = Math.max(ctx.currentTime, route.timeAt(when)),
      osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      sound = { osc, gain, countIn }
    osc.frequency.value = accent ? 1500 : 1000
    gain.gain.setValueAtTime(0, time)
    gain.gain.linearRampToValueAtTime(accent ? 0.14 : 0.09, time + 0.001)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035)
    osc.connect(gain)
    gain.connect(route.destination)
    osc.start(time)
    osc.stop(time + 0.04)
    this.sounds.add(sound)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
      this.sounds.delete(sound)
    }
  }
  cancel(countIn = false): void {
    if (countIn) this.counting = undefined
    for (const sound of this.sounds) {
      if (sound.countIn && !countIn) continue
      try {
        sound.osc.stop()
      } catch {
        /* Already ended. */
      }
      sound.gain.disconnect()
      this.sounds.delete(sound)
    }
  }
  countIn(
    start: number,
    num: number,
    beats: number,
    beatSec: number,
    toCue: boolean,
  ): void {
    this.counting = { start, num, beats, beatSec, toCue, index: 0 }
    this.tick(this.graph.context.currentTime)
  }
  tick(now: number): void {
    const count = this.counting
    if (!count) return
    while (
      count.index < count.beats &&
      count.start + count.index * count.beatSec <= now + 0.12
    ) {
      const i = count.index++
      this.click(
        count.start + i * count.beatSec,
        i % count.num === 0,
        count.toCue,
        true,
      )
    }
    if (count.index === count.beats) this.counting = undefined
  }
}
