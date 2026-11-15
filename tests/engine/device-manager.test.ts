import { afterEach, expect, it, vi } from 'vitest'
import { DeviceManager } from '../../src/engine/midi/device-manager'
import { defaultSettings } from '../../src/shared/defaults'
afterEach(() => vi.unstubAllGlobals())
function port(id: string, name: string) {
  return {
    id,
    name,
    state: 'connected',
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    send: vi.fn(),
    onmidimessage: null as ((e: MIDIMessageEvent) => void) | null,
  }
}
it('groups main input/output per device, filters auxiliaries, decodes concurrent devices and closes hot-plug notes', async () => {
  const a = port('a', 'KL Essential 61 mk3 MIDI'),
    aux = port('aux', 'KL Essential 61 mk3 ALV'),
    b = port('b', 'Other keyboard'),
    out = port('out', a.name),
    din = port('din', 'KL Essential 61 mk3 DINTHRU'),
    access = {
      inputs: new Map([
        ['a', a],
        ['aux', aux],
        ['b', b],
      ]),
      outputs: new Map([
        ['out', out],
        ['din', din],
      ]),
      onstatechange: null as (() => void) | null,
    }
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })
  const key = vi.fn(),
    control = vi.fn(),
    ports = vi.fn(),
    off = vi.fn(),
    manager = new DeviceManager(
      defaultSettings().devices,
      key,
      control,
      ports,
      off,
      vi.fn(),
    )
  await manager.start()
  expect(manager.devices()).toMatchObject([
    {
      id: 'a',
      outputId: 'out',
      profile: { id: 'arturia-keylab-essential-mk3' },
    },
    { id: 'b', profile: { id: 'generic' } },
  ])
  expect(
    ports.mock.lastCall?.[0].inputs.map((p: { id: string }) => p.id),
  ).toEqual(['a', 'b'])
  expect(
    ports.mock.lastCall?.[0].outputs.map((p: { id: string }) => p.id),
  ).toEqual(['out'])
  a.onmidimessage!({
    data: new Uint8Array([0x99, 40, 100]),
    timeStamp: 10,
  } as MIDIMessageEvent)
  b.onmidimessage!({
    data: new Uint8Array([0x90, 60, 100]),
    timeStamp: 11,
  } as MIDIMessageEvent)
  aux.onmidimessage!({
    data: new Uint8Array([0x90, 70, 100]),
    timeStamp: 12,
  } as MIDIMessageEvent)
  expect(control).toHaveBeenCalledOnce()
  expect(key).toHaveBeenCalledOnce()
  expect(key.mock.lastCall?.[0]).toMatchObject({ source: 'b', key: 60 })
  access.inputs.delete('a')
  access.onstatechange!()
  expect(off).toHaveBeenCalledTimes(1)
  expect(off).toHaveBeenCalledWith('a')
  access.inputs.set('a', a)
  access.onstatechange!()
  expect(manager.devices().some((d) => d.id === 'a')).toBe(true)
  expect(out.send).not.toHaveBeenCalled()
  expect(din.send).not.toHaveBeenCalled()
  expect(din.open).not.toHaveBeenCalled()
  manager.close()
})
it('refuses ambiguous feedback output pairing and releases notes on profile reassignment', async () => {
  const a = port('a', 'Twin'),
    b = port('b', 'Twin'),
    o = port('o', 'Twin'),
    access = {
      inputs: new Map([
        ['a', a],
        ['b', b],
      ]),
      outputs: new Map([['o', o]]),
    }
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })
  const off = vi.fn(),
    config = defaultSettings().devices,
    manager = new DeviceManager(config, vi.fn(), vi.fn(), vi.fn(), off, vi.fn())
  await manager.start()
  expect(manager.devices().every((d) => !d.outputId)).toBe(true)
  manager.configure({
    ...config,
    assignments: { Twin: 'arturia-keylab-essential-mk3' },
  })
  expect(off).toHaveBeenCalledTimes(2)
  manager.close()
})
