import type { Instrument } from '../../shared/model'
import type { Preset, SlotId, SynthBackend } from './backend'
import { ScheduledQueue } from './scheduled-queue'

interface Slot {
  instrument: Instrument
  endpoint: Endpoint
  notes: Set<number>
  sustain: number
}
interface Endpoint {
  output: MIDIOutput
  channel: number
  patch?: string
  sustained: Set<number>
}
interface Packet {
  slot: SlotId
  bytes: number[]
  time: number
}

export class MidiOutSynthBackend implements SynthBackend {
  readonly id = 'midi'
  private slots = new Map<SlotId, Slot>()
  private endpoints = new Map<string, Endpoint>()
  private queue = new ScheduledQueue<Packet>()
  private serial = 0
  private timer?: ReturnType<typeof setInterval>
  private warnings = new Set<string>()
  private closed = false
  constructor(
    private outputs: () => readonly MIDIOutput[],
    private now: () => number,
    private warn: (message: string) => void,
    private perfNow: () => number = () => performance.now(),
  ) {}
  async loadSoundFont(): Promise<void> {}
  async listPresets(): Promise<Preset[]> {
    return []
  }
  private resolve(name: string): MIDIOutput | undefined {
    const matches = this.outputs().filter(
      (p) => p.state === 'connected' && p.name === name,
    )
    return matches.length === 1 ? matches[0] : undefined
  }
  available(instrument: Instrument): boolean {
    return !!instrument.midiOut && !!this.resolve(instrument.midiOut.portName)
  }
  async allocate(instrument: Instrument): Promise<SlotId> {
    if (this.closed) throw Error('External MIDI backend is closed')
    if (
      !Number.isInteger(instrument.bank) ||
      instrument.bank < 0 ||
      instrument.bank > 16383 ||
      !Number.isInteger(instrument.program) ||
      instrument.program < 0 ||
      instrument.program > 127
    )
      throw Error(`${instrument.name}: invalid MIDI bank or program`)
    const destination = instrument.midiOut
    if (
      !destination?.portName ||
      !Number.isInteger(destination.channel) ||
      destination.channel < 0 ||
      destination.channel > 15
    )
      throw Error(
        `${instrument.name}: select an external MIDI port and channel`,
      )
    const output = this.resolve(destination.portName)
    if (!output)
      throw Error(
        `${destination.portName}: MIDI output missing or name is ambiguous`,
      )
    await output.open()
    if (this.closed || this.resolve(destination.portName) !== output)
      throw Error(`${destination.portName}: MIDI output disconnected`)
    const key = JSON.stringify([output.id, destination.channel])
    let endpoint = this.endpoints.get(key)
    if (!endpoint || endpoint.output !== output) {
      endpoint = { output, channel: destination.channel, sustained: new Set() }
      this.endpoints.set(key, endpoint)
    }
    const id = String(++this.serial)
    this.slots.set(id, {
      instrument: structuredClone(instrument),
      endpoint,
      notes: new Set(),
      sustain: 0,
    })
    this.timer ??= setInterval(() => this.flush(), 1)
    this.configure(id, instrument)
    return id
  }
  configure(id: SlotId, instrument: Instrument): void {
    const slot = this.get(id)
    if (!this.connected(slot.endpoint)) {
      const output = this.resolve(instrument.midiOut?.portName ?? '')
      if (!output)
        throw Error(
          `${instrument.name}: MIDI output missing or name is ambiguous`,
        )
      const key = JSON.stringify([output.id, instrument.midiOut!.channel])
      let endpoint = this.endpoints.get(key)
      if (!endpoint || endpoint.output !== output) {
        endpoint = {
          output,
          channel: instrument.midiOut!.channel,
          sustained: new Set(),
        }
        this.endpoints.set(key, endpoint)
      }
      slot.endpoint = endpoint
    }
    slot.instrument = structuredClone(instrument)
    if (
      !this.busy(slot.endpoint) ||
      slot.endpoint.patch === this.patch(instrument)
    )
      this.configuration(slot)
  }
  private patch(instrument: Instrument): string {
    return `${instrument.bank}:${instrument.program}`
  }
  private members(endpoint: Endpoint): Slot[] {
    return [...this.slots.values()].filter((slot) => slot.endpoint === endpoint)
  }
  private busy(endpoint: Endpoint): boolean {
    return (
      !!endpoint.sustained.size ||
      this.members(endpoint).some((slot) => slot.notes.size > 0)
    )
  }
  private configuration(slot: Slot): void {
    const { endpoint, instrument } = slot
    if (endpoint.patch !== this.patch(instrument)) {
      this.send(endpoint, [0xb0, 0, instrument.bank >> 7])
      this.send(endpoint, [0xb0, 32, instrument.bank & 127])
      this.send(endpoint, [0xc0, instrument.program])
      endpoint.patch = this.patch(instrument)
    }
    for (const [cc, value] of [
      [7, instrument.volume],
      [10, (instrument.pan + 1) / 2],
      [91, instrument.reverb],
      [93, instrument.chorus],
    ])
      this.send(endpoint, [0xb0, cc, Math.round(value * 127)])
    for (const [cc, value] of Object.entries(instrument.initCc ?? {}))
      this.send(endpoint, [0xb0, Number(cc), value])
  }
  private get(id: SlotId): Slot {
    const slot = this.slots.get(id)
    if (!slot) throw Error(`Unknown external MIDI slot: ${id}`)
    return slot
  }
  private connected(endpoint: Endpoint): boolean {
    return (
      endpoint.output.state === 'connected' &&
      this.resolve(endpoint.output.name ?? '') === endpoint.output
    )
  }
  private send(endpoint: Endpoint, bytes: number[], time = this.now()): void {
    if (!this.connected(endpoint)) return
    try {
      endpoint.output.send(
        [bytes[0] | endpoint.channel, ...bytes.slice(1)],
        this.perfNow() + (time - this.now()) * 1000,
      )
    } catch (error) {
      this.warning(`${endpoint.output.name}: ${String(error)}`)
    }
  }
  private warning(message: string): void {
    if (this.warnings.has(message)) return
    this.warnings.add(message)
    this.warn(message)
  }
  private event(id: SlotId, bytes: number[], when?: number): void {
    this.get(id)
    const time = when ?? this.now()
    if (
      !Number.isFinite(time) ||
      bytes.slice(1).some((n) => !Number.isInteger(n) || n < 0 || n > 127)
    )
      throw Error('Invalid external MIDI event')
    const packet = { slot: id, bytes, time }
    if (time <= this.now()) this.dispatch(packet)
    else this.queue.push(time, Number(id), packet)
  }
  private dispatch(packet: Packet): void {
    const slot = this.slots.get(packet.slot)
    if (!slot || !this.connected(slot.endpoint)) return
    const { endpoint } = slot,
      [status, a, b] = packet.bytes
    if (status === 0x90 && b > 0) {
      if (endpoint.patch !== this.patch(slot.instrument)) {
        if (this.busy(endpoint)) {
          this.warning(
            `${endpoint.output.name} channel ${endpoint.channel + 1}: note skipped while another program has held notes or sustain; use separate channels for overlapping instruments`,
          )
          return
        }
        this.configuration(slot)
      }
      const sounding = this.members(endpoint).some((member) =>
        member.notes.has(a),
      )
      slot.notes.add(a)
      endpoint.sustained.delete(a)
      if (sounding) return
    } else if (status === 0x80 || (status === 0x90 && b === 0)) {
      if (!slot.notes.delete(a)) return
      if (this.members(endpoint).some((member) => member.notes.has(a))) return
      if (this.members(endpoint).some((member) => member.sustain >= 64))
        endpoint.sustained.add(a)
    } else if (status === 0xb0 && a === 64) {
      slot.sustain = b
      const pedal = Math.max(
        0,
        ...this.members(endpoint).map((member) => member.sustain),
      )
      if (pedal < 64) endpoint.sustained.clear()
      this.send(endpoint, [status, a, pedal], packet.time)
      return
    } else if (status === 0xb0 && (a === 120 || a === 123)) {
      this.stopSlot(slot)
      return
    }
    this.send(endpoint, packet.bytes, packet.time)
  }
  noteOn(id: SlotId, key: number, velocity: number, when?: number): void {
    this.event(id, [0x90, key, velocity], when)
  }
  noteOff(id: SlotId, key: number, when?: number): void {
    this.event(id, [0x80, key, 0], when)
  }
  cc(id: SlotId, cc: number, value: number, when?: number): void {
    this.event(id, [0xb0, cc, value], when)
  }
  pitchBend(id: SlotId, value: number, when?: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 16383)
      throw Error('Invalid MIDI pitch bend')
    this.event(id, [0xe0, value & 127, value >> 7], when)
  }
  channelPressure(id: SlotId, value: number): void {
    this.event(id, [0xd0, value])
  }
  polyPressure(id: SlotId, key: number, value: number): void {
    this.event(id, [0xa0, key, value])
  }
  clearScheduled(id: SlotId): void {
    this.queue.cancel(Number(id))
  }
  flush(): void {
    this.queue.drain(this.now(), (packet) => this.dispatch(packet))
  }
  private stopSlot(slot: Slot): void {
    const id = [...this.slots].find(([, value]) => value === slot)![0]
    for (const key of [...slot.notes])
      this.dispatch({ slot: id, bytes: [0x80, key, 0], time: this.now() })
    this.dispatch({ slot: id, bytes: [0xb0, 64, 0], time: this.now() })
    if (!this.busy(slot.endpoint)) this.send(slot.endpoint, [0xb0, 120, 0])
  }
  release(id: SlotId): void {
    const slot = this.slots.get(id)
    if (!slot) return
    this.clearScheduled(id)
    this.stopSlot(slot)
    this.slots.delete(id)
    if (!this.members(slot.endpoint).length)
      for (const [key, endpoint] of this.endpoints)
        if (endpoint === slot.endpoint) this.endpoints.delete(key)
  }
  refresh(): void {
    for (const [id, slot] of this.slots)
      if (!this.connected(slot.endpoint)) {
        this.clearScheduled(id)
        slot.notes.clear()
        slot.sustain = 0
        slot.endpoint.sustained.clear()
        slot.endpoint.patch = undefined
      }
    this.warnings.clear()
  }
  allNotesOff(): void {
    this.queue.cancel()
    for (const endpoint of this.endpoints.values()) {
      this.send(endpoint, [0xb0, 64, 0])
      this.send(endpoint, [0xb0, 120, 0])
      endpoint.sustained.clear()
    }
    for (const slot of this.slots.values()) {
      slot.notes.clear()
      slot.sustain = 0
    }
  }
  latencySec(): number {
    return 0
  }
  destroy(): void {
    this.allNotesOff()
    this.closed = true
    clearInterval(this.timer)
    this.slots.clear()
    this.endpoints.clear()
  }
}
