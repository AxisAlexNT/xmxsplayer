import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/defaults'
import {
  fluidArgs,
  fluidLoad,
  fluidMidi,
  fluidSelect,
  parseFluidFont,
  parseFluidPresets,
  validateFluidLine,
} from '../../src/shared/fluid'
import { fluidCandidates } from '../../src/main/fluidsynth'

describe('FluidSynth commands', () => {
  it('quotes paths with spaces, normalizes Windows separators and rejects command injection', () => {
    expect(fluidLoad('C:\\Sound fonts\\Piano.sf2')).toBe(
      'load "C:/Sound fonts/Piano.sf2" 0',
    )
    for (const path of [
      '',
      'font\nquit',
      'font\rreset',
      'font\0.sf2',
      'font".sf2',
      'font\t.sf2',
      '/tmp/..\\secret.sf2',
    ])
      expect(() => fluidLoad(path)).toThrow()
  })
  it('formats channel messages and rejects invalid ranges and extra commands', () => {
    expect(fluidMidi('noteon', 63, 60, 100)).toBe('noteon 63 60 100')
    expect(fluidMidi('noteoff', 25, 60)).toBe('noteoff 25 60')
    expect(fluidMidi('pitch_bend', 0, 8192)).toBe('pitch_bend 0 8192')
    expect(fluidSelect(9, 3, 128, 0)).toBe('select 9 3 128 0')
    for (const line of [
      'noteon 64 60 100',
      'cc 0 64 128',
      'noteoff 0 60 1',
      'noteon 0 60',
      'pitch_bend 0 16384',
      'select 0 1 -1 0',
      'reset\nquit',
      'source /tmp/commands',
      'echo marker',
      'load "font.sf2"',
    ])
      expect(() => validateFluidLine(line)).toThrow()
    for (const line of [
      'noteon 0 60 100',
      'noteoff 0 60',
      'cc 63 64 0',
      'pitch_bend 25 0',
      'select 9 3 128 0',
      'reset',
    ])
      expect(() => validateFluidLine(line)).not.toThrow()
  })
  it('parses returned font IDs and named presets without assuming the first font ID', () => {
    expect(
      parseFluidFont('> load "Piano.sf2" 0\nloaded SoundFont has ID 3\n'),
    ).toBe(3)
    expect(() => parseFluidFont('Failed to load font')).toThrow(
      /could not load font/,
    )
    expect(
      parseFluidPresets(
        '> inst 3\n000-000 Grand Piano\n128-025 TR-808\n> echo marker',
      ),
    ).toEqual([
      { bank: 0, program: 0, name: 'Grand Piano', isDrum: false },
      { bank: 128, program: 25, name: 'TR-808', isDrum: true },
    ])
  })
  it('uses platform drivers, 64 channels and JACK options while preserving stdin', () => {
    const config = { ...defaultSettings().fluid, sampleRate: 48000 }
    expect(fluidArgs(config, 'linux')).toEqual([
      '-n',
      '-a',
      'pipewire',
      '-r',
      '48000',
      '-z',
      '256',
      '-c',
      '2',
      '-g',
      '0.5',
      '-o',
      'synth.midi-channels=64',
    ])
    expect(fluidArgs(config, 'win32')).toContain('wasapi')
    expect(fluidArgs({ ...config, driver: 'jack' })).toContain(
      'audio.jack.autoconnect=1',
    )
    for (const extraArgs of [
      ['-i'],
      ['-ni'],
      ['-fconfig'],
      ['--server'],
      ['-f', 'config'],
    ])
      expect(() => fluidArgs({ ...config, extraArgs })).toThrow(/stdin/)
    expect(() => fluidArgs({ ...config, periodSize: 32 })).toThrow(/buffer/)
    expect(() => fluidArgs({ ...config, gain: NaN })).toThrow(/gain/)
  })
  it('uses an explicit executable without silently falling back', () => {
    expect(fluidCandidates('/path with spaces/fluidsynth')).toEqual([
      '/path with spaces/fluidsynth',
    ])
  })
})
