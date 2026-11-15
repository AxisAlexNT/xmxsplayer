import { afterEach, expect, it, vi } from 'vitest'
import {
  decodeMidi,
  MidiIO,
  type MidiMessage,
} from '../../src/engine/midi/midi-io'
import type { EventMap } from '../../src/shared/protocol'
afterEach(() => vi.unstubAllGlobals())
it('decodes channel, timestamps, zero-velocity note-off, bend and pressure', () => {
  expect(
    decodeMidi('keyboard', new Uint8Array([0x96, 60, 100]), 123.5),
  ).toEqual({
    source: 'keyboard',
    channel: 6,
    type: 'note',
    key: 60,
    velocity: 100,
    on: true,
    timestamp: 123.5,
  })
  expect(decodeMidi('keyboard', new Uint8Array([0x96, 60, 0]), 124)?.type).toBe(
    'note',
  )
  expect(
    decodeMidi('keyboard', new Uint8Array([0xe6, 0, 64]), 124),
  ).toMatchObject({ type: 'bend', value: 8192 })
  expect(decodeMidi('keyboard', new Uint8Array([0xd6, 90]), 124)).toMatchObject(
    { type: 'pressure', value: 90 },
  )
  expect(
    decodeMidi('keyboard', new Uint8Array([0xa6, 60, 80]), 124),
  ).toMatchObject({ type: 'poly', key: 60, value: 80 })
  expect(decodeMidi('keyboard', new Uint8Array([0x96, 60]), 124)).toBeNull()
  expect(
    decodeMidi('keyboard', new Uint8Array([0xf0, 0x20, 1]), 124),
  ).toBeNull()
})
it('opens inputs, ignores MCU/HUI, tracks hot-plug and never opens or sends to outputs', async () => {
  const input = {
    id: 'main',
    name: 'KL Essential 61 mk3 MIDI',
    state: 'connected',
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onmidimessage: null as ((event: MIDIMessageEvent) => void) | null,
  }
  const mcu = {
    ...input,
    id: 'mcu',
    name: 'KL Essential 61 mk3 MCU/HUI',
    open: vi.fn(),
  }
  const output = {
    id: 'din',
    name: 'KL Essential 61 mk3 DINTHRU',
    state: 'connected',
    open: vi.fn(),
    send: vi.fn(),
  }
  const access = {
    inputs: new Map([
      ['main', input],
      ['mcu', mcu],
    ]),
    outputs: new Map([['din', output]]),
    onstatechange: null as (() => void) | null,
  }
  const request = vi.fn(async () => access)
  vi.stubGlobal('navigator', { requestMIDIAccess: request })
  const received: MidiMessage[] = []
  let ports: EventMap['midi:ports'] | undefined
  const disconnected = vi.fn()
  const midi = new MidiIO(
    (m) => received.push(m),
    (p) => {
      ports = p
    },
    disconnected,
    () => undefined,
  )
  await midi.start()
  expect(request).toHaveBeenCalledWith({ sysex: true })
  expect(input.open).toHaveBeenCalledOnce()
  expect(mcu.open).not.toHaveBeenCalled()
  expect(ports!.inputs).toEqual([{ id: 'main', name: input.name }])
  input.onmidimessage!({
    data: new Uint8Array([0x90, 60, 100]),
    timeStamp: 555,
  } as MIDIMessageEvent)
  expect(received[0]).toMatchObject({ key: 60, timestamp: 555 })
  access.inputs.delete('main')
  access.onstatechange!()
  expect(disconnected).toHaveBeenCalledWith('main')
  expect(output.open).not.toHaveBeenCalled()
  expect(output.send).not.toHaveBeenCalled()
  midi.close()
})
it('keeps smoke tests from requesting MIDI access or exposing hardware ports', async () => {
  const request = vi.fn(),
    ports = vi.fn()
  vi.stubGlobal('navigator', { requestMIDIAccess: request })
  const midi = new MidiIO(vi.fn(), ports, vi.fn(), vi.fn())
  await midi.start(false)
  expect(request).not.toHaveBeenCalled()
  expect(ports).toHaveBeenCalledExactlyOnceWith({
    inputs: [],
    outputs: [],
    devices: [],
  })
  midi.close()
})
