import type { Instrument } from '../../src/shared/model'
import type { Preset, SynthBackend } from '../../src/engine/synth/backend'
export class FakeBackend implements SynthBackend {
  readonly id = 'web'
  events: {
    type: string
    slot?: string
    key?: number
    value?: number
    cc?: number
  }[] = []
  private serial = 0
  async loadSoundFont(): Promise<void> {}
  async listPresets(): Promise<Preset[]> {
    return []
  }
  async allocate(instrument: Instrument): Promise<string> {
    const slot = `${instrument.id}-${++this.serial}`
    this.events.push({ type: 'allocate', slot })
    return slot
  }
  release(slot: string): void {
    this.events.push({ type: 'release', slot })
  }
  configure(slot: string): void {
    this.events.push({ type: 'configure', slot })
  }
  noteOn(slot: string, key: number, value: number): void {
    this.events.push({ type: 'on', slot, key, value })
  }
  noteOff(slot: string, key: number): void {
    this.events.push({ type: 'off', slot, key })
  }
  cc(slot: string, cc: number, value: number): void {
    this.events.push({ type: 'cc', slot, cc, value })
  }
  pitchBend(slot: string, value: number): void {
    this.events.push({ type: 'bend', slot, value })
  }
  channelPressure(slot: string, value: number): void {
    this.events.push({ type: 'pressure', slot, value })
  }
  polyPressure(slot: string, key: number, value: number): void {
    this.events.push({ type: 'poly', slot, key, value })
  }
  allNotesOff(): void {
    this.events.push({ type: 'panic' })
  }
  latencySec(): number {
    return 0
  }
}
