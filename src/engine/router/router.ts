import type { Project, Zone } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'
import { InstrumentRack, type RackSlot } from '../synth/rack'

interface Target {
  slot: RackSlot
  key: number
  trackId: string
}
interface Voice {
  source: string
  channel: number
  key: number
  targets: Target[]
}
export class Router {
  private project?: Project
  private held = new Map<string, Voice[]>()
  private sustained = new Map<string, Voice[]>()
  private pedals = new Map<string, Set<RackSlot>>()
  private sounding = new Map<string, number>()
  private controllers = new Map<
    string,
    { cc: Map<number, number>; bend?: number; pressure?: number }
  >()
  constructor(
    private rack: InstrumentRack,
    private report: (keys: EventMap['keys']) => void,
  ) {}
  setProject(project: Project): void {
    this.project = project
  }
  private owner(source: string, channel: number): string {
    return JSON.stringify([source, channel])
  }
  private noteOwner(source: string, channel: number, key: number): string {
    return JSON.stringify([source, channel, key])
  }
  private targetKey(target: Target): string {
    return `${target.slot.backend.id}:${target.slot.slot}:${target.key}`
  }
  private velocity(value: number, curve: Zone['velocity']): number {
    const power =
      curve === 'soft'
        ? 0.7
        : curve === 'hard'
          ? 1.4
          : curve === 'linear'
            ? 1
            : curve
    return Math.max(1, Math.min(127, Math.round(127 * (value / 127) ** power)))
  }
  private startTarget(
    voice: Voice,
    owner: string,
    target: Target,
    velocity: number,
  ): void {
    const { slot, key: sentKey } = target
    const pedal = this.pedals.get(owner)
    if (pedal && !pedal.has(slot)) {
      pedal.add(slot)
      this.rack.retain(slot)
      slot.backend.cc(slot.slot, 64, 127)
    }
    const expression = this.controllers.get(owner)
    if (expression) {
      for (const [cc, value] of expression.cc)
        slot.backend.cc(slot.slot, cc, value)
      if (expression.bend !== undefined)
        slot.backend.pitchBend(slot.slot, expression.bend)
      if (expression.pressure !== undefined)
        slot.backend.channelPressure(slot.slot, expression.pressure)
    }
    slot.backend.noteOn(slot.slot, sentKey, velocity)
    this.sounding.set(
      this.targetKey(target),
      (this.sounding.get(this.targetKey(target)) ?? 0) + 1,
    )
    voice.targets.push(target)
  }
  note(
    source: string,
    channel: number,
    key: number,
    velocity: number,
    on: boolean,
    instrumentId?: string,
  ): void {
    const id = this.noteOwner(source, channel, key)
    const owner = this.owner(source, channel)
    if (on && velocity > 0) {
      const voice: Voice = { source, channel, key, targets: [] }
      if (instrumentId) {
        const slot = this.rack.acquire(instrumentId)
        const sentKey = key + (slot?.instrument.transpose ?? 0)
        if (slot && sentKey >= 0 && sentKey <= 127)
          this.startTarget(
            voice,
            owner,
            { slot, key: sentKey, trackId: '' },
            velocity,
          )
        else if (slot) this.rack.release(slot)
      }
      for (const zone of instrumentId ? [] : (this.project?.base.zones ?? [])) {
        if (key < zone.lo || key > zone.hi) continue
        for (const trackId of new Set(zone.trackIds)) {
          const track = this.project?.tracks.find((t) => t.id === trackId)
          if (track?.kind !== 'midi' || track.mode === 'mute') continue
          for (const patch of this.project!.base.patch.filter(
            (p) => p.trackId === trackId && !p.when,
          )) {
            const slot = this.rack.acquire(patch.instrumentId)
            if (!slot) continue
            const sentKey =
              key +
              zone.transpose +
              (patch.transpose ?? 0) +
              slot.instrument.transpose
            if (sentKey < 0 || sentKey > 127) {
              this.rack.release(slot)
              continue
            }
            this.startTarget(
              voice,
              owner,
              { slot, key: sentKey, trackId },
              this.velocity(velocity, zone.velocity),
            )
          }
        }
      }
      const voices = this.held.get(id) ?? []
      voices.push(voice)
      this.held.set(id, voices)
    } else {
      const voices = this.held.get(id)
      const voice = voices?.shift()
      if (!voice) return
      if (!voices!.length) this.held.delete(id)
      for (const target of voice.targets) {
        const count = (this.sounding.get(this.targetKey(target)) ?? 1) - 1
        if (count <= 0) {
          this.sounding.delete(this.targetKey(target))
          target.slot.backend.noteOff(target.slot.slot, target.key)
        } else this.sounding.set(this.targetKey(target), count)
      }
      if (this.pedals.has(owner)) {
        const sustained = this.sustained.get(owner) ?? []
        sustained.push(voice)
        this.sustained.set(owner, sustained)
      } else voice.targets.forEach((t) => this.rack.release(t.slot))
    }
    this.queueReport()
  }
  private reachable(source: string, channel: number): Set<RackSlot> {
    const slots = new Set<RackSlot>()
    const trackIds = new Set(
      this.project?.base.zones.flatMap((z) => z.trackIds) ?? [],
    )
    for (const patch of this.project?.base.patch ?? []) {
      const track = this.project?.tracks.find((t) => t.id === patch.trackId)
      if (
        !trackIds.has(patch.trackId) ||
        track?.kind !== 'midi' ||
        track.mode === 'mute' ||
        patch.when
      )
        continue
      const slot = this.rack.get(patch.instrumentId)
      if (slot) slots.add(slot)
    }
    for (const voices of this.held.values())
      for (const voice of voices)
        if (voice.source === source && voice.channel === channel)
          voice.targets.forEach((t) => slots.add(t.slot))
    for (const voice of this.sustained.get(this.owner(source, channel)) ?? [])
      voice.targets.forEach((t) => slots.add(t.slot))
    return slots
  }
  private expression(owner: string) {
    const value = this.controllers.get(owner) ?? {
      cc: new Map<number, number>(),
    }
    this.controllers.set(owner, value)
    return value
  }
  cc(source: string, channel: number, cc: number, value: number): void {
    const owner = this.owner(source, channel)
    if (cc === 64) {
      if (value >= 64) {
        const slots = this.pedals.get(owner) ?? new Set<RackSlot>()
        this.pedals.set(owner, slots)
        for (const slot of this.reachable(source, channel))
          if (!slots.has(slot)) {
            slots.add(slot)
            this.rack.retain(slot)
            slot.backend.cc(slot.slot, 64, value)
          }
      } else {
        const slots = this.pedals.get(owner) ?? new Set<RackSlot>()
        this.pedals.delete(owner)
        for (const slot of slots) {
          if (![...this.pedals.values()].some((other) => other.has(slot)))
            slot.backend.cc(slot.slot, 64, 0)
          this.rack.release(slot)
        }
        for (const voice of this.sustained.get(owner) ?? [])
          voice.targets.forEach((t) => this.rack.release(t.slot))
        this.sustained.delete(owner)
      }
    } else if (cc === 1 || cc === 11) {
      this.expression(owner).cc.set(cc, value)
      for (const slot of this.reachable(source, channel))
        slot.backend.cc(slot.slot, cc, value)
    } else if (cc === 120 || cc === 123) this.disconnect(source)
  }
  pitchBend(source: string, channel: number, value: number): void {
    this.expression(this.owner(source, channel)).bend = value
    for (const slot of this.reachable(source, channel))
      slot.backend.pitchBend(slot.slot, value)
  }
  pressure(source: string, channel: number, value: number): void {
    this.expression(this.owner(source, channel)).pressure = value
    for (const slot of this.reachable(source, channel))
      slot.backend.channelPressure(slot.slot, value)
  }
  polyPressure(
    source: string,
    channel: number,
    key: number,
    value: number,
  ): void {
    for (const voice of this.held.get(this.noteOwner(source, channel, key)) ??
      [])
      for (const target of voice.targets)
        target.slot.backend.polyPressure(target.slot.slot, target.key, value)
  }
  disconnect(source: string): void {
    for (const voices of [...this.held.values()])
      for (const voice of [...voices])
        if (voice.source === source)
          this.note(source, voice.channel, voice.key, 0, false)
    for (let channel = 0; channel < 16; channel++) {
      this.cc(source, channel, 64, 0)
      this.controllers.delete(this.owner(source, channel))
    }
    this.queueReport()
  }
  private queueReport(): void {
    this.report(this.keys())
  }
  keys(): EventMap['keys'] {
    const held = new Map<number, Set<string>>()
    for (const voices of this.held.values())
      for (const voice of voices) {
        const tracks = held.get(voice.key) ?? new Set<string>()
        voice.targets.forEach((t) => {
          if (t.trackId) tracks.add(t.trackId)
        })
        held.set(voice.key, tracks)
      }
    return {
      held: [...held].map(([key, trackIds]) => ({
        key,
        trackIds: [...trackIds],
      })),
    }
  }
  panic(): void {
    for (const source of new Set(
      [...this.held.values()].flatMap((voices) => voices.map((v) => v.source)),
    ))
      this.disconnect(source)
    for (const slots of this.pedals.values())
      slots.forEach((slot) => this.rack.release(slot))
    this.pedals.clear()
    for (const voices of this.sustained.values())
      voices.forEach((voice) =>
        voice.targets.forEach((t) => this.rack.release(t.slot)),
      )
    this.sustained.clear()
    this.sounding.clear()
    this.controllers.clear()
    this.rack.panic()
    this.queueReport()
  }
  close(): void {
    this.panic()
  }
}
