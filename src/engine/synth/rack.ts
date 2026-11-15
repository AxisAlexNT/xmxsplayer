import { allPatches } from '../../shared/patches'
import type { Instrument, Project, SoundFontRef } from '../../shared/model'
import type { SlotId, SynthBackend } from './backend'

export interface RackSlot {
  backend: SynthBackend
  slot: SlotId
  instrument: Instrument
  fontFile: string
  refs: number
  retired: boolean
}
export class InstrumentRack {
  private active = new Map<string, RackSlot>()
  private retired = new Set<RackSlot>()
  private serial = Promise.resolve()
  private revision = 0
  private aliases = new Map<string, string>()
  constructor(
    private backend: SynthBackend,
    private load: (font: SoundFontRef) => Promise<void>,
    private warn: (message: string) => void,
    private perTrack = false,
  ) {}
  synchronize(project: Project): Promise<void> {
    if (this.perTrack) {
      const aliases = new Map<string, string>()
      const instruments = project.instruments.flatMap((instrument) => {
        const trackIds = [
          ...new Set(
            allPatches(project)
              .filter((p) => p.instrumentId === instrument.id)
              .map((p) => p.trackId),
          ),
        ]
        if (!trackIds.length) return [instrument]
        return trackIds.flatMap((trackId, index) => {
          const track = project.tracks.find((t) => t.id === trackId)
          if (!track) return []
          const id =
            index === 0
              ? instrument.id
              : JSON.stringify([instrument.id, trackId])
          aliases.set(JSON.stringify([instrument.id, trackId]), id)
          return [
            {
              ...instrument,
              id,
              volume: instrument.volume * track.volume,
              pan: Math.max(-1, Math.min(1, instrument.pan + track.pan)),
            },
          ]
        })
      })
      this.aliases = aliases
      project = { ...project, instruments }
    }
    const revision = ++this.revision
    const work = this.serial.then(async () => {
      if (revision !== this.revision) return
      const wanted = new Set(project.instruments.map((i) => i.id))
      for (const [id, old] of this.active)
        if (!wanted.has(id)) {
          this.active.delete(id)
          this.retire(old)
        }
      for (const instrument of project.instruments) {
        if (revision !== this.revision) return
        const old = this.active.get(instrument.id)
        if (instrument.backend !== 'web' && instrument.backend !== 'default') {
          if (old) {
            this.active.delete(instrument.id)
            this.retire(old)
          }
          this.warn(
            `${instrument.name}: ${instrument.backend} backend is not available yet`,
          )
          continue
        }
        const font = project.soundfonts.find(
          (sf) => sf.id === instrument.soundfontId,
        )
        if (!font) {
          if (old) {
            this.active.delete(instrument.id)
            this.retire(old)
          }
          this.warn(`${instrument.name}: no soundfont selected`)
          continue
        }
        const samePatch =
          old &&
          old.fontFile === font.file &&
          old.instrument.soundfontId === instrument.soundfontId &&
          old.instrument.bank === instrument.bank &&
          old.instrument.program === instrument.program &&
          old.instrument.isDrum === instrument.isDrum
        try {
          await this.load(font)
          if (revision !== this.revision) return
          if (samePatch) {
            this.backend.configure(old.slot, instrument)
            old.instrument = instrument
            continue
          }
          const slot = await this.backend.allocate(instrument)
          if (revision !== this.revision) {
            this.backend.release(slot)
            return
          }
          if (old) this.retire(old)
          this.active.set(instrument.id, {
            backend: this.backend,
            slot,
            instrument,
            fontFile: font.file,
            refs: 0,
            retired: false,
          })
        } catch (error) {
          this.warn(String(error))
          if (old) {
            this.active.delete(instrument.id)
            this.retire(old)
          }
        }
      }
    })
    this.serial = work.catch(() => undefined)
    return work
  }
  get(id: string, trackId?: string): RackSlot | undefined {
    return this.active.get(
      trackId === undefined
        ? id
        : (this.aliases.get(JSON.stringify([id, trackId])) ?? id),
    )
  }
  acquire(id: string, trackId?: string): RackSlot | undefined {
    const slot = this.get(id, trackId)
    if (slot) slot.refs++
    return slot
  }
  retain(slot: RackSlot): void {
    slot.refs++
  }
  release(slot: RackSlot): void {
    slot.refs = Math.max(0, slot.refs - 1)
    if (slot.retired && !slot.refs) {
      slot.backend.release(slot.slot)
      this.retired.delete(slot)
    }
  }
  private retire(slot: RackSlot): void {
    slot.retired = true
    if (!slot.refs) slot.backend.release(slot.slot)
    else this.retired.add(slot)
  }
  panic(): void {
    this.backend.allNotesOff()
  }
  close(): void {
    this.revision++
    this.active.forEach((slot) => this.backend.release(slot.slot))
    this.retired.forEach((slot) => this.backend.release(slot.slot))
    this.active.clear()
    this.retired.clear()
  }
}
