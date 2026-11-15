import type { RecordedTake } from './recording'
import type { AudioPeaks, AudioSource } from './audio'
import type {
  Action,
  ControlDef,
  Id,
  Note,
  Project,
  Settings,
  Setup,
  Timing,
  SoundFontRef,
} from './model'

export type ProjectMeta = Project
export interface CommandMap {
  ping: undefined
  'audio:scope': { folder: string }
  'grid:tapMap': {
    trackId: Id
    active: boolean
    unit: 'beat' | 'bar'
    discard?: boolean
  }
  'grid:apply': { trackId: Id; anchors: Project['beatAnchors'] }
  'grid:barOne': { trackId: Id }
  'project:meta': ProjectMeta
  'track:notes': { trackId: Id; notes: Note[] }
  'settings:set': Settings
  'action:run': { action: Action; value?: number; at?: Timing }
  'transport:seek': { tick: number }
  'transport:setRate': { rate: number }
  'transport:setLoop': Project['loop']
  'scene:activate': { sceneId: Id | null }
  'register:set': { index: number; on: boolean }
  'live:note': { key: number; vel: number; on: boolean; source?: string }
  'track:audition': {
    trackId: Id
    key: number
    vel: number
    on: boolean
    source: string
  }
  audition: { instrumentId: Id; key: number; on: boolean }
  'learn:start': { controlId?: string }
  'learn:stop': undefined
  'device:assign': { portName: string; profileId: string }
  'audition:select': {
    soundfontId: Id
    bank: number
    program: number
    isDrum: boolean
  } | null
  'audition:preset': {
    soundfontId: Id
    bank: number
    program: number
    isDrum: boolean
    key: number
    on: boolean
  }
  panic: undefined
}
export interface TransportState {
  playing: boolean
  recording: boolean
  holding: boolean
  tick: number
  rate: number
  followFactor: number
  perfTime: number
  countInBeat?: number
}
export interface RuntimeState {
  activeSceneId: Id | null
  registers: boolean[]
  armedCueId: Id | null
  pendingActions: { action: Action; tick: number }[]
  expectedNext: { tick: number; keys: number[] } | null
  clips: Record<Id, 'stopped' | 'queued' | 'playing'>
  effective: Pick<Setup, 'zones' | 'patch'>
}
export interface LogEntry {
  level: 'info' | 'ok' | 'warn' | 'error'
  source: string
  message: string
}
export interface EventMap {
  ready: undefined
  'grid:taps': {
    active: boolean
    trackId: Id | null
    anchors: Project['beatAnchors']
    unit: 'beat' | 'bar'
  }
  'audio:peaks': AudioPeaks & { trackId: Id; file: string; key: string }
  'audio:state': { trackId: Id; loading: boolean; error?: string }
  'synth:state': { loading: boolean; readyIds: Id[] }
  transport: TransportState
  runtime: RuntimeState
  'midi:ports': {
    inputs: { id: string; name: string }[]
    outputs: { id: string; name: string }[]
    devices: { id: string; profileId: string; name: string }[]
  }
  control: {
    deviceId: string
    controlId: string
    value: number
    pressed: boolean
    edge?: 'press' | 'release' | 'change'
    delta?: number
    timestamp?: number
  }
  'learn:captured': { deviceId: string; control: ControlDef }
  keys: { held: { key: number; trackIds: Id[] }[] }
  activity: { trackIds: Id[]; instrumentIds: Id[] }
  recorded: { trackId: Id; notes: Note[] } | RecordedTake
  'doc:patch': Partial<Project>
  latency: {
    baseMs: number
    outputMs: number
    backend: string
    fluidMs: number
    sampleRate?: number
    bufferSize?: Settings['audio']['bufferSize']
  }
  log: LogEntry
  app: { cmd: string }
}
export interface RequestMap {
  'recording:flush': { input: undefined; output: undefined }
  'soundfont:resolve': { input: SoundFontRef; output: string | null }
  'soundfont:presets': {
    input: { soundfontId: Id }
    output: { bank: number; program: number; name: string; isDrum: boolean }[]
  }
  'audio:resolve': {
    input: { file: string; sampleRate: number }
    output: AudioSource
  }
  'audio:cache': {
    input: { file: string; key: string; data: AudioPeaks }
    output: undefined
  }
  'audio:load': {
    input: { trackId: Id; url: string; file?: string }
    output: { durationSec: number; peaks: number[]; sampleRate?: number }
  }
  'audio:devices': { input: undefined; output: { id: string; label: string }[] }
}
type Messages<M, K extends 'cmd' | 'evt'> = {
  [N in keyof M]: { kind: K; name: N; payload: M[N] }
}[keyof M]
export type Envelope =
  | Messages<CommandMap, 'cmd'>
  | Messages<EventMap, 'evt'>
  | {
      [N in keyof RequestMap]:
        | { kind: 'req'; name: N; payload: RequestMap[N]['input']; rid: string }
        | {
            kind: 'res'
            name: N
            payload: RequestMap[N]['output']
            rid: string
            error?: string
          }
    }[keyof RequestMap]
