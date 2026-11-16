import { afterEach, expect, it, vi } from 'vitest'
import { MidiOutSynthBackend } from '../../src/engine/synth/midi-out-synth'
import { liveProject } from '../../src/shared/template'
import { SequenceOutput } from '../../src/engine/transport/sequence-output'
import { InstrumentRack } from '../../src/engine/synth/rack'
import { FakeBackend } from '../engine/fake-backend'
import type { Instrument } from '../../src/shared/model'
const backends: MidiOutSynthBackend[] = []
afterEach(() => {
  for (const backend of backends.splice(0)) backend.destroy()
  vi.useRealTimers()
})
function rig() {
  vi.useFakeTimers()
  let time = 0
  const make = (id: string, name = 'Synth') =>
    ({
      id,
      name,
      state: 'connected',
      open: vi.fn(async () => undefined),
      send: vi.fn(),
    }) as unknown as MIDIOutput
  const output = make('out'),
    other = make('other', 'Other')
  const ports = [output, other],
    warn = vi.fn()
  const backend = new MidiOutSynthBackend(
    () => ports,
    () => time,
    warn,
    () => 10000 + time * 1000,
  )
  backends.push(backend)
  const instrument: Instrument = {
    ...liveProject('Test').instruments[0],
    backend: 'midi',
    soundfontId: undefined,
    midiOut: { portName: 'Synth', channel: 2 },
    bank: 257,
    program: 48,
  }
  return {
    backend,
    output,
    other,
    ports,
    instrument,
    warn,
    make,
    time: (value: number) => {
      time = value
      backend.flush()
    },
  }
}
it('selects an exact port and sends bank, program, controls, bend and pressure on its channel', async () => {
  const r = rig(),
    id = await r.backend.allocate(r.instrument)
  expect(r.output.open).toHaveBeenCalledOnce()
  expect(r.other.open).not.toHaveBeenCalled()
  expect(r.output.send).toHaveBeenCalledWith([0xb2, 0, 2], 10000)
  expect(r.output.send).toHaveBeenCalledWith([0xb2, 32, 1], 10000)
  expect(r.output.send).toHaveBeenCalledWith([0xc2, 48], 10000)
  vi.mocked(r.output.send).mockClear()
  r.backend.noteOn(id, 60, 100)
  r.backend.pitchBend(id, 16383)
  r.backend.channelPressure(id, 61)
  r.backend.polyPressure(id, 60, 62)
  r.backend.noteOff(id, 60)
  expect(vi.mocked(r.output.send).mock.calls.map((call) => call[0])).toEqual([
    [0x92, 60, 100],
    [0xe2, 127, 127],
    [0xd2, 61],
    [0xa2, 60, 62],
    [0x82, 60, 0],
  ])
  expect(r.other.send).not.toHaveBeenCalled()
})
it('retains future events until due and cancels one slot without clearing another on a shared port', async () => {
  const r = rig(),
    a = await r.backend.allocate(r.instrument),
    b = await r.backend.allocate(r.instrument)
  vi.mocked(r.output.send).mockClear()
  r.backend.noteOn(a, 60, 100, 1)
  r.backend.noteOn(b, 64, 100, 1)
  r.time(0.999)
  expect(r.output.send).not.toHaveBeenCalled()
  r.backend.clearScheduled(a)
  r.time(1)
  expect(r.output.send).toHaveBeenCalledExactlyOnceWith([0x92, 64, 100], 11000)
  r.backend.noteOff(b, 64, 2)
  r.backend.allNotesOff()
  vi.mocked(r.output.send).mockClear()
  r.time(3)
  expect(r.output.send).not.toHaveBeenCalled()
})
it('keeps shared pitches and sustain alive until their final owner releases', async () => {
  const r = rig(),
    a = await r.backend.allocate(r.instrument),
    b = await r.backend.allocate(r.instrument)
  vi.mocked(r.output.send).mockClear()
  r.backend.noteOn(a, 60, 100)
  r.backend.noteOn(b, 60, 80)
  expect(r.output.send).toHaveBeenCalledExactlyOnceWith([0x92, 60, 100], 10000)
  r.backend.cc(b, 64, 127)
  r.backend.release(a)
  expect(
    vi.mocked(r.output.send).mock.calls.map((call) => call[0]),
  ).not.toContainEqual([0x82, 60, 0])
  expect(
    vi.mocked(r.output.send).mock.calls.map((call) => call[0]),
  ).not.toContainEqual([0xb2, 120, 0])
  r.backend.noteOff(b, 60)
  expect(r.output.send).toHaveBeenCalledWith([0x82, 60, 0], 10000)
  r.backend.release(b)
  expect(r.output.send).toHaveBeenCalledWith([0xb2, 64, 0], 10000)
  expect(r.output.send).toHaveBeenCalledWith([0xb2, 120, 0], 10000)
})
it('does not retune held or sustained notes and accepts the new program after release', async () => {
  const r = rig(),
    a = await r.backend.allocate(r.instrument)
  r.backend.cc(a, 64, 127)
  r.backend.noteOn(a, 60, 100)
  const b = await r.backend.allocate({ ...r.instrument, program: 11 })
  vi.mocked(r.output.send).mockClear()
  r.backend.noteOn(b, 64, 100)
  expect(r.output.send).not.toHaveBeenCalled()
  r.backend.noteOff(a, 60)
  vi.mocked(r.output.send).mockClear()
  r.backend.noteOn(b, 65, 100)
  expect(r.output.send).not.toHaveBeenCalled()
  expect(r.warn).toHaveBeenCalledOnce()
  r.backend.cc(a, 64, 0)
  r.backend.noteOn(b, 67, 100)
  expect(r.output.send).toHaveBeenCalledWith([0xc2, 11], 10000)
  expect(r.output.send).toHaveBeenCalledWith([0x92, 67, 100], 10000)
  r.backend.noteOff(b, 64)
  expect(
    vi.mocked(r.output.send).mock.calls.map((call) => call[0]),
  ).not.toContainEqual([0x82, 64, 0])
})
it('drops queued events on disconnect and rebinds a replacement port without replaying notes', async () => {
  const r = rig(),
    id = await r.backend.allocate(r.instrument)
  r.backend.noteOn(id, 60, 100, 1)
  Object.assign(r.output, { state: 'disconnected' })
  r.backend.refresh()
  expect(r.backend.available(r.instrument)).toBe(false)
  const replacement = r.make('replacement')
  r.ports.splice(0, 1, replacement)
  r.backend.configure(id, r.instrument)
  vi.mocked(replacement.send).mockClear()
  r.time(2)
  expect(replacement.send).not.toHaveBeenCalled()
  r.backend.noteOn(id, 64, 100)
  expect(replacement.send).toHaveBeenCalledWith([0x92, 64, 100], 12000)
  expect(r.other.send).not.toHaveBeenCalled()
})
it('rejects missing, ambiguous and invalid destinations without sending messages', async () => {
  const r = rig()
  await expect(
    r.backend.allocate({
      ...r.instrument,
      midiOut: { portName: 'Absent', channel: 0 },
    }),
  ).rejects.toThrow('missing')
  r.ports.push(r.make('duplicate'))
  await expect(r.backend.allocate(r.instrument)).rejects.toThrow('ambiguous')
  await expect(
    r.backend.allocate({
      ...r.instrument,
      midiOut: { portName: 'Other', channel: 16 },
    }),
  ).rejects.toThrow('channel')
  expect(r.output.send).not.toHaveBeenCalled()
  expect(r.other.send).not.toHaveBeenCalled()
})
it('routes without fonts and preserves held destinations across port and backend changes', async () => {
  const r = rig(),
    web = new FakeBackend(),
    loads = vi.fn(async () => undefined),
    warn = vi.fn()
  const rack = new InstrumentRack(web, loads, warn, true, (instrument) =>
    instrument.backend === 'midi' ? r.backend : web,
  )
  const project = liveProject('External')
  project.soundfonts = []
  project.instruments = [r.instrument]
  await rack.synchronize(project)
  const held = rack.acquire(r.instrument.id)!
  expect(held).toBeDefined()
  held.backend.noteOn(held.slot, 60, 100)
  project.instruments[0] = {
    ...r.instrument,
    midiOut: { portName: 'Other', channel: 5 },
  }
  await rack.synchronize(project)
  expect(rack.get(r.instrument.id)!.slot).not.toBe(held.slot)
  expect(rack.get(r.instrument.id)!.backend.id).toBe('midi')
  expect(loads).not.toHaveBeenCalled()
  vi.mocked(r.other.send).mockClear()
  held.backend.noteOff(held.slot, 60)
  rack.release(held)
  expect(r.output.send).toHaveBeenCalledWith([0x82, 60, 0], 10000)
  expect(r.other.send).not.toHaveBeenCalled()
  expect(warn).not.toHaveBeenCalled()
  rack.close()
})

it('retains sequencer destinations through reconciliation and recovers after an output reconnects', async () => {
  const r = rig(),
    web = new FakeBackend(),
    warn = vi.fn()
  const seq = new SequenceOutput(
    web,
    async () => undefined,
    () => 0,
    warn,
    () => undefined,
    undefined,
    undefined,
    undefined,
    () => r.backend,
  )
  const project = liveProject('Sequence')
  project.soundfonts = []
  project.instruments = [r.instrument]
  await seq.synchronize(project)
  project.instruments[0] = {
    ...r.instrument,
    midiOut: { portName: 'Synth', channel: 5 },
  }
  await seq.synchronize(project, true)
  expect(warn).not.toHaveBeenCalled()
  seq.reset(false)
  Object.assign(r.output, { state: 'disconnected' })
  r.backend.refresh()
  await seq.synchronize(project)
  const replacement = r.make('replacement')
  r.ports.splice(0, 1, replacement)
  await seq.synchronize(project)
  expect(replacement.send).toHaveBeenCalledWith([0xc5, 48], 10000)
  expect(() => seq.close()).not.toThrow()
})
