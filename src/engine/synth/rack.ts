import { allPatches } from '../../shared/patches'
import type { Instrument, Project, SoundFontRef } from '../../shared/model'
import type { SlotId, SynthBackend, SynthSelector } from './backend'

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
    private load: (font: SoundFontRef, backend?: SynthBackend) => Promise<void>,
    private warn: (message: string) => void,
    private perTrack = false,
    private choose: SynthSelector = (instrument) => {
      if (instrument.backend === 'web' || instrument.backend === 'default')
        return backend
      throw Error(
        `${instrument.name}: ${instrument.backend} backend is not available`,
      )
    },
  ) {}
  synchronize(
    project: Project,
    owners = new Map<string, string>(),
  ): Promise<void> {
    if (
      project.orchestras?.some(
        (orchestra) =>
          orchestra.effects?.length ||
          orchestra.sections.some((section) => section.effects?.length),
      )
    ) {
      project = {
        ...project,
        instruments: project.instruments.map((instrument) => {
          const inherited = project.orchestras!.flatMap((orchestra) => {
            const sections = orchestra.sections.filter((section) =>
              section.members.some(
                (member) =>
                  member.enabled &&
                  member.instrumentId ===
                    (owners.get(instrument.id) ?? instrument.id),
              ),
            )
            return sections.length
              ? [
                  ...sections.flatMap((section) => section.effects ?? []),
                  ...(orchestra.effects ?? []),
                ]
              : []
          })
          return inherited.length
            ? {
                ...instrument,
                effects: [...(instrument.effects ?? []), ...inherited],
              }
            : instrument
        }),
      }
    }
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
          owners.set(id, instrument.id)
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
        const font = project.soundfonts.find(
          (sf) => sf.id === instrument.soundfontId,
        )
        if (!font && instrument.backend !== 'midi' && instrument.backend !== 'plugin') {
          if (old) {
            this.active.delete(instrument.id)
            this.retire(old)
          }
          this.warn(`${instrument.name}: no soundfont selected`)
          continue
        }
        try {
          const target = this.choose(instrument)
          const samePatch =
            old &&
            old.backend === target &&
            (target.id !== 'web' ||
              !!old.instrument.effects?.length ===
                !!instrument.effects?.length) &&
            old.fontFile === (font?.file ?? '') &&
            old.instrument.soundfontId === instrument.soundfontId &&
            old.instrument.bank === instrument.bank &&
            old.instrument.program === instrument.program &&
            old.instrument.isDrum === instrument.isDrum &&
            JSON.stringify(old.instrument.midiOut) ===
              JSON.stringify(instrument.midiOut)
          if (font && target.id !== 'midi' && target.id !== 'plugin') await this.load(font, target)
          if (revision !== this.revision) return
          if (samePatch) {
            target.configure(old.slot, instrument)
            old.instrument = instrument
            continue
          }
          const slot = await target.allocate(
            instrument,
            owners.get(instrument.id) ?? instrument.id,
          )
          if (revision !== this.revision) {
            target.release(slot)
            return
          }
          if (old) this.retire(old)
          this.active.set(instrument.id, {
            backend: target,
            slot,
            instrument,
            fontFile: font?.file ?? '',
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
    for (const backend of new Set([
      this.backend,
      ...[...this.active.values(), ...this.retired].map((slot) => slot.backend),
    ]))
      backend.allNotesOff()
  }
  close(): void {
    this.revision++
    this.active.forEach((slot) => slot.backend.release(slot.slot))
    this.retired.forEach((slot) => slot.backend.release(slot.slot))
    this.active.clear()
    this.retired.clear()
  }
}
