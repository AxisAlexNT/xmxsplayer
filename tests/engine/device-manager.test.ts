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
it('pairs controller feedback independently of external output choices and closes hot-plug notes', async () => {
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
  ).toEqual(['out', 'din'])
  expect(manager.outputs()).toEqual([out, din])
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
it('isolates learning from live controls while releasing previously held keys and sustain', async () => {
  const a = port('a', 'KL Essential 61 mk3 MIDI'),
    access = { inputs: new Map([['a', a]]), outputs: new Map() }
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })
  const key = vi.fn(),
    control = vi.fn(),
    captured = vi.fn(),
    manager = new DeviceManager(
      defaultSettings().devices,
      key,
      control,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      captured,
    )
  await manager.start()
  const send = (data: number[]) =>
    a.onmidimessage!({
      data: new Uint8Array(data),
      timeStamp: 1,
    } as MIDIMessageEvent)
  send([0x96, 60, 100])
  send([0xb6, 64, 127])
  expect(key).toHaveBeenCalledTimes(2)
  manager.learn.start(
    'a',
    manager.devices()[0].profile.controls.find((c) => c.id === 'pad.3')!,
  )
  send([0x99, 42, 100])
  send([0x89, 42, 0])
  send([0xb0, 21, 127])
  send([0xb0, 21, 0])
  send([0x86, 60, 0])
  send([0xb6, 64, 0])
  expect(captured).toHaveBeenCalledOnce()
  expect(control).not.toHaveBeenCalled()
  expect(key).toHaveBeenCalledTimes(4)
  expect(key.mock.calls.slice(2).map((c) => c[0].type)).toEqual(['note', 'cc'])
  manager.learn.stop()
  send([0xb0, 21, 127])
  expect(control).toHaveBeenCalledOnce()
  manager.close()
})

it('routes on-screen practice gestures through controller bindings until a physical controller connects', async () => {
  const inputs = new Map<string, ReturnType<typeof port>>()
  const access = { inputs, outputs: new Map(), onstatechange: null as (() => void) | null }
  vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })
  const control = vi.fn(), report = vi.fn(), disconnected = vi.fn()
  const manager = new DeviceManager(defaultSettings().devices, vi.fn(), control, report, disconnected, vi.fn())
  await manager.start()
  manager.setTutorialEnabled(true)
  expect(report.mock.lastCall?.[0].inputs).toEqual([])
  expect(manager.devices()[0].id).toBe('tutorial-controller')
  manager.tutorialGesture('pad', 1)
  manager.tutorialGesture('knob', 0.25)
  expect(control.mock.calls.map(([event]) => [event.controlId, event.edge, event.value])).toEqual([
    ['pad.1','press',1], ['pad.1','release',0], ['knob.1','change',0.25],
  ])
  inputs.set('a', port('a', 'KL Essential 61 mk3 MIDI'))
  access.onstatechange!()
  expect(disconnected).toHaveBeenCalledWith('tutorial-controller')
  manager.tutorialGesture('fader', 0.5)
  expect(control).toHaveBeenCalledTimes(3)
  inputs.clear()
  access.onstatechange!()
  manager.tutorialGesture('fader', 0.5)
  expect(control.mock.lastCall?.[0]).toMatchObject({controlId:'fader.1', value:0.5})
  manager.setTutorialEnabled(false)
  expect(manager.devices()).toEqual([])
  manager.close()
})
