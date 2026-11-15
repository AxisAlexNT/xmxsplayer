import type { Clip } from '../../shared/model'
import type { DecodedAudio } from '../audio/decode'
import type { AudioRoute } from '../audio/graph'
import { stretchNode } from '../audio/stretch'
import type { StretchNode } from 'signalsmith-stretch'
import type { ClipTone } from './timing'
export interface VoiceChange {
  at: number
  kind: 'start' | 'update' | 'hold' | 'stop'
  tone: ClipTone
  active?: boolean
}
export interface ClipVoice {
  readonly duration: number
  readonly error?: string
  readonly alignmentInterval?: number
  plan(now: number, changes: VoiceChange[]): void
  position(now: number): { input: number; progress: number; ended: boolean }
  close(): void
}
interface Segment {
  at: number
  input: number
  rate: number
  active: boolean
  loop: boolean
}
export class AudioClipVoice implements ClipVoice {
  private gain: GainNode
  private pan: StereoPannerNode
  private segments: Segment[] = []
  private disposed = false
  error?: string
  private constructor(
    readonly duration: number,
    readonly route: AudioRoute,
    readonly node: StretchNode,
    readonly alignmentInterval?: number,
  ) {
    this.gain = route.context.createGain()
    this.gain.gain.value = 0
    this.pan = route.context.createStereoPanner()
    node.connect(this.gain)
    this.gain.connect(this.pan)
    this.pan.connect(route.destination)
  }
  static async create(
    route: AudioRoute,
    decoded: DecodedAudio,
    clip: Clip,
    independentClock = false,
  ): Promise<AudioClipVoice> {
    const buffer = decoded.buffer,
      start = Math.round(clip.startSec * buffer.sampleRate),
      end = Math.round(clip.endSec * buffer.sampleRate)
    if (start < 0 || end <= start || end > buffer.length + 1)
      throw Error('Clip fragment is outside its audio file')
    const { node } = await stretchNode(route.context)
    try {
      const channels = [0, Math.min(1, buffer.numberOfChannels - 1)].map(
        (channel) =>
          buffer
            .getChannelData(channel)
            .slice(start, Math.min(end, buffer.length)),
      )
      const duration = await node.addBuffers(channels)
      return new AudioClipVoice(
        duration,
        route,
        node,
        independentClock ? 5 : undefined,
      )
    } catch (error) {
      node.disconnect()
      node.port.close()
      throw error
    }
  }
  private state(at: number): Segment {
    const segment = [...this.segments].reverse().find((s) => s.at <= at + 1e-9)
    if (!segment) return { at, input: 0, rate: 1, active: false, loop: true }
    return {
      ...segment,
      at,
      input:
        segment.input +
        (segment.active ? Math.max(0, at - segment.at) * segment.rate : 0),
    }
  }
  position(now: number): { input: number; progress: number; ended: boolean } {
    const state = this.state(now),
      ended = !state.loop && state.input >= this.duration - 1e-7
    const input = state.loop
      ? ((state.input % this.duration) + this.duration) % this.duration
      : Math.min(this.duration, state.input)
    return { input, progress: input / this.duration, ended }
  }
  plan(now: number, changes: VoiceChange[]): void {
    if (this.disposed || !changes.length) return
    const initial = this.state(now)
    this.segments = [initial]
    const gain = this.gain.gain,
      pan = this.pan.pan,
      route = this.route
    gain.cancelAndHoldAtTime(
      Math.max(route.context.currentTime, route.timeAt(now)),
    )
    pan.cancelScheduledValues(route.context.currentTime)
    let previous = initial
    const schedule = (segment: Segment, tone: ClipTone): void => {
      this.segments.push(segment)
      void this.node
        .schedule({
          output: route.timeAt(segment.at),
          input: segment.loop
            ? ((segment.input % this.duration) + this.duration) % this.duration
            : segment.input,
          rate: segment.rate,
          semitones: tone.semitones,
          active: segment.active,
          loopStart: 0,
          loopEnd: segment.loop ? this.duration : 0,
        })
        .catch((error) => {
          this.error = String(error)
        })
    }
    const ordered = [...changes].sort((a, b) => a.at - b.at)
    for (let i = 0; i < ordered.length; i++) {
      const change = ordered[i],
        tone = change.tone,
        at = Math.max(now, change.at),
        output = route.timeAt(at)
      const input =
        change.kind === 'start'
          ? 0
          : previous.input +
            (previous.active
              ? Math.max(0, at - previous.at) * previous.rate
              : 0)
      const active =
        change.kind !== 'hold' &&
        change.kind !== 'stop' &&
        change.active !== false
      const segment: Segment = {
        at,
        input,
        rate: tone.rate,
        active,
        loop: tone.loop,
      }
      const fade = Math.max(0, tone.fadeMs / 1000)
      pan.setValueAtTime(tone.pan, output)
      if (change.kind === 'stop') {
        gain.cancelAndHoldAtTime(output)
        gain.linearRampToValueAtTime(0, output + fade)
        // A fade tail advances until it reaches silence.
        schedule({ ...segment, active: previous.active }, tone)
        previous = {
          ...segment,
          at: at + fade,
          input: input + (previous.active ? fade * tone.rate : 0),
          active: false,
        }
        schedule(previous, tone)
        continue
      }
      if (change.kind === 'start') {
        gain.cancelScheduledValues(output)
        if (previous.active && at > now) {
          gain.cancelAndHoldAtTime(route.timeAt(Math.max(now, at - fade)))
          gain.linearRampToValueAtTime(0, output)
        }
        gain.setValueAtTime(0, output)
      }
      if (change.kind === 'hold' || !active) {
        const fadeStart = Math.max(now, at - fade)
        if (fadeStart > now)
          gain.setValueAtTime(tone.gain, route.timeAt(fadeStart))
        gain.linearRampToValueAtTime(0, output)
      } else {
        const remaining = tone.loop
          ? Infinity
          : Math.max(0, this.duration - input) / tone.rate
        const fadeIn = Math.min(
          fade,
          remaining / 2,
          Math.max(0, (ordered[i + 1]?.at ?? Infinity) - at),
        )
        gain.linearRampToValueAtTime(tone.gain, output + fadeIn)
      }
      schedule(segment, tone)
      previous = segment
      if (active && !tone.loop) {
        const end = at + Math.max(0, this.duration - input) / tone.rate
        if (end <= (ordered[i + 1]?.at ?? Infinity)) {
          gain.setValueAtTime(
            tone.gain,
            route.timeAt(Math.max(at, end - Math.min(fade, (end - at) / 2))),
          )
          gain.linearRampToValueAtTime(0, route.timeAt(end))
          schedule(
            { ...segment, at: end, input: this.duration, active: false },
            tone,
          )
          break
        }
      }
    }
  }
  close(): void {
    if (this.disposed) return
    this.disposed = true
    void this.node.stop().catch(() => undefined)
    void this.node.dropBuffers().catch(() => undefined)
    this.node.disconnect()
    this.node.port.close()
    this.gain.disconnect()
    this.pan.disconnect()
  }
}
