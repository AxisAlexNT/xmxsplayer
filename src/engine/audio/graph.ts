import { EffectChain } from './effects/chain'
import type { Settings } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'

type AudioContextWithSink = AudioContext & {
  setSinkId?: (id: string) => Promise<void>
}
export interface AudioRoute {
  context: AudioContext
  destination: AudioNode
  timeAt: (mainTime: number) => number
}
export function contextTimeAt(
  main: AudioContext,
  target: AudioContext,
  time: number,
): number {
  if (main === target) return time
  const from = main.getOutputTimestamp(),
    to = target.getOutputTimestamp()
  if (
    !from.contextTime ||
    !to.contextTime ||
    !from.performanceTime ||
    !to.performanceTime
  )
    return target.currentTime + time - main.currentTime
  return (
    to.contextTime +
    (from.performanceTime - to.performanceTime) / 1000 +
    time -
    from.contextTime
  )
}
export class AudioGraph {
  readonly context: AudioContextWithSink
  readonly main: GainNode
  readonly cue: GainNode
  readonly master: GainNode
  readonly effects: EffectChain
  readonly limiter: DynamicsCompressorNode
  private splitMain: ChannelSplitterNode
  private splitCue: ChannelSplitterNode
  private merger: ChannelMergerNode
  private bufferSize: Settings['audio']['bufferSize']
  private wired = false
  private mode: 'off' | 'channels34' | 'device' = 'off'
  private cueContext?: AudioContextWithSink
  private cueOutput?: GainNode
  private cueSink = ''
  private limited = true
  private sink = ''
  private timer: ReturnType<typeof setInterval>
  constructor(
    settings: Settings['audio'],
    private report: (value: EventMap['latency']) => void,
    private warn: (message: string) => void,
  ) {
    this.bufferSize = settings.bufferSize
    this.context = new AudioContext({
      latencyHint: 0,
      sampleRate: settings.sampleRate,
    })
    this.main = this.context.createGain()
    this.cue = this.context.createGain()
    this.master = this.context.createGain()
    this.effects = new EffectChain(this.context, this.main, this.master)
    this.limiter = this.context.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.1
    this.splitMain = this.context.createChannelSplitter(2)
    this.splitCue = this.context.createChannelSplitter(2)
    this.merger = this.context.createChannelMerger(4)
    this.timer = setInterval(() => this.latency(), 2000)
    this.context.addEventListener('statechange', () => this.latency())
  }
  async apply(settings: Settings['audio']): Promise<void> {
    if (settings.mainDeviceId !== this.sink) {
      try {
        if (!this.context.setSinkId)
          throw new Error(
            'Output selection is unavailable in this audio engine',
          )
        await this.context.setSinkId(settings.mainDeviceId)
        this.sink = settings.mainDeviceId
      } catch (error) {
        this.warn(
          `Selected output unavailable; using default output. ${String(error)}`,
        )
        if (this.context.setSinkId) await this.context.setSinkId('')
        this.sink = ''
      }
    }
    let mode = settings.cue.mode
    if (mode === 'device') {
      try {
        if (!this.cueContext) {
          this.cueContext = new AudioContext({
            latencyHint: 0,
            sampleRate: this.context.sampleRate,
          })
          this.cueOutput = this.cueContext.createGain()
          this.cueOutput.connect(this.cueContext.destination)
          this.cueSink = '\0'
        }
        if (!this.cueContext.setSinkId)
          throw Error('Separate output selection is unavailable')
        if (this.cueSink !== settings.cue.deviceId) {
          await this.cueContext.setSinkId(settings.cue.deviceId)
          this.cueSink = settings.cue.deviceId
        }
        await this.cueContext.resume()
      } catch (error) {
        this.warn(
          `Cue output unavailable; cue is mixed into main. ${String(error)}`,
        )
        mode = 'off'
      }
    }
    if (mode !== 'device' && this.cueContext?.state === 'running')
      await this.cueContext.suspend()
    if (mode === 'channels34' && this.context.destination.maxChannelCount < 4) {
      this.warn(
        'This output has fewer than four channels; cue is mixed into main',
      )
      mode = 'off'
    }
    if (
      !this.wired ||
      this.mode !== mode ||
      this.limited !== settings.limiter
    ) {
      this.mode = mode
      this.limited = settings.limiter
      this.wire()
      this.wired = true
    }
    if (this.context.state === 'suspended') await this.context.resume()
    this.latency()
  }
  private wire(): void {
    for (const node of [
      this.cue,
      this.master,
      this.limiter,
      this.splitMain,
      this.splitCue,
      this.merger,
    ])
      node.disconnect()
    const output = this.limited
      ? this.master.connect(this.limiter)
      : this.master
    if (this.mode === 'off') {
      this.context.destination.channelCount = 2
      this.cue.connect(this.master)
      output.connect(this.context.destination)
    } else if (this.mode === 'device') {
      this.context.destination.channelCount = 2
      output.connect(this.context.destination)
    } else {
      this.context.destination.channelCount = 4
      output.connect(this.splitMain)
      this.cue.connect(this.splitCue)
      this.splitMain.connect(this.merger, 0, 0)
      this.splitMain.connect(this.merger, 1, 1)
      this.splitCue.connect(this.merger, 0, 2)
      this.splitCue.connect(this.merger, 1, 3)
      this.merger.connect(this.context.destination)
    }
  }
  route(toCue: boolean): AudioRoute {
    if (toCue && this.mode === 'device' && this.cueContext && this.cueOutput) {
      const context = this.cueContext
      return {
        context,
        destination: this.cueOutput,
        timeAt: (time) => contextTimeAt(this.context, context, time),
      }
    }
    return {
      context: this.context,
      destination: toCue ? this.cue : this.main,
      timeAt: (time) => time,
    }
  }
  latency(): void {
    this.report({
      baseMs: this.context.baseLatency * 1000,
      outputMs: this.context.outputLatency * 1000 || 0,
      backend: 'web',
      fluidMs: 0,
      sampleRate: this.context.sampleRate,
      bufferSize: this.bufferSize,
    })
  }
  async devices(): Promise<{ id: string; label: string }[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }))
  }
  async close(): Promise<void> {
    this.effects.close()
    clearInterval(this.timer)
    await this.cueContext?.close()
    await this.context.close()
  }
}
