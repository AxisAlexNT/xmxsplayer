export type Timing = 'now' | 'beat' | 'bar'
export type TrackMode = 'auto' | 'live' | 'mute'
export type FollowMode = 'written' | 'waitNotes' | 'tempoTrack'
export interface KeyEvent {
  key: number
  vel: number
  on: boolean
  channel: number
  deviceId: string
  timestamp?: number
}
export interface ControlEvent {
  /** Alias of controlId, for concise control handlers. */
  id: string
  controlId: string
  deviceId: string
  value: number
  pressed: boolean
  edge: 'press' | 'release' | 'change'
  delta?: number
  timestamp?: number
}
export interface Zone {
  id: string
  lo: number
  hi: number
  trackIds: string[]
  transpose: number
  velocity: 'linear' | 'soft' | 'hard' | number
  color: string
}
export interface ScriptEvents {
  control: ControlEvent
  note: KeyEvent
  beat: { bar: number; beat: number }
  bar: { bar: number }
  cue: { id: string }
  scene: { id: string | null }
  transport: { playing: boolean; tick: number; holding: boolean; rate: number }
}
export type NoteHandler = (event: KeyEvent) => KeyEvent | KeyEvent[] | null
export interface XmApi {
  on(event: 'note', fn: NoteHandler): () => void
  on<K extends Exclude<keyof ScriptEvents, 'note'>>(
    event: K,
    fn: (event: ScriptEvents[K]) => void,
  ): () => void
  transport: {
    play(): void
    stop(): void
    seekBar(bar: number): void
    readonly bar: number
    readonly beat: number
    readonly playing: boolean
    readonly rate: number
    setRate(rate: number): void
    hold(): void
    release(): void
  }
  orchestra: {
    readonly current: string | null
    select(id: string, at?: Timing): void
  }
  scene: {
    activate(id: string | null, at?: Timing): void
    readonly current: string | null
  }
  registers: {
    get(index: number): boolean
    set(index: number, on: boolean): void
    toggle(index: number): void
  }
  zones: { set(zones: Zone[]): void }
  patch: { set(trackId: string, instrumentIds: string[]): void }
  track(id: string): {
    mode: TrackMode
    playNote(key: number, vel: number, beats: number): void
  }
  clip(id: string): {
    launch(): void
    stop(): void
    readonly playing: boolean
    semitones: number
    gain: number
  }
  follow: { readonly mode: FollowMode; set(mode: FollowMode): void }
  pad(n: number): { color: string }
  display(line1: string, line2: string): void
  state: Record<string, unknown>
  log(message: string): void
}
export interface ScriptStatus {
  hash: string
  state: 'empty' | 'checking' | 'untrusted' | 'running' | 'error' | 'disabled'
  error?: string
}
