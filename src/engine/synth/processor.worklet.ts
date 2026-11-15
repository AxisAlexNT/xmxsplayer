import {
  BasicSynthesizerCore,
  type BasicSynthesizerMessage,
  type SynthCoreConfig,
} from 'spessasynth_lib'
import { ScheduledQueue } from './scheduled-queue'

declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}
declare function registerProcessor(
  name: string,
  processor: new (options: {
    processorOptions: SynthCoreConfig
  }) => AudioWorkletProcessor,
): void

type MidiMessage = Extract<BasicSynthesizerMessage, { type: 'midiMessage' }>
type CancelMessage = { type: 'xmxs:cancelScheduled'; channel: number }
class Core extends BasicSynthesizerCore {
  private pending = new ScheduledQueue<MidiMessage>()
  private closed = false
  private channelOutputs = new Array<Float32Array[]>(16)
  private dispatch = (message: MidiMessage): void => {
    message.data.options.time = 0
    super.handleMessage(message)
  }
  constructor(
    config: SynthCoreConfig,
    private port: MessagePort,
  ) {
    super(
      { ...config, sampleRate, initialTime: currentTime },
      (data, transfer) => port.postMessage(data, transfer ?? []),
    )
    void this.synthesizer.ready.then(() => {
      port.onmessage = (
        event: MessageEvent<BasicSynthesizerMessage | CancelMessage>,
      ) => this.receive(event.data)
      this.postReady('sf3Decoder', null)
    })
  }
  private receive(message: BasicSynthesizerMessage | CancelMessage): void {
    if (message.type === 'xmxs:cancelScheduled') {
      this.pending.cancel(message.channel)
      return
    }
    if (message.type === 'destroyWorklet') {
      this.pending.cancel()
      this.closed = true
    }
    if (message.type === 'midiMessage') {
      if (message.data.options.time > currentTime) {
        const status = message.data.messageData[0] ?? 0
        const channel =
          status < 0xf0 ? (status & 15) + message.data.channelOffset : -1
        this.pending.push(message.data.options.time, channel, message)
      } else this.dispatch(message)
    } else super.handleMessage(message)
  }
  render(outputs: Float32Array[][]): boolean {
    if (this.closed) return false
    this.startBlock()
    this.pending.drain(currentTime, this.dispatch)
    for (let i = 0; i < 16; i++) this.channelOutputs[i] = outputs[i + 2]
    this.synthesizer.process(
      outputs[0][0],
      outputs[0][1],
      undefined,
      undefined,
      this.channelOutputs,
    )
    this.reverbCapture?.moveCapturedData(
      outputs[1][0],
      outputs[1][1],
      0,
      outputs[1][0].length,
    )
    this.finishBlock()
    return true
  }
}
class SynthProcessor extends AudioWorkletProcessor {
  private core: Core
  constructor(options: { processorOptions: SynthCoreConfig }) {
    super()
    this.core = new Core(options.processorOptions, this.port)
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    return this.core.render(outputs)
  }
}
registerProcessor('spessasynth-worklet-processor', SynthProcessor)
