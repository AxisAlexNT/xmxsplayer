import type { Instrument } from '../../shared/model'
import type { PluginPlayback, PluginCommand } from '../../shared/plugins'
import type { SynthBackend } from './backend'

interface Slot {
  owner: string
  notes: Map<number, number>
  sustained: number[]
  volume: number
  expression: number
  pedal: boolean
  timers: Set<ReturnType<typeof setTimeout>>
}
export class PluginSynthBackend implements SynthBackend {
  readonly id = 'plugin'
  private slots = new Map<string, Slot>()
  private serial = 0
  constructor(
    private api: PluginPlayback,
    private now: () => number,
    private warn: (message: string) => void,
  ) {}
  async loadSoundFont() {}
  async listPresets() {
    return []
  }
  async allocate(instrument: Instrument, owner = instrument.id) {
    if (!instrument.plugin)
      throw Error('Choose a plugin for ' + instrument.name)
    const id = 'plugin-' + ++this.serial
    this.slots.set(id, {
      owner: 'instrument-' + owner,
      notes: new Map(),
      sustained: [],
      volume: instrument.volume,
      expression: 1,
      pedal: false,
      timers: new Set(),
    })
    this.configure(id, instrument)
    return id
  }
  private send(slot: Slot, cmd: PluginCommand, values: number[]) {
    void this.api
      .send(slot.owner, cmd, values)
      .catch((e) => this.warn(String(e)))
  }
  configure(id: string, instrument: Instrument) {
    const slot = this.slots.get(id)
    if (slot) {
      slot.volume = instrument.volume
      this.send(slot, 'set_volume', [slot.volume * slot.expression])
    }
  }
  private at(id: string, when: number | undefined, fn: (slot: Slot) => void) {
    const slot = this.slots.get(id)
    if (!slot) return
    const delay = ((when ?? this.now()) - this.now()) * 1000
    if (delay <= 0) fn(slot)
    else {
      const timer = setTimeout(() => {
        slot.timers.delete(timer)
        fn(slot)
      }, delay)
      slot.timers.add(timer)
    }
  }
  noteOn(id: string, key: number, vel: number, time?: number) {
    this.at(id, time, (slot) => {
      slot.notes.set(key, (slot.notes.get(key) ?? 0) + 1)
      this.send(slot, 'note_on', [0, key, vel])
    })
  }
  noteOff(id: string, key: number, time?: number) {
    this.at(id, time, (slot) => {
      const held = slot.notes.get(key) ?? 0
      if (!held) return
      if (held === 1) slot.notes.delete(key)
      else slot.notes.set(key, held - 1)
      if (slot.pedal) slot.sustained.push(key)
      else this.send(slot, 'note_off', [0, key])
    })
  }
  cc(id: string, cc: number, value: number, time?: number) {
    this.at(id, time, (slot) => {
      if (cc === 64) {
        slot.pedal = value >= 64
        if (!slot.pedal)
          for (const key of slot.sustained.splice(0))
            this.send(slot, 'note_off', [0, key])
      } else if (cc === 11) {
        slot.expression = value / 127
        this.send(slot, 'set_volume', [slot.volume * slot.expression])
      } else if (cc === 120 || cc === 123) this.silence(slot)
    })
  }
  pitchBend() {}
  channelPressure() {}
  polyPressure() {}
  latencySec() {
    return 0
  }
  clearScheduled(id: string) {
    const slot = this.slots.get(id)
    if (slot) {
      for (const timer of slot.timers) clearTimeout(timer)
      slot.timers.clear()
    }
  }
  private silence(slot: Slot) {
    for (const [key, n] of slot.notes)
      for (let i = 0; i < n; i++) this.send(slot, 'note_off', [0, key])
    for (const key of slot.sustained.splice(0))
      this.send(slot, 'note_off', [0, key])
    slot.notes.clear()
    slot.pedal = false
  }
  release(id: string) {
    const slot = this.slots.get(id)
    if (slot) {
      this.clearScheduled(id)
      this.silence(slot)
      this.slots.delete(id)
    }
  }
  allNotesOff() {
    for (const [id, slot] of this.slots) {
      this.clearScheduled(id)
      this.silence(slot)
    }
  }
}
