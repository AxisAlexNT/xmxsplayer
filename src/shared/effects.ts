export const effectTypes = [
  'eq',
  'filter',
  'drive',
  'compressor',
  'pump',
  'delay',
  'reverb',
  'chorus',
  'width',
  'limiter',
] as const
export type EffectType = (typeof effectTypes)[number]

export interface Effect {
  id: string
  type: EffectType
  enabled: boolean
  params: Record<string, number>
  trigger?: { trackId: string }
  preset?: string
}

export interface EffectParameter {
  label: string
  min: number
  max: number
  initial: number
  step: number
  unit: string
}
function knob(
  label: string,
  min: number,
  max: number,
  initial: number,
  step: number,
  unit = '',
): EffectParameter {
  return { label, min, max, initial, step, unit }
}
const frequency = (label: string, initial: number) =>
  knob(label, 20, 20000, initial, 1, 'Hz')
const gain = (label: string) => knob(label, -24, 24, 0, 0.1, 'dB')
const mix = (initial: number) => knob('Mix', 0, 1, initial, 0.01)
const threshold = (initial: number) =>
  knob('Threshold', -60, 0, initial, 0.1, 'dB')
const attack = (initial: number) =>
  knob('Attack', 0.001, 1, initial, 0.001, 's')
const release = (initial: number) =>
  knob('Release', 0.01, 1, initial, 0.01, 's')

export const effectParameters: Record<
  EffectType,
  Record<string, EffectParameter>
> = {
  eq: {
    low: gain('Bass'),
    mid: gain('Midrange'),
    high: gain('Treble'),
    highpass: frequency('Low cut', 20),
    lowpass: frequency('High cut', 20000),
  },
  filter: {
    mode: knob('Filter mode', 0, 2, 0, 1),
    cutoff: frequency('Cutoff', 2500),
    resonance: knob('Resonance', 0.1, 20, 1, 0.1),
    rate: knob('LFO rate', 0.05, 20, 1, 0.05, 'Hz'),
    sync: knob('Tempo sync', 0, 1, 0, 1),
    beats: knob('LFO cycle', 0.0625, 8, 1, 0.0625, 'beats'),
    depth: knob('LFO depth', 0, 4800, 0, 1, 'cents'),
  },
  drive: { drive: knob('Drive', 0, 40, 12, 0.1, 'dB'), mix: mix(1) },
  compressor: {
    threshold: threshold(-18),
    ratio: knob('Ratio', 1, 20, 4, 0.1),
    attack: attack(0.01),
    release: release(0.25),
    knee: knob('Knee', 0, 40, 12, 0.1, 'dB'),
  },
  pump: {
    depth: knob('Depth', 0, 1, 0.65, 0.01),
    attack: attack(0.01),
    release: release(0.25),
    curve: knob('Curve', 0, 1, 0.5, 0.01),
  },
  delay: {
    beats: knob('Echo interval', 0.0625, 4, 0.75, 0.0625, 'beats'),
    feedback: knob('Feedback', 0, 0.95, 0.35, 0.01),
    damping: frequency('Damping', 4500),
    pingPong: knob('Ping-pong', 0, 1, 1, 1),
    mix: mix(0.25),
  },
  reverb: {
    size: knob('Room size', 0.05, 5, 1.4, 0.05, 's'),
    decay: knob('Decay', 0.1, 8, 3, 0.1),
    damping: knob('Damping', 0, 1, 0.5, 0.01),
    preDelay: knob('Pre-delay', 0, 0.25, 0.02, 0.001, 's'),
    mix: mix(0.25),
  },
  chorus: {
    rate: knob('Rate', 0.05, 10, 1, 0.05, 'Hz'),
    depth: knob('Depth', 0, 0.015, 0.004, 0.001, 's'),
    mix: mix(0.35),
  },
  width: { width: knob('Stereo width', 0, 2, 1, 0.01) },
  limiter: { threshold: threshold(-1), release: release(0.08) },
}

export function effectDefaults(type: EffectType): Record<string, number> {
  return Object.fromEntries(
    Object.entries(effectParameters[type]).map(([name, spec]) => [
      name,
      spec.initial,
    ]),
  )
}
