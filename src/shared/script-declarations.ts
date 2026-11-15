// Standalone declarations written into each project folder.
export const scriptDeclarations = `// Project script API. Script execution is enabled by the performance system.
type Timing = 'now' | 'beat' | 'bar';
type TrackMode = 'auto' | 'live' | 'mute';
type FollowMode = 'written' | 'waitNotes' | 'tempoTrack';
interface KeyEvent { key: number; vel: number; on: boolean; channel: number; deviceId: string }
interface ControlEvent { deviceId: string; controlId: string; value: number; pressed: boolean }
interface Zone { id: string; lo: number; hi: number; trackIds: string[]; transpose: number; velocity: 'linear' | 'soft' | 'hard' | number; color: string }
interface ScriptEvents {
  control: ControlEvent; note: KeyEvent; beat: { bar: number; beat: number }; bar: { bar: number };
  cue: { id: string }; scene: { id: string | null }; transport: { playing: boolean; tick: number };
}
interface XmApi {
  on(event: 'note', fn: (event: KeyEvent) => KeyEvent | KeyEvent[] | null): () => void;
  on<K extends Exclude<keyof ScriptEvents, 'note'>>(event: K, fn: (event: ScriptEvents[K]) => void): () => void;
  transport: { play(): void; stop(): void; seekBar(bar: number): void; readonly bar: number; readonly beat: number; readonly playing: boolean; readonly rate: number; setRate(rate: number): void; hold(): void; release(): void };
  scene: { activate(id: string, at?: Timing): void; readonly current: string | null };
  registers: { get(index: number): boolean; set(index: number, on: boolean): void; toggle(index: number): void };
  zones: { set(zones: Zone[]): void };
  patch: { set(trackId: string, instrumentIds: string[]): void };
  track(id: string): { mode: TrackMode; playNote(key: number, vel: number, beats: number): void };
  follow: { readonly mode: FollowMode; set(mode: FollowMode): void };
  pad(n: number): { color: string };
  display(line1: string, line2: string): void;
  state: Record<string, unknown>;
  log(message: string): void;
}
declare const xm: XmApi;
`
