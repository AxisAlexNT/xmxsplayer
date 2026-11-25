import type { Instrument, SoundFontRef } from '../../shared/model'
export type SlotId = string
export type SynthSelector = (instrument: Instrument) => SynthBackend
export type SynthTiming = (backend: SynthBackend) => number
export interface Preset {
  bank: number
  program: number
  name: string
  isDrum: boolean
}
export interface SynthBackend {
  readonly id: 'web' | 'fluid' | 'midi' | 'plugin'
  loadSoundFont(sf: SoundFontRef, url: string): Promise<void>
  listPresets(soundfontId: string): Promise<Preset[]>
  allocate(instrument: Instrument, ownerId?: string): Promise<SlotId>
  release(slot: SlotId): void
  configure(slot: SlotId, instrument: Instrument): void
  noteOn(slot: SlotId, key: number, vel: number, whenCtx?: number): void
  noteOff(slot: SlotId, key: number, whenCtx?: number): void
  cc(slot: SlotId, cc: number, value: number, whenCtx?: number): void
  pitchBend(slot: SlotId, value14: number, whenCtx?: number): void
  channelPressure(slot: SlotId, value: number): void
  polyPressure(slot: SlotId, key: number, value: number): void
  clearScheduled(slot: SlotId): void
  allNotesOff(): void
  latencySec(): number
}
