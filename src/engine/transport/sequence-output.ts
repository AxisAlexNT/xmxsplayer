import type { ActivityRoute } from '../../shared/activity'
import type {
  MidiTrack,
  PatchConn,
  Project,
  SoundFontRef,
} from '../../shared/model'
import { allPatches, patchKey } from '../../shared/patches'
import {
  matchesCondition,
  type ConditionContext,
} from '../../shared/conditions'
import type { SynthBackend, SynthSelector, SynthTiming } from '../synth/backend'
import { InstrumentRack, type RackSlot } from '../synth/rack'
import type { ScheduledNote, SchedulerOutput } from './scheduler'
interface Voice {
  slot: RackSlot
  key: number
  on: number
  offset: number
  trackId: string
  instrumentId: string
  off?: number
}
export class SequenceOutput implements SchedulerOutput {
  private rack: InstrumentRack
  private tracks = new Map<string, { slot: RackSlot; patch: PatchConn }[]>()
  private slots = new Map<string, RackSlot>()
  private reachable = new Set<RackSlot>()
  private identities = new Map<RackSlot, string>()
  private voices = new Map<string, Voice[]>()
  private noteActivity = new Map<
    string,
    { trackId: string; on: number; off?: number }
  >()
  constructor(
    backend: SynthBackend,
    load: (font: SoundFontRef, backend?: SynthBackend) => Promise<void>,
    private now: () => number,
    warn: (message: string) => void,
    readonly beat: (tick: number, when: number) => void,
    private onReset: (keepHeld: boolean) => void = () => undefined,
    private condition: (tick: number) => ConditionContext = () => ({
      registers: [],
      activeSceneId: null,
      bar: 1,
      playing: false,
    }),
    private activityPulse: (route: ActivityRoute, when: number) => void = () =>
      undefined,
    choose?: SynthSelector,
    private timing: SynthTiming = () => 0,
  ) {
    this.rack = new InstrumentRack(backend, load, warn, false, choose)
  }
  async synchronize(
    project: Project,
    preserve = false,
    available: readonly PatchConn[] = allPatches(project),
    tick = 0,
  ): Promise<void> {
    if (!preserve) this.reset(false)
    const instruments = available.flatMap((conn) => {
      const track = project.tracks.find((t) => t.id === conn.trackId),
        instrument = project.instruments.find((i) => i.id === conn.instrumentId)
      if (!track || track.kind !== 'midi' || !instrument) return []
      return [
        {
          ...instrument,
          id: `seq:${patchKey(conn)}`,
          volume: instrument.volume * track.volume,
          pan: Math.max(-1, Math.min(1, instrument.pan + track.pan)),
          transpose: instrument.transpose + (conn.transpose ?? 0),
        },
      ]
    })
    await this.rack.synchronize({ ...project, instruments })
    this.slots.clear()
    this.identities.clear()
    for (const conn of available) {
      const slot = this.rack.get(`seq:${patchKey(conn)}`)
      if (slot) {
        this.slots.set(patchKey(conn), slot)
        this.identities.set(slot, conn.instrumentId)
      }
    }
    this.route(project.base.patch, tick)
  }
  route(patches: readonly PatchConn[], tick = 0): void {
    this.tracks.clear()
    for (const patch of patches) {
      const slot = this.slots.get(patchKey(patch))
      if (!slot) continue
      const slots = this.tracks.get(patch.trackId) ?? []
      slots.push({ slot, patch })
      this.tracks.set(patch.trackId, slots)
    }
    this.reconcile(tick)
  }
  reconcile(tick: number): void {
    const reachable = new Set(
      [...this.tracks.keys()].flatMap((id) => this.destinations(id, tick)),
    )
    // A routing change releases the pedal, while key-down voices retain their slots.
    for (const slot of this.reachable)
      if (!reachable.has(slot)) slot.backend.cc(slot.slot, 64, 0)
    this.reachable = reachable
  }
  private destinations(trackId: string, tick: number): RackSlot[] {
    const context = this.condition(tick)
    return [
      ...new Set(
        (this.tracks.get(trackId) ?? [])
          .filter(({ patch }) => matchesCondition(patch.when, context))
          .map(({ slot }) => slot),
      ),
    ]
  }
  private allSlots(): Set<RackSlot> {
    return new Set([
      ...this.slots.values(),
      ...[...this.voices.values()].flatMap((v) => v.map((voice) => voice.slot)),
    ])
  }
  noteOn(note: ScheduledNote, when: number): void {
    this.noteActivity.set(note.id, { trackId: note.track.id, on: when })
    this.activityPulse({ sourceId: 'sequencer', trackId: note.track.id }, when)
    const voices: Voice[] = []
    for (const slot of this.destinations(note.track.id, note.start)) {
      const key = note.note[2] + slot.instrument.transpose
      if (key < 0 || key > 127) continue
      const offset = this.timing(slot.backend),
        at = Math.max(this.now(), when + offset)
      slot.backend.noteOn(slot.slot, key, note.note[3], at)
      this.rack.retain(slot)
      const instrumentId = this.identities.get(slot)!
      voices.push({
        slot,
        key,
        on: at,
        offset,
        trackId: note.track.id,
        instrumentId,
      })
      this.activityPulse(
        { sourceId: 'sequencer', trackId: note.track.id, instrumentId },
        at,
      )
    }
    this.voices.set(note.id, voices)
  }
  noteOff(note: ScheduledNote, when: number): void {
    const activity = this.noteActivity.get(note.id)
    if (activity) activity.off = when
    for (const voice of this.voices.get(note.id) ?? []) {
      const at = Math.max(this.now(), when + voice.offset)
      voice.off = at
      const overlapping = [...this.voices.values()].some((voices) =>
        voices.some(
          (other) =>
            other !== voice &&
            other.slot === voice.slot &&
            other.key === voice.key &&
            other.on <= at &&
            (other.off === undefined || other.off > at),
        ),
      )
      if (!overlapping)
        voice.slot.backend.noteOff(voice.slot.slot, voice.key, at)
    }
  }
  event(
    track: MidiTrack,
    event: MidiTrack['events'][number],
    when: number,
  ): void {
    const slots = new Set(this.destinations(track.id, event.tick))
    for (const voices of this.voices.values())
      for (const voice of voices)
        if (
          voice.trackId === track.id &&
          (event.type !== 'cc' || event.num !== 64 || event.value < 64)
        )
          slots.add(voice.slot)
    for (const slot of slots) {
      const at = Math.max(this.now(), when + this.timing(slot.backend))
      if (event.type === 'bend')
        slot.backend.pitchBend(slot.slot, event.value, at)
      else {
        let value = event.value
        if (event.num === 7) value = Math.round(value * slot.instrument.volume)
        if (event.num === 10)
          value = Math.round(
            Math.max(0, Math.min(127, value + slot.instrument.pan * 63.5)),
          )
        slot.backend.cc(slot.slot, event.num, value, at)
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
    for (const note of this.noteActivity.values())
      if (note.off === undefined || note.off > when) note.off = when
    for (const slot of this.allSlots()) {
      const at = Math.max(this.now(), when + this.timing(slot.backend))
      slot.backend.cc(slot.slot, 64, 0, at)
      slot.backend.cc(slot.slot, 123, 0, at)
    }
    for (const voices of this.voices.values())
      for (const voice of voices)
        if (voice.off === undefined || voice.off > when + voice.offset)
          voice.off = Math.max(this.now(), when + voice.offset)
  }
  reset(keepHeld: boolean): void {
    this.onReset(keepHeld)
    const now = this.now()
    this.collect(now)
    for (const slot of this.allSlots()) {
      slot.backend.clearScheduled(slot.slot)
      if (!keepHeld) {
        slot.backend.cc(slot.slot, 64, 0)
        slot.backend.cc(slot.slot, 120, 0)
      }
    }
    for (const [id, note] of this.noteActivity) {
      if (!keepHeld || note.on > now) this.noteActivity.delete(id)
      else note.off = undefined
    }
    for (const [id, voices] of this.voices) {
      const retained = keepHeld ? voices.filter((v) => v.on <= now) : []
      for (const voice of voices)
        if (!retained.includes(voice)) this.rack.release(voice.slot)
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
    for (const [id, note] of this.noteActivity)
      if (note.off !== undefined && note.off <= now)
        this.noteActivity.delete(id)
    for (const [id, voices] of this.voices)
      if (voices.every((v) => v.off !== undefined && v.off <= now)) {
        for (const voice of voices) this.rack.release(voice.slot)
        this.voices.delete(id)
      }
  }
  activity(now: number): ActivityRoute[] {
    return [
      ...[...this.noteActivity.values()]
        .filter((v) => v.on <= now && (v.off === undefined || v.off > now))
        .map((v) => ({ sourceId: 'sequencer', trackId: v.trackId })),
      ...[...this.voices.values()]
        .flat()
        .filter((v) => v.on <= now && (v.off === undefined || v.off > now))
        .map((v) => ({
          sourceId: 'sequencer',
          trackId: v.trackId,
          instrumentId: v.instrumentId,
        })),
    ]
  }
  close(): void {
    this.reset(false)
    this.rack.close()
  }
}
