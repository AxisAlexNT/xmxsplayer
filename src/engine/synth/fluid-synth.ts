import type { FluidApi } from '../../shared/api'
import type { FluidConfig, FluidEvent } from '../../shared/fluid'
import { fluidMidi, fluidSelect } from '../../shared/fluid'
import type { Instrument, SoundFontRef } from '../../shared/model'
import type { Preset, SlotId, SynthBackend } from './backend'
import { FluidChannels } from './fluid-channels'
import { ScheduledQueue } from './scheduled-queue'

interface Bank {
  ref: SoundFontRef
  url: string
  id?: number
  loaded: boolean
  loading?: Promise<void>
}
interface Slot {
  channel: number
  bank: Bank
  config: Instrument
  releasing?: ReturnType<typeof setTimeout>
}
export class FluidSynthBackend implements SynthBackend {
  readonly id = 'fluid'
  private channels = new FluidChannels()
  private banks = new Map<string, Bank>()
  private slots = new Map<SlotId, Slot>()
  private queue = new ScheduledQueue<string>()
  private serial = 0
  private generation = 0
  private starting?: Promise<void>
  private recovery = Promise.resolve()
  private restoreError?: Error
  private online = false
  private live = true
  private pressureWarned = false
  private unsubscribe: () => void
  private timer?: ReturnType<typeof setInterval>
  constructor(
    private api: FluidApi,
    private now: () => number,
    private config: FluidConfig,
    private warn: (message: string) => void,
    private resolveFont: (
      font: SoundFontRef,
    ) => Promise<string | null> = async () => null,
    private recovered: () => void = () => undefined,
    private unavailable: () => void = () => undefined,
  ) {
    this.unsubscribe = api.onEvent((event) => this.event(event))
  }
  private event(event: FluidEvent): void {
    if (!this.live) return
    if (event.type === 'log') {
      if (event.message) this.warn(event.message)
      return
    }
    if (event.type === 'exit') {
      this.online = false
      this.starting = undefined
      this.allNotesOff()
      this.unavailable()
      if (event.restarting)
        this.warn('FluidSynth exited; restarting with notes released')
      else if (event.code !== 0)
        this.warn('FluidSynth stopped; check its executable and audio settings')
      return
    }
    this.acceptGeneration(event.generation)
  }
  private acceptGeneration(generation: number): void {
    if (
      generation < this.generation ||
      (generation === this.generation && !this.restoreError)
    )
      return
    const previous = this.generation
    this.generation = generation
    this.online = false
    this.restoreError = undefined
    this.recovery = this.restore(generation)
      .then(() => {
        if (this.live && this.generation === generation) {
          this.online = true
          if (previous) this.recovered()
        }
      })
      .catch((error) => {
        if (this.generation === generation) {
          this.restoreError =
            error instanceof Error ? error : Error(String(error))
          this.unavailable()
        }
        throw error
      })
    void this.recovery.catch((error) => this.warn(String(error)))
  }
  private async restore(generation: number): Promise<void> {
    const banks = new Set([
      ...this.banks.values(),
      ...[...this.slots.values()].map((slot) => slot.bank),
    ])
    for (const bank of banks) {
      if (!bank.loaded) continue
      const url = (await this.resolveFont(bank.ref)) ?? bank.url
      if (!this.live || this.generation !== generation) return
      const id = await this.api.load(url)
      if (!this.live || this.generation !== generation) return
      bank.id = id
    }
    for (const slot of this.slots.values())
      if (!slot.releasing)
        await this.api.send(this.configuration(slot, slot.config))
  }
  private async ensure(): Promise<void> {
    if (!this.live) throw Error('FluidSynth backend is closed')
    this.timer ??= setInterval(() => this.flush(), 1)
    if (!this.starting)
      this.starting = this.api
        .start()
        .then(({ generation }) => this.acceptGeneration(generation))
        .catch((error) => {
          this.starting = undefined
          throw error
        })
    await this.starting
    if (this.restoreError) this.acceptGeneration(this.generation)
    await this.recovery
    if (!this.online) throw Error('FluidSynth is not ready')
  }
  async loadSoundFont(ref: SoundFontRef, url: string): Promise<void> {
    let bank = this.banks.get(ref.id)
    if (bank?.ref.file !== ref.file) {
      const previous = bank
      bank = { ref: { ...ref }, url, loaded: false }
      this.banks.set(ref.id, bank)
      if (previous) this.collect(previous)
    }
    if (!bank.loading) {
      const target = bank
      target.loading = (async () => {
        await this.ensure()
        if (!target.loaded) {
          target.id = await this.api.load(url)
          target.loaded = true
          this.collect(target)
        }
      })().catch((error) => {
        target.loading = undefined
        throw error
      })
    }
    await bank.loading
  }
  async listPresets(id: string): Promise<Preset[]> {
    await this.ensure()
    const bank = this.banks.get(id)
    if (!bank?.loaded || bank.id === undefined)
      throw Error(`Soundfont not loaded: ${id}`)
    return this.api.presets(bank.id)
  }
  async allocate(instrument: Instrument): Promise<SlotId> {
    await this.ensure()
    const bank = this.banks.get(instrument.soundfontId ?? '')
    await bank?.loading
    if (!bank?.loaded || bank.id === undefined)
      throw Error(`No soundfont for ${instrument.name}`)
    let channel: number
    try {
      channel = this.channels.allocate(instrument.isDrum)
    } catch (error) {
      const retired = [...this.slots].find(
        ([, slot]) =>
          slot.releasing && (slot.channel % 16 === 9) === instrument.isDrum,
      )
      if (!retired) throw error
      this.dispose(retired[0])
      channel = this.channels.allocate(instrument.isDrum)
    }
    const id = `fluid-${++this.serial}`
    const slot: Slot = { channel, bank, config: { ...instrument } }
    try {
      await this.api.send(this.configuration(slot, instrument))
      this.slots.set(id, slot)
      return id
    } catch (error) {
      this.channels.release(channel)
      throw error
    }
  }
  private configuration(slot: Slot, instrument: Instrument): string[] {
    if (slot.bank.id === undefined)
      throw Error('FluidSynth soundfont is not loaded')
    return [
      fluidSelect(
        slot.channel,
        slot.bank.id,
        instrument.bank,
        instrument.program,
      ),
      ...[
        [7, instrument.volume],
        [10, (instrument.pan + 1) / 2],
        [91, instrument.reverb],
        [93, instrument.chorus],
      ].map(([cc, value]) =>
        fluidMidi('cc', slot.channel, cc, Math.round(value * 127)),
      ),
    ]
  }
  configure(id: SlotId, instrument: Instrument): void {
    const slot = this.get(id)
    if (JSON.stringify(slot.config) === JSON.stringify(instrument)) return
    const commands = this.configuration(slot, instrument)
    slot.config = { ...instrument }
    if (this.online) this.send(commands)
  }
  release(id: SlotId): void {
    const slot = this.slots.get(id)
    if (!slot || slot.releasing) return
    this.queue.cancel(slot.channel)
    if (this.online)
      this.send([
        fluidMidi('cc', slot.channel, 64, 0),
        fluidMidi('cc', slot.channel, 123, 0),
      ])
    slot.releasing = setTimeout(() => this.dispose(id), 30000)
  }
  private dispose(id: SlotId): void {
    const slot = this.slots.get(id)
    if (!slot) return
    clearTimeout(slot.releasing)
    this.queue.cancel(slot.channel)
    if (this.online)
      this.send([
        fluidMidi('cc', slot.channel, 64, 0),
        fluidMidi('cc', slot.channel, 120, 0),
      ])
    this.channels.release(slot.channel)
    this.slots.delete(id)
    this.collect(slot.bank)
  }
  private collect(bank: Bank): void {
    if (
      [...this.banks.values()].includes(bank) ||
      [...this.slots.values()].some((slot) => slot.bank === bank)
    )
      return
    if (bank.loaded && bank.id !== undefined && this.online)
      void this.api.unload(bank.id).catch((error) => this.warn(String(error)))
    bank.loaded = false
    bank.id = undefined
  }
  private get(id: SlotId): Slot {
    const slot = this.slots.get(id)
    if (!slot) throw Error(`Unknown FluidSynth slot: ${id}`)
    return slot
  }
  private enqueue(
    id: SlotId,
    command: 'noteon' | 'noteoff' | 'cc' | 'pitch_bend',
    a: number,
    b?: number,
    when?: number,
  ): void {
    const slot = this.get(id)
    if (!this.online || slot.releasing) return
    const time = when ?? this.now()
    if (!Number.isFinite(time)) throw Error('Invalid FluidSynth event time')
    const line = fluidMidi(command, slot.channel, a, b)
    if (time <= this.now()) {
      this.flush()
      this.send([line])
    } else this.queue.push(time, slot.channel, line)
  }
  noteOn(id: SlotId, key: number, velocity: number, when?: number): void {
    this.enqueue(id, 'noteon', key, velocity, when)
  }
  noteOff(id: SlotId, key: number, when?: number): void {
    this.enqueue(id, 'noteoff', key, undefined, when)
  }
  cc(id: SlotId, cc: number, value: number, when?: number): void {
    this.enqueue(id, 'cc', cc, value, when)
  }
  pitchBend(id: SlotId, value: number, when?: number): void {
    this.enqueue(id, 'pitch_bend', value, undefined, when)
  }
  channelPressure(): void {
    this.unsupportedPressure()
  }
  polyPressure(): void {
    this.unsupportedPressure()
  }
  private unsupportedPressure(): void {
    if (this.pressureWarned) return
    this.pressureWarned = true
    this.warn(
      'FluidSynth stdin does not support aftertouch; choose Built-in for pressure-sensitive instruments',
    )
  }
  clearScheduled(id: SlotId): void {
    this.queue.cancel(this.get(id).channel)
  }
  flush(): void {
    if (!this.online) return
    const lines = this.queue.takeDue(this.now())
    for (let i = 0; i < lines.length; i += 256)
      this.send(lines.slice(i, i + 256))
  }
  private send(lines: string[]): void {
    void this.api.send(lines).catch((error) => this.warn(String(error)))
  }
  allNotesOff(): void {
    this.queue.cancel()
    if (this.online) {
      const lines = [...this.slots.values()].flatMap((slot) => [
        fluidMidi('cc', slot.channel, 64, 0),
        fluidMidi('cc', slot.channel, 120, 0),
      ])
      if (lines.length) this.send(lines)
    }
    for (const [id, slot] of this.slots) if (slot.releasing) this.dispose(id)
  }
  latencySec(): number {
    return (
      (this.config.periodSize * this.config.periods) / this.config.sampleRate
    )
  }
  get available(): boolean {
    return this.online
  }
  async reconfigure(config: FluidConfig): Promise<void> {
    if (JSON.stringify(config) === JSON.stringify(this.config)) return
    this.config = structuredClone(config)
    if (!this.starting) return
    this.allNotesOff()
    await this.api.stop()
    this.online = false
    this.starting = undefined
    await this.ensure()
  }
  prune(ids: Set<string>): void {
    for (const [id, bank] of this.banks)
      if (!ids.has(id)) {
        this.banks.delete(id)
        this.collect(bank)
      }
  }
  async destroy(): Promise<void> {
    if (!this.live) return
    this.allNotesOff()
    this.live = false
    clearInterval(this.timer)
    this.unsubscribe()
    for (const slot of this.slots.values()) clearTimeout(slot.releasing)
    this.slots.clear()
    this.banks.clear()
    this.channels.clear()
    if (this.starting) await this.api.stop()
  }
}
