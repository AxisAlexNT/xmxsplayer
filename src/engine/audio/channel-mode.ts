import type { AudioTrack } from '../../shared/model'
export type ChannelMatrix = readonly [
  readonly [number, number],
  readonly [number, number],
]
export function channelMatrix(mode: AudioTrack['channelMode']): ChannelMatrix {
  switch (mode) {
    case 'stereo':
      return [
        [1, 0],
        [0, 1],
      ]
    case 'left':
      return [
        [1, 0],
        [1, 0],
      ]
    case 'right':
      return [
        [0, 1],
        [0, 1],
      ]
    case 'mid':
      return [
        [0.5, 0.5],
        [0.5, 0.5],
      ]
    case 'side':
      return [
        [0.5, -0.5],
        [0.5, -0.5],
      ]
  }
}
export class ChannelMode {
  private split: ChannelSplitterNode
  readonly output: ChannelMergerNode
  private gains: GainNode[][]
  constructor(context: BaseAudioContext, input: AudioNode) {
    this.split = context.createChannelSplitter(2)
    input.connect(this.split)
    this.output = context.createChannelMerger(2)
    this.gains = Array.from({ length: 2 }, (_, out) =>
      Array.from({ length: 2 }, (_, source) => {
        const gain = context.createGain()
        this.split.connect(gain, source)
        gain.connect(this.output, 0, out)
        return gain
      }),
    )
  }
  set(mode: AudioTrack['channelMode']): void {
    const values = channelMatrix(mode)
    this.gains.forEach((row, i) =>
      row.forEach((gain, j) => {
        gain.gain.value = values[i][j]
      }),
    )
  }
  close(): void {
    this.split.disconnect()
    this.gains.flat().forEach((g) => g.disconnect())
    this.output.disconnect()
  }
}
