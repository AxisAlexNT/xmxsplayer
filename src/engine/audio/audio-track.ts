import type { AudioTrack as Track } from '../../shared/model'
import type { TransportClock } from '../transport/clock'
import type { DecodedAudio } from './decode'
import type { AudioRoute } from './graph'
import { ChannelMode } from './channel-mode'
import { stretchNode } from './stretch'
import type { StretchNode } from 'signalsmith-stretch'
export class AudioTrack {
  private matrix: ChannelMode
  private filter: BiquadFilterNode
  private gain: GainNode
  private filterEnabled: boolean | undefined
  private pan: StereoPannerNode
  private lastStart = -Infinity
  private stopAt: number | null = null
  private stoppedAt: number | null = null
  private constructor(
    readonly route: AudioRoute,
    readonly node: StretchNode,
    readonly latency: number,
    readonly decoded: DecodedAudio,
  ) {
    const c = route.context
    this.matrix = new ChannelMode(c, node)
    this.filter = c.createBiquadFilter()
    this.gain = c.createGain()
    this.pan = c.createStereoPanner()
    this.matrix.output.connect(this.filter)
    this.filter.connect(this.gain)
    this.gain.connect(this.pan)
    this.pan.connect(route.destination)
  }
  static async create(
    route: AudioRoute,
    decoded: DecodedAudio,
  ): Promise<AudioTrack> {
    const { node, latency } = await stretchNode(route.context)
    try {
      const l = decoded.buffer.getChannelData(0),
        r = decoded.buffer.getChannelData(
          Math.min(1, decoded.buffer.numberOfChannels - 1),
        )
      await node.addBuffers([l, r])
      return new AudioTrack(route, node, latency, decoded)
    } catch (e) {
      node.disconnect()
      node.port.close()
      throw e
    }
  }
  configure(track: Track, enabled: boolean): void {
    const c = this.route.context
    this.matrix.set(track.channelMode)
    if (this.filterEnabled !== track.filter.enabled) {
      this.matrix.output.disconnect()
      this.matrix.output.connect(track.filter.enabled ? this.filter : this.gain)
      this.filterEnabled = track.filter.enabled
    }
    this.filter.type = track.filter.type
    this.filter.frequency.value = Math.min(
      c.sampleRate * 0.49,
      track.filter.freq,
    )
    this.filter.Q.value = track.filter.q
    this.gain.gain.setTargetAtTime(
      enabled ? track.volume : 0,
      c.currentTime,
      0.005,
    )
    this.pan.pan.setTargetAtTime(track.pan, c.currentTime, 0.005)
  }
  schedule(track: Track, clock: TransportClock, deadline: number | null): void {
    const outputMain = Math.max(clock.now(), clock.contextAt(clock.raw)),
      output = this.route.timeAt(outputMain),
      input = clock.songAt(clock.rawAt(outputMain)) - track.offsetSec,
      loop = clock.loopRange
    void this.node.schedule({
      output,
      input,
      rate: clock.speed,
      semitones: track.semitones + track.cents / 100,
      loopStart: loop.enabled
        ? clock.map.tickToSec(loop.startTick) - track.offsetSec
        : 0,
      loopEnd: loop.enabled
        ? clock.map.tickToSec(loop.endTick) - track.offsetSec
        : 0,
      active: clock.playing && !clock.holding,
    })
    if (!clock.playing || clock.holding)
      this.gain.gain.setTargetAtTime(0, this.route.context.currentTime, 0.005)
    this.lastStart = outputMain
    this.stopAt = deadline
    this.stoppedAt = null
  }
  tick(now: number): void {
    if (
      this.stopAt !== null &&
      this.stoppedAt !== this.stopAt &&
      now > this.lastStart + 0.006
    ) {
      this.stoppedAt = this.stopAt
      void this.node.schedule({
        output: this.route.timeAt(this.stopAt),
        active: false,
      })
    }
  }
  close(): void {
    void this.node.stop()
    void this.node.dropBuffers()
    this.node.disconnect()
    this.node.port.close()
    this.matrix.close()
    this.filter.disconnect()
    this.gain.disconnect()
    this.pan.disconnect()
  }
}
