export const PPQ = 480
export type Id = string // readable slug, see section 4
export type Note = [tick: number, dur: number, key: number, vel: number]
export type Timing = 'now' | 'beat' | 'bar'

export interface Project {
  version: 1
  name: string
  tempos: { tick: number; bpm: number }[]
  timeSigs: { tick: number; num: number; den: number }[]
  keySigs: { tick: number; fifths: number; minor: boolean }[]
  beatAnchors: { tick: number; sec: number }[] // tapped beat map; [] = none
  mapOwner: Id | null // source id owning the maps, or null = editable
  lengthTicks: number
  soundfonts: SoundFontRef[]
  instruments: Instrument[]
  tracks: Track[] // array order = display order
  sources: Source[]
  registers: RegisterDef[] // length 8
  base: Setup
  scenes: Scene[]
  cues: Cue[]
  clips: Clip[]
  mappings: Record<string, ControllerMapping> // key = device profile id
  script: string // TypeScript source, may be ''
  loop: { enabled: boolean; startTick: number; endTick: number }
  follow: {
    mode: 'written' | 'waitNotes' | 'tempoTrack'
    strictness: 'any' | 'all'
    chordWindowMs: number
    earlyMs: number
    range: [number, number]
    smoothing: number
    phaseGain: number
  }
  metronome: {
    audible: boolean
    visualScreen: boolean
    visualPads: boolean
    countInBars: number
    toCue: boolean
  }
  view: {
    lanes: 'staff' | 'roll' | 'per-track'
    follow: 'page' | 'center'
    staffScale: number
    staffTheme: 'dark' | 'paper'
    pxPerQuarter: number
    laneZoom: number
  }
}

export interface SoundFontRef {
  id: Id
  file: string
} // file name only; resolved per PC
export interface Instrument {
  id: Id
  name: string
  color: string
  backend: 'default' | 'web' | 'fluid' | 'midi'
  soundfontId?: Id
  bank: number
  program: number
  isDrum: boolean
  midiOut?: { portName: string; channel: number }
  volume: number
  pan: number
  reverb: number
  chorus: number
  transpose: number
}

export type TrackMode = 'auto' | 'live' | 'mute'
export interface TrackBase {
  id: Id
  name: string
  color: string
  mode: TrackMode
  solo: boolean
  volume: number
  pan: number
  height: number
}
export interface MidiTrack extends TrackBase {
  kind: 'midi'
  notes: Note[] // sorted; immutable arrays (replace on edit)
  events: { tick: number; type: 'cc' | 'bend'; num: number; value: number }[]
  link?: {
    sourceId: Id
    key: string
    state: 'synced' | 'ahead'
    orphaned?: boolean
  }
  view: 'staff' | 'roll'
  clef: 'auto' | 'treble' | 'bass'
  quantGrid: number // ticks, staff rendering of generated parts (default 120)
  armed: boolean
  leads: boolean // drives follow modes when mode === 'live'
}
export interface AudioTrack extends TrackBase {
  kind: 'audio'
  file: string
  offsetSec: number
  durationSec: number
  semitones: number
  cents: number
  toCue: boolean
  channelMode: 'stereo' | 'left' | 'right' | 'mid' | 'side'
  filter: {
    enabled: boolean
    type: 'bandpass' | 'lowpass' | 'highpass'
    freq: number
    q: number
  }
}
export type Track = MidiTrack | AudioTrack

export interface Clip {
  id: Id
  name: string
  color: string
  file: string
  startSec: number
  endSec: number // fragment of a file in audio/
  loop: boolean // ignored (false) for launch 'oneShot'
  sync: boolean
  beats: number // when sync: fragment length in beats
  launch: 'toggle' | 'hold' | 'oneShot' | 'retrigger'
  quantize: Timing // start/stop timing; default 'bar' when sync, else 'now'
  group?: string // exclusive group
  gain: number
  pan: number
  toCue: boolean
  pressureToGain: boolean
  semitones: number
  pitchMode: 'keepTempo' | 'tape'
  fadeMs: number
  sweep: {
    mode: 'moving' | 'position' | 'pitchOnly' // behaviour when bound to a fader/knob/encoder (section 3.8)
    range: [number, number]
    releaseMs: number
    offBelow: number
  } // semitone range; release for 'moving'; off threshold for 'position'
}

export interface Source {
  id: Id
  file: string
  kind: 'mscz' | 'mid' | 'musicxml'
  durationTicks?: number
  lastSync?: string
  error?: string
}
export interface RegisterDef {
  name: string
  mode: 'toggle' | 'exclusive'
  group?: string
}

export interface Zone {
  id: Id
  lo: number
  hi: number
  trackIds: Id[]
  transpose: number
  velocity: 'linear' | 'soft' | 'hard' | number
  color: string
}
export interface PatchConn {
  id: Id
  trackId: Id
  instrumentId: Id
  when?: Condition
  transpose?: number
}

