import type { Settings } from './model'

export type FluidConfig = Settings['fluid'] & { sampleRate: number }
export interface FluidPreset {
  bank: number
  program: number
  name: string
  isDrum: boolean
}
export type FluidEvent =
  | { type: 'ready'; generation: number }
  | { type: 'exit'; code: number | null; restarting: boolean }
  | { type: 'log'; message: string }

export function fluidInteger(value: number, max: number): string {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw Error(`FluidSynth value must be an integer from 0 to ${max}`)
  return String(value)
}
export function fluidPath(path: string): string {
  const windows = /^[a-z]:\\|^\\\\/i.test(path)
  if (
    !path ||
    path.includes('"') ||
    [...path].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    (!windows && path.includes('\\'))
  )
    throw Error('FluidSynth font path contains an unsupported character')
  return `"${windows ? path.replaceAll('\\', '/') : path}"`
}
export function fluidLoad(path: string): string {
  return `load ${fluidPath(path)} 0`
}
export function fluidSelect(
  channel: number,
  font: number,
  bank: number,
  program: number,
): string {
  return `select ${fluidInteger(channel, 63)} ${fluidInteger(font, 2147483647)} ${fluidInteger(bank, 16383)} ${fluidInteger(program, 127)}`
}
export function fluidMidi(
  command: 'noteon' | 'noteoff' | 'cc' | 'pitch_bend',
  channel: number,
  a: number,
  b?: number,
): string {
  const fields = [
    command,
    fluidInteger(channel, 63),
    fluidInteger(a, command === 'pitch_bend' ? 16383 : 127),
  ]
  if (command === 'noteon' || command === 'cc') {
    if (b === undefined) throw Error('FluidSynth command needs a value')
    fields.push(fluidInteger(b, 127))
  } else if (b !== undefined) throw Error('Unexpected FluidSynth value')
  return fields.join(' ')
}
export function validateFluidLine(line: string): void {
  if (typeof line !== 'string' || line.length > 512 || /[\r\n\0]/u.test(line))
    throw Error('Invalid FluidSynth command')
  const [command, ...args] = line.split(' ')
  const values = args.map(Number)
  if (args.some((a) => !/^\d+$/.test(a)))
    throw Error('Invalid FluidSynth arguments')
  if (command === 'select' && values.length === 4) {
    fluidSelect(values[0], values[1], values[2], values[3])
    return
  }
  if (
    ['noteon', 'noteoff', 'cc', 'pitch_bend'].includes(command) &&
    values.length === (command === 'noteon' || command === 'cc' ? 3 : 2)
  ) {
    fluidMidi(
      command as 'noteon' | 'noteoff' | 'cc' | 'pitch_bend',
      values[0],
      values[1],
      values[2],
    )
    return
  }
  if (command === 'reset' && !args.length) return
  throw Error('Unsupported FluidSynth command')
}
export function parseFluidFont(reply: string): number {
  const id = /loaded SoundFont has ID (\d+)/.exec(reply)?.[1]
  if (!id)
    throw Error(`FluidSynth could not load font: ${reply.trim().slice(-1000)}`)
  return Number(id)
}
export function parseFluidPresets(reply: string): FluidPreset[] {
  return reply.split(/\r?\n/).flatMap((line) => {
    const match = /^(\d+)-(\d+)\s+(.+)$/.exec(line.trim())
    if (!match) return []
    const bank = Number(match[1]),
      program = Number(match[2])
    return [
      {
        bank,
        program,
        name: match[3].trim(),
        isDrum:
          (bank & 128) !== 0 || (bank & 127) === 120 || (bank & 127) === 127,
      },
    ]
  })
}
export function fluidArgs(
  config: FluidConfig,
  platform = process.platform,
): string[] {
  const driver = config.driver || (platform === 'win32' ? 'wasapi' : 'pipewire')
  if (!/^[a-z0-9_-]+$/i.test(driver))
    throw Error('Invalid FluidSynth audio driver')
  if (![44100, 48000].includes(config.sampleRate))
    throw Error('Unsupported FluidSynth sample rate')
  if (
    !Number.isInteger(config.periodSize) ||
    config.periodSize < 64 ||
    config.periodSize > 8192 ||
    !Number.isInteger(config.periods) ||
    config.periods < 2 ||
    config.periods > 64
  )
    throw Error('Invalid FluidSynth buffer configuration')
  if (!Number.isFinite(config.gain) || config.gain < 0 || config.gain > 5)
    throw Error('FluidSynth gain must be from 0 to 5')
  if (
    !Array.isArray(config.extraArgs) ||
    config.extraArgs.length > 64 ||
    config.extraArgs.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.length > 4096 ||
        /[\r\n\0]/u.test(arg) ||
        /^-(?!-)[^=]*[isfF]/.test(arg) ||
        /^(?:--no-shell|--server|--load-config|--fast-render)(?:=|$)/.test(arg),
    )
  )
    throw Error(
      'FluidSynth extra arguments must preserve the stdin command interface',
    )
  return [
    ...config.extraArgs,
    '-n',
    '-a',
    driver,
    '-r',
    String(config.sampleRate),
    '-z',
    String(config.periodSize),
    '-c',
    String(config.periods),
    '-g',
    String(config.gain),
    '-o',
    'synth.midi-channels=64',
    ...(driver === 'jack'
      ? ['-o', 'audio.jack.autoconnect=1', '-o', 'audio.jack.id=xmxsplayer']
      : []),
  ]
}
