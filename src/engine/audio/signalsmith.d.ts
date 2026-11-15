declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    output: number
    input?: number
    rate?: number
    semitones?: number
    loopStart?: number
    loopEnd?: number
    active?: boolean
  }
  export interface StretchNode extends AudioWorkletNode {
    inputTime: number
    addBuffers(buffers: Float32Array[]): Promise<number>
    dropBuffers(): Promise<{ start: number; end: number }>
    latency(): Promise<number>
    schedule(change: StretchSchedule): Promise<unknown>
    stop(when?: number): Promise<unknown>
    setUpdateInterval(
      seconds: number,
      callback?: (time: number) => void,
    ): Promise<void>
  }
  const create: ((
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ) => Promise<StretchNode>) & { moduleUrl?: string }
  export default create
}