export type Condition =
  | { reg: number; on: boolean }
  | { scene: Id }
  | { bars: [from: number, to: number] }
  | { playing: boolean }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }

export type Action =
  | {
      type: 'transport'
      cmd:
        | 'toggle'
        | 'play'
        | 'pause'
        | 'stop'
        | 'record'
        | 'rewind'
        | 'forward'
        | 'toStart'
        | 'loopToggle'
        | 'loopStartHere'
        | 'loopEndHere'
        | 'tap'
        | 'tapBeat'
        | 'metronome'
        | 'scrub'
        | 'skipHold'
    }
  | { type: 'scene'; cmd: 'activate' | 'next' | 'prev' | 'clear'; sceneId?: Id }
  | {
      type: 'register'
      cmd: 'toggle' | 'set' | 'momentary'
      index: number
      on?: boolean
    }
  | { type: 'note'; trackId: Id; key: number; velocity: 'control' | number }
  | { type: 'param'; target: ParamTarget; id?: Id; min: number; max: number }
  | { type: 'trackMode'; trackId: Id; mode: TrackMode | 'cycle' }
  | { type: 'follow'; mode: Project['follow']['mode'] | 'cycle' }
  | { type: 'cue'; cmd: 'fireNext' | 'fire' | 'prev' | 'next'; cueId?: Id }
  | {
      type: 'clip'
      cmd:
        'launch' | 'stop' | 'sweep' | 'pitch' | 'gain' | 'stopAll' | 'stopGroup'
      clipId?: Id
      group?: string
    }
  | {
      type: 'app'
      cmd:
        | 'save'
        | 'undo'
        | 'redo'
        | 'quantize'
        | 'toggleFollowView'
        | 'toggleLanes'
        | 'zoomIn'
        | 'zoomOut'
        | 'insertBar'
        | 'deleteBar'
        | 'appendBar'
    }
  | { type: 'script'; fn: string }
export type ParamTarget =
  | 'rate'
  | 'masterVolume'
  | 'track.volume'
  | 'track.pan'
  | 'instrument.volume'
  | 'instrument.reverb'
  | 'instrument.chorus'
  | 'audio.semitones'
  | 'audio.filterFreq'

export interface Binding {
  control: string
  edge: 'press' | 'release' | 'change'
  when?: Condition
  at?: Timing
  action: Action
}
export interface Setup {
  zones: Zone[]
  patch: PatchConn[]
  bindings: Binding[]
  trackModes: Record<Id, TrackMode>
  padColors: Record<string, string>
  beatChase: 'off' | 'top' | 'bottom' | 'all'
}
export interface Scene extends Partial<Setup> {
  id: Id
  name: string
  color: string
  registers?: (boolean | null)[]
}
export interface ControllerMapping {
  bindings: Binding[]
  padColors: Record<string, string>
  beatChase?: Setup['beatChase']
  scenes: Record<
    Id,
    { bindings?: Binding[]; padColors?: Record<string, string> }
  >
}

export interface Cue {
  id: Id
  tick: number
  name: string
  trigger: 'auto' | 'armed' | 'wait'
  control?: string
  at?: Timing
  actions: Action[]
}

export interface DeviceProfile {
  id: string
  name: string
  ports: { role: 'main' | 'aux'; match: string[]; dir: 'in' | 'out' | 'both' }[]
  controls: ControlDef[]
  feedback?: 'arturia-mk3'
}
export interface ControlDef {
  id: string // pad.1..16 (9..16 = bank B), knob.1..9, fader.1..9, button.1..9, transport.play|stop|record|rewind|forward|loop|metronome|tap,
  // daw.save|quantize|undo|redo, context.1..4, encoder.main, encoder.main.press
  label: string
  kind: 'pad' | 'button' | 'knob' | 'fader' | 'encoder'
  msg?: { type: 'note' | 'cc'; channel: number | null; number: number }
  aliases?: NonNullable<ControlDef['msg']>[]
  mode: 'momentary' | 'absolute' | 'relative64'
  ledId?: number
  ui: { group: string; row: number; col: number }
}

export interface Settings {
  chaseCuesOnSeek?: boolean
  audio: {
    defaultSynth: 'web' | 'fluid'
    bufferSize: 0 | 128 | 256 | 512 | 1024
    sampleRate: 44100 | 48000
    limiter: boolean
    mainDeviceId: string
    cue: { mode: 'off' | 'channels34' | 'device'; deviceId: string }
    compensationMs: { web: number; fluid: number; midi: number }
    inputLatencyMs: number
  }
  fluid: {
    path: string
    driver: string
    periodSize: number
    periods: number
    gain: number
    extraArgs: string[]
  }
  musescorePath: string
  soundfontDirs: string[]
  devices: {
    userProfiles: DeviceProfile[]
    assignments: Record<string, string>
    arturiaForceProgram: boolean
  }
  trustedScripts: string[]
  recent: string[]
}
