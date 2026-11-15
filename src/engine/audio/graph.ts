import type { Settings } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'

type AudioContextWithSink = AudioContext & {
  setSinkId?: (id: string) => Promise<void>
}
export class AudioGraph {
  readonly context: AudioContextWithSink
  readonly main: GainNode
  readonly cue: GainNode
  readonly master: GainNode
  readonly limiter: DynamicsCompressorNode
  private splitMain: ChannelSplitterNode
  private splitCue: ChannelSplitterNode
  private merger: ChannelMergerNode
  private bufferSize: Settings['audio']['bufferSize']
  private wired = false
  private mode: 'off' | 'channels34' = 'off'
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
      this.warn(
        'A separate cue device is not available yet; cue is mixed into main',
      )
      mode = 'off'
    }
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
      this.main,
      this.cue,
      this.master,
      this.limiter,
      this.splitMain,
      this.splitCue,
      this.merger,
    ])
      node.disconnect()
    this.main.connect(this.master)
    const output = this.limited
      ? this.master.connect(this.limiter)
      : this.master
    if (this.mode === 'off') {
      this.context.destination.channelCount = 2
      this.cue.connect(this.master)
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
    clearInterval(this.timer)
    await this.context.close()
  }
}
