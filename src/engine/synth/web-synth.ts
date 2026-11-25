import { EffectChain } from '../audio/effects/chain'
import processorUrl from './processor.worklet.ts?worker&url'
import { WorkletSynthesizer } from 'spessasynth_lib'
import type { MIDIController } from 'spessasynth_core'
import type { Instrument, SoundFontRef } from '../../shared/model'
import type { Preset, SlotId, SynthBackend } from './backend'

class ScheduledSynthesizer extends WorkletSynthesizer {
  clearScheduled(channel: number): void {
    this.worklet.port.postMessage({ type: 'xmxs:cancelScheduled', channel })
  }
}
interface Pool {
  chain?: EffectChain
  owner?: string
  retired?: boolean
  synth: ScheduledSynthesizer
  used: Set<number>
  file: string
  id: string
}
interface Slot {
  config?: Instrument
  pool: Pool
  channel: number
  releasing?: boolean
  timer?: ReturnType<typeof setTimeout>
}
export class WebSynthBackend implements SynthBackend {
  readonly id = 'web'
  private banks = new Map<
    string,
    { file: string; url: string; loaded: Promise<Pool> }
  >()
  private slots = new Map<SlotId, Slot>()
  private inserts = new Map<string, Pool>()
  private bpm = 120
  private serial = 0
  private operation = Promise.resolve<unknown>(undefined)
  private constructor(
    private context: AudioContext,
    private output: AudioNode,
  ) {}
  static async create(
    context: AudioContext,
    output: AudioNode,
  ): Promise<WebSynthBackend> {
    await context.audioWorklet.addModule(processorUrl)
    return new WebSynthBackend(context, output)
  }
  async loadSoundFont(sf: SoundFontRef, url: string): Promise<void> {
    const old = this.banks.get(sf.id)
    if (old?.file === sf.file) {
      old.url = url
      await old.loaded
      return
    }
    const loaded = this.createPool(sf, url, this.output)
    this.banks.set(sf.id, { file: sf.file, url, loaded })
    try {
      await loaded
      if (old)
        void old.loaded
          .then((pool) => {
            pool.retired = true
            this.collect(pool)
          })
          .catch(() => undefined)
    } catch (error) {
      if (this.banks.get(sf.id)?.loaded === loaded) this.banks.delete(sf.id)
      throw error
    }
  }
  private async createPool(
    sf: SoundFontRef,
    url: string,
    output: AudioNode,
  ): Promise<Pool> {
    const response = await fetch(url)
    if (!response.ok)
      throw new Error(`${sf.file}: loading failed (${response.status})`)
    const data = await response.arrayBuffer()
    const synth = new ScheduledSynthesizer(this.context)
    try {
      await synth.isReady
      synth.setLogLevel(false, true, false)
      await synth.soundBankManager.addSoundBank(data, sf.id)
      synth.connect(output)
    } catch (error) {
      synth.destroy()
      throw error
    }
    return { synth, used: new Set(), file: sf.file, id: sf.id }
  }
  private async instrumentPool(
    instrument: Instrument,
    ownerId: string,
    shared: Pool,
    url: string,
  ): Promise<Pool> {
    if (!instrument.effects?.length) return shared
    const owner = JSON.stringify([ownerId, shared.id, shared.file])
    const existing = this.inserts.get(owner)
    if (existing) return existing
    const input = this.context.createGain()
    const chain = new EffectChain(this.context, input, this.output)
    try {
      chain.tempo(this.bpm)
      chain.set(instrument.effects)
      const pool = await this.createPool(shared, url, input)
      pool.owner = owner
      pool.chain = chain
      this.inserts.set(owner, pool)
      return pool
    } catch (error) {
      chain.close()
      throw error
    }
  }
  tempo(bpm: number): void {
    this.bpm = bpm
    for (const pool of this.inserts.values()) pool.chain?.tempo(bpm)
  }
  cancelTriggers(): void {
    for (const pool of this.inserts.values()) pool.chain?.cancelTriggers()
  }
  trigger(track: string, when: number): void {
    for (const pool of this.inserts.values()) pool.chain?.trigger(track, when)
  }
  async listPresets(id: string): Promise<Preset[]> {
    const bank = this.banks.get(id)
    if (!bank) throw new Error(`Soundfont not loaded: ${id}`)
    const { synth } = await bank.loaded
    return synth.presetList
      .map((p) => ({
        bank: p.bankMSB | (p.bankLSB << 8) | (p.isGMGSDrum ? 128 : 0),
        program: p.program,
        name: p.name,
        isDrum: p.isDrum,
      }))
      .sort(
        (a, b) =>
          Number(a.isDrum) - Number(b.isDrum) ||
          a.bank - b.bank ||
          a.program - b.program,
      )
  }
  allocate(instrument: Instrument, ownerId = instrument.id): Promise<SlotId> {
    const work = this.operation.then(async () => {
      const bank = this.banks.get(instrument.soundfontId ?? '')
      if (!bank) throw new Error(`No soundfont for ${instrument.name}`)
      const pool = await this.instrumentPool(
        instrument,
        ownerId,
        await bank.loaded,
        bank.url,
      )
      const available = instrument.isDrum
        ? [9]
        : Array.from({ length: 16 }, (_, i) => i).filter((i) => i !== 9)
      let channel = available.find((i) => !pool.used.has(i))
      if (channel === undefined)
        channel = Array.from(
          { length: pool.synth.midiChannels.length - 16 },
          (_, i) => i + 16,
        ).find((i) => !pool.used.has(i))
      if (channel === undefined) {
        channel = pool.synth.midiChannels.length
        await new Promise<void>((resolve, reject) => {
          const id = `allocate-${++this.serial}`
          const timer = setTimeout(() => {
            pool.synth.eventHandler.removeEvent('channelAdded', id)
            reject(new Error('Synth channel expansion timed out'))
          }, 3000)
          pool.synth.eventHandler.addEvent('channelAdded', id, () => {
            clearTimeout(timer)
            pool.synth.eventHandler.removeEvent('channelAdded', id)
            resolve()
          })
          pool.synth.addNewChannel()
        })
      }
      pool.used.add(channel)
      const slot = `web-${++this.serial}`
      this.slots.set(slot, { pool, channel })
      this.configure(slot, instrument)
      return slot
    })
    this.operation = work.catch(() => undefined)
    return work
  }
  private collect(pool: Pool): void {
    if (!pool.used.size && (pool.retired || pool.owner)) {
      if (pool.owner) this.inserts.delete(pool.owner)
      pool.chain?.close()
      pool.synth.destroy()
    }
  }
  release(slotId: SlotId): void {
    const slot = this.slots.get(slotId)
    if (!slot || slot.releasing) return
    slot.releasing = true
    slot.pool.synth.controllerChange(slot.channel, 64, 0)
    slot.pool.synth.controllerChange(slot.channel, 123, 0)
    const deadline = performance.now() + 30000
    const drain = (): void => {
      if (!this.slots.has(slotId)) return
      if (
        slot.pool.synth.midiChannels[slot.channel].voiceCount > 0 &&
        performance.now() < deadline
      ) {
        slot.timer = setTimeout(drain, 80)
        return
      }
      if (slot.pool.synth.midiChannels[slot.channel].voiceCount > 0)
        slot.pool.synth.controllerChange(slot.channel, 120, 0)
      slot.pool.used.delete(slot.channel)
      this.slots.delete(slotId)
      this.collect(slot.pool)
    }
    slot.timer = setTimeout(drain, 80)
  }
  configure(id: SlotId, instrument: Instrument): void {
    const slot = this.get(id),
      { pool, channel } = slot,
      old = slot.config
    if (
      !old ||
      old.isDrum !== instrument.isDrum ||
      old.bank !== instrument.bank ||
      old.program !== instrument.program
    ) {
      pool.synth.midiChannels[channel].setDrums(instrument.isDrum)
      pool.synth.controllerChange(channel, 0, instrument.bank & 127)
      pool.synth.controllerChange(channel, 32, (instrument.bank >> 8) & 127)
      pool.synth.programChange(channel, instrument.program)
    }
    if (!old || old.volume !== instrument.volume)
      pool.synth.controllerChange(
        channel,
        7,
        Math.round(instrument.volume * 127),
      )
    if (!old || old.pan !== instrument.pan)
      pool.synth.controllerChange(
        channel,
        10,
        Math.round((instrument.pan + 1) * 63.5),
      )
    if (!old || old.reverb !== instrument.reverb)
      pool.synth.controllerChange(
        channel,
        91,
        Math.round(instrument.reverb * 127),
      )
    if (!old || old.chorus !== instrument.chorus)
      pool.synth.controllerChange(
        channel,
        93,
        Math.round(instrument.chorus * 127),
      )
    for (const [cc, value] of Object.entries(instrument.initCc ?? {}))
      if (old?.initCc?.[cc] !== value)
        this.cc(id, Number(cc), value)
    pool.chain?.set(instrument.effects)
    slot.config = { ...instrument }
  }
  private get(id: SlotId): Slot {
    const slot = this.slots.get(id)
    if (!slot) throw new Error(`Unknown synth slot: ${id}`)
    return slot
  }
  noteOn(id: SlotId, key: number, vel: number, time?: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.noteOn(
      channel,
      key,
      vel,
      time === undefined ? undefined : { time },
    )
  }
  noteOff(id: SlotId, key: number, time?: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.noteOff(channel, key, time === undefined ? undefined : { time })
  }
  cc(id: SlotId, cc: number, value: number, time?: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.controllerChange(
      channel,
      cc as MIDIController,
      value,
      time === undefined ? undefined : { time },
    )
  }
  pitchBend(id: SlotId, value: number, time?: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.pitchWheel(
      channel,
      value,
      time === undefined ? undefined : { time },
    )
  }
  channelPressure(id: SlotId, value: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.channelPressure(channel, value)
  }
  polyPressure(id: SlotId, key: number, value: number): void {
    const { pool, channel } = this.get(id)
    pool.synth.polyPressure(channel, key, value)
  }
  clearScheduled(id: SlotId): void {
    const { pool, channel } = this.get(id)
    pool.synth.clearScheduled(channel)
  }
  allNotesOff(): void {
    for (const { pool, channel } of this.slots.values()) {
      pool.synth.clearScheduled(channel)
      pool.synth.controllerChange(channel, 64, 0)
      pool.synth.controllerChange(channel, 120, 0)
    }
  }
  latencySec(): number {
    return this.context.baseLatency + (this.context.outputLatency || 0)
  }
  prune(ids: Set<string>): void {
    for (const [id, bank] of this.banks)
      if (!ids.has(id)) {
        this.banks.delete(id)
        void bank.loaded
          .then((pool) => {
            pool.retired = true
            this.collect(pool)
          })
          .catch(() => undefined)
      }
  }
  destroy(): void {
    this.slots.forEach((slot) => clearTimeout(slot.timer))
    const pools = new Set([...this.slots.values()].map((s) => s.pool))
    for (const bank of this.banks.values())
      void bank.loaded
        .then((pool) => {
          if (!pools.has(pool)) pool.synth.destroy()
        })
        .catch(() => undefined)
    for (const pool of this.inserts.values()) pools.add(pool)
    pools.forEach((pool) => {
      pool.chain?.close()
      pool.synth.destroy()
    })
    this.inserts.clear()
    this.banks.clear()
    this.slots.clear()
  }
}
