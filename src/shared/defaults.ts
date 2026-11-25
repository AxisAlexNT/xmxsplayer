import { defaultBindings, defaultMappings } from './default-bindings'
import type { Project, Settings } from './model'

export function newProject(name = 'Untitled'): Project {
  return {
    record: { mode: 'overdub', preRollBars: 0 },
    orchestras: [],
    version: 1,
    name,
    tempos: [{ tick: 0, bpm: 120 }],
    timeSigs: [{ tick: 0, num: 4, den: 4 }],
    keySigs: [{ tick: 0, fifths: 0, minor: false }],
    beatAnchors: [],
    mapOwner: null,
    lengthTicks: 7680,
    soundfonts: [],
    instruments: [],
    tracks: [],
    sources: [],
    registers: Array.from({ length: 8 }, (_, i) => ({
      name: `Register ${i + 1}`,
      mode: 'toggle',
    })),
    base: {
      zones: [],
      patch: [],
      bindings: structuredClone(defaultBindings),
      trackModes: {},
      padColors: {},
      beatChase: 'top',
    },
    scenes: [],
    cues: [],
    clips: [],
    mappings: structuredClone(defaultMappings),
    script: '',
    loop: { enabled: false, startTick: 0, endTick: 7680 },
    follow: {
      mode: 'written',
      strictness: 'any',
      chordWindowMs: 150,
      earlyMs: 200,
      range: [0.5, 1.5],
      smoothing: 0.35,
      phaseGain: 0.5,
    },
    metronome: {
      audible: false,
      visualScreen: true,
      visualPads: true,
      countInBars: 1,
      toCue: false,
    },
    view: {
      lanes: 'per-track',
      follow: 'page',
      staffScale: 40,
      staffTheme: 'dark',
      pxPerQuarter: 75,
      laneZoom: 1,
    },
  }
}
export function defaultSettings(): Settings {
  return {
    locale: 'en',
    tempoMode: 'scale',
    chaseCuesOnSeek: true,
    audio: {
      defaultSynth: 'web',
      bufferSize: 0,
      sampleRate: 48000,
      limiter: true,
      mainDeviceId: '',
      cue: { mode: 'off', deviceId: '' },
      compensationMs: { web: 0, fluid: 0, midi: 0 },
      inputLatencyMs: 0,
    },
    fluid: {
      path: '',
      driver: '',
      periodSize: 256,
      periods: 2,
      gain: 0.5,
      extraArgs: [],
    },
    musescorePath: '',
    soundfontDirs: [],
    devices: { userProfiles: [], assignments: {}, arturiaForceProgram: false },
    trustedScripts: [],
    recent: [],
  }
}
