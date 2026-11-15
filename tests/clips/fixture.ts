import { vi } from 'vitest'
import type { Clip } from '../../src/shared/model'
import type { AudioRoute } from '../../src/engine/audio/graph'
import type { StretchNode, StretchSchedule } from 'signalsmith-stretch'
export const clip = (id = 'loop', overrides: Partial<Clip> = {}): Clip => ({
  id,
  name: id,
  color: '#4cc2ff',
  file: 'audio/loop.wav',
  startSec: 1,
  endSec: 3,
  loop: true,
  sync: true,
  beats: 4,
  launch: 'toggle',
  quantize: 'bar',
  gain: 0.8,
  pan: 0,
  toCue: false,
  pressureToGain: false,
  semitones: 0,
  pitchMode: 'keepTempo',
  fadeMs: 10,
  sweep: { mode: 'moving', range: [-12, 12], releaseMs: 300, offBelow: 0.02 },
  ...overrides,
})
export class Parameter {
  value = 0
  events: { type: string; value?: number; time: number }[] = []
  cancelAndHoldAtTime(time: number): void {
    this.events = this.events.filter((e) => e.time < time)
    this.events.push({ type: 'hold', time })
  }
  cancelScheduledValues(time: number): void {
    this.events = this.events.filter((e) => e.time < time)
  }
  setValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ type: 'ramp', value, time })
  }
}
export function audioFixture(now: () => number, sampleRate = 1000) {
  const gains: Parameter[] = [],
    pans: Parameter[] = [],
    scheduled: StretchSchedule[] = [],
    history: StretchSchedule[] = []
  const channel0 = Float32Array.from({ length: sampleRate * 4 }, (_, i) => i),
    channel1 = Float32Array.from(channel0, (n) => -n)
  const context = {
    sampleRate,
    get currentTime() {
      return now()
    },
    createGain: () => {
      const gain = new Parameter()
      gains.push(gain)
      return { gain, connect: vi.fn(), disconnect: vi.fn() }
    },
    createStereoPanner: () => {
      const pan = new Parameter()
      pans.push(pan)
      return { pan, connect: vi.fn(), disconnect: vi.fn() }
    },
  } as unknown as AudioContext
  const node = {
    addBuffers: vi.fn(
      async (channels: Float32Array[]) => channels[0].length / sampleRate,
    ),
    schedule: vi.fn(async (change: StretchSchedule) => {
      history.push({ ...change })
      for (let i = scheduled.length - 1; i >= 0; i--)
        if (scheduled[i].output >= change.output) scheduled.splice(i, 1)
      scheduled.push({ ...change })
    }),
    stop: vi.fn(async () => undefined),
    dropBuffers: vi.fn(async () => ({ start: 0, end: 0 })),
    connect: vi.fn(),
    disconnect: vi.fn(),
    addEventListener: vi.fn(),
    port: {
      close: vi.fn(),
      postMessage: vi.fn((message: { changes: StretchSchedule[] }) => {
        scheduled.splice(
          0,
          scheduled.length,
          ...message.changes.map((change) => ({ ...change })),
        )
        history.push(...message.changes.map((change) => ({ ...change })))
      }),
    },
  } as unknown as StretchNode
  const decoded = {
    key: 'file',
    sampleRate,
    durationSec: 4,
    peaks: [0.1],
    buffer: {
      sampleRate,
      length: channel0.length,
      numberOfChannels: 2,
      getChannelData: (n: number) => (n ? channel1 : channel0),
    } as AudioBuffer,
  }
  const route: AudioRoute = {
    context,
    destination: {} as AudioNode,
    timeAt: (t) => t,
  }
  return { context, node, route, decoded, gains, pans, scheduled, history }
}
