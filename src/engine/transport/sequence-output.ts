import type { MidiTrack, Project, SoundFontRef } from '../../shared/model'
import type { SynthBackend } from '../synth/backend'
import { InstrumentRack, type RackSlot } from '../synth/rack'
import type { ScheduledNote, SchedulerOutput } from './scheduler'
interface Voice {
  slot: RackSlot
  key: number
  on: number
  off?: number
}
export class SequenceOutput implements SchedulerOutput {
  private rack: InstrumentRack
  private tracks = new Map<string, RackSlot[]>()
  private voices = new Map<string, Voice[]>()
  constructor(
    private backend: SynthBackend,
    load: (font: SoundFontRef) => Promise<void>,
    private now: () => number,
    warn: (message: string) => void,
    readonly beat: (tick: number, when: number) => void,
  ) {
    this.rack = new InstrumentRack(backend, load, warn)
  }
  async synchronize(project: Project): Promise<void> {
    this.reset(false)
    const instruments = project.base.patch.flatMap((conn) => {
      const track = project.tracks.find((t) => t.id === conn.trackId),
        instrument = project.instruments.find((i) => i.id === conn.instrumentId)
      if (!track || track.kind !== 'midi' || !instrument || conn.when) return []
      return [
        {
          ...instrument,
          id: `seq:${conn.id}`,
          volume: instrument.volume * track.volume,
          pan: Math.max(-1, Math.min(1, instrument.pan + track.pan)),
          transpose: instrument.transpose + (conn.transpose ?? 0),
        },
      ]
    })
    await this.rack.synchronize({ ...project, instruments })
    this.tracks.clear()
    for (const conn of project.base.patch) {
      const slot = this.rack.get(`seq:${conn.id}`)
      if (!slot) continue
      const slots = this.tracks.get(conn.trackId) ?? []
      slots.push(slot)
      this.tracks.set(conn.trackId, slots)
    }
  }
  noteOn(note: ScheduledNote, when: number): void {
    const voices: Voice[] = []
    for (const slot of this.tracks.get(note.track.id) ?? []) {
      const key = note.note[2] + slot.instrument.transpose
      if (key < 0 || key > 127) continue
      slot.backend.noteOn(slot.slot, key, note.note[3], when)
      voices.push({ slot, key, on: when })
    }
    this.voices.set(note.id, voices)
  }
  noteOff(note: ScheduledNote, when: number): void {
    for (const voice of this.voices.get(note.id) ?? []) {
      voice.slot.backend.noteOff(voice.slot.slot, voice.key, when)
      voice.off = when
    }
  }
  event(
    track: MidiTrack,
    event: MidiTrack['events'][number],
    when: number,
  ): void {
    for (const slot of this.tracks.get(track.id) ?? []) {
      if (event.type === 'bend')
        slot.backend.pitchBend(slot.slot, event.value, when)
      else {
        let value = event.value
        if (event.num === 7) value = Math.round(value * slot.instrument.volume)
        if (event.num === 10)
          value = Math.round(
            Math.max(0, Math.min(127, value + slot.instrument.pan * 63.5)),
          )
        slot.backend.cc(slot.slot, event.num, value, when)
      }
    }
  }
  chase(track: MidiTrack, tick: number, when: number): void {
    const controls = new Map<number, number>([
      [64, 0],
      [1, 0],
      [7, 127],
      [10, 64],
    ])
    let bend = 8192
    for (const e of track.events) {
      if (e.tick > tick) continue
      if (e.type === 'bend') bend = e.value
      else controls.set(e.num, e.value)
    }
    for (const [num, value] of controls)
      this.event(track, { tick, type: 'cc', num, value }, when)
    this.event(track, { tick, type: 'bend', num: 0, value: bend }, when)
  }
  boundary(when: number): void {
    for (const slots of this.tracks.values())
      for (const slot of slots) {
        slot.backend.cc(slot.slot, 64, 0, when)
        slot.backend.cc(slot.slot, 123, 0, when)
      }
    for (const voices of this.voices.values())
      for (const voice of voices)
        if (voice.off === undefined || voice.off > when) voice.off = when
  }
  reset(keepHeld: boolean): void {
    const now = this.now()
    this.collect(now)
    for (const slots of this.tracks.values())
      for (const slot of slots) {
        this.backend.clearScheduled(slot.slot)
        if (!keepHeld) {
          this.backend.cc(slot.slot, 64, 0)
          this.backend.cc(slot.slot, 120, 0)
        }
      }
    for (const [id, voices] of this.voices) {
      const retained = keepHeld ? voices.filter((v) => v.on <= now) : []
      if (!retained.length) this.voices.delete(id)
      else {
        for (const v of retained) v.off = undefined
        this.voices.set(id, retained)
      }
    }
  }
  hasNote(id: string): boolean {
    return this.voices.has(id)
  }
  collect(now: number): void {
    for (const [id, voices] of this.voices)
      if (voices.every((v) => v.off !== undefined && v.off <= now))
        this.voices.delete(id)
  }
  close(): void {
    this.reset(false)
    this.rack.close()
  }
}
