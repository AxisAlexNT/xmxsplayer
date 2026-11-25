import { expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeOsc, encodeOsc } from '../../src/main/osc'
import { parseDiscovery } from '../../src/main/plugin-discovery'
import { PluginHost, sessionXml } from '../../src/main/plugin-host'

const captured = `carla-discovery::init::-----------
carla-discovery::hints::10
carla-discovery::category::delay
carla-discovery::name::Dragonfly Hall Reverb
carla-discovery::maker::Michael Willis and Rob vd Berg
carla-discovery::label::DragonflyHallReverb.lv2/https://github.com/michaelwillis/dragonfly-reverb
carla-discovery::audio.ins::2
carla-discovery::audio.outs::2
carla-discovery::midi.ins::0
carla-discovery::parameters.ins::18
carla-discovery::end::------------`
const [plugin] = parseDiscovery(
  captured,
  'lv2',
  '/usr/lib/lv2/DragonflyHallReverb.lv2',
)
const session = {
  plugins: [{ id: 'room', plugin }],
  connections: [
    { source: 'room:Audio Output 1', target: 'Audio Output:Playback 1' },
    { source: 'room:Audio Output 2', target: 'Audio Output:Playback 2' },
  ],
}

it('parses captured LV2 discovery records and writes Carla patchbay XML', () => {
  expect(plugin).toMatchObject({
    uri: 'https://github.com/michaelwillis/dragonfly-reverb',
    instrument: false,
    customUi: true,
    parameters: 18,
  })
  expect(sessionXml(session)).toMatchSnapshot()
})
it('reads and writes OSC control bytes with explicit integer, float and string types', () => {
  const args = [
    { type: 'i', value: 7 },
    { type: 'f', value: 0.5 },
    { type: 's', value: 'Hall' },
  ] as const
  const bytes = encodeOsc('/fx', [...args])
  expect(bytes.toString('hex')).toBe(
    '2f6678002c69667300000000000000073f00000048616c6c00000000',
  )
  expect(decodeOsc(bytes)).toEqual({ address: '/fx', args })
  expect(() => decodeOsc(bytes.subarray(0, -1))).toThrow()
})
it('leaves an ordinary project untouched without detecting or starting Carla', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xmxs-plain-')),
    emit = vi.fn()
  const host = new PluginHost(emit)
  try {
    await host.configure(
      dir,
      { plugins: [], connections: [] },
      '/missing/carla',
    )
    expect(await readdir(dir)).toEqual([])
    expect(emit).not.toHaveBeenCalled()
  } finally {
    await host.stop()
    await rm(dir, { recursive: true, force: true })
  }
})
it.skipIf(process.env.XM_CARLA_DUMMY_TEST !== '1')(
  'opens a real headless LV2 session and shuts down with dummy audio',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xmxs-carla-integration-')),
      emit = vi.fn()
    const levels = vi.fn()
    const host = new PluginHost(emit, 'SDL', levels)
    try {
      await mkdir(join(dir, '.xmxs'))
      await host.configure(dir, session, '/usr/bin/carla')
      expect(emit).toHaveBeenCalledWith({ status: 'ready' })
      host.send('room', 'set_parameter_value', [
        { type: 'i', value: 0 },
        { type: 'f', value: 65 },
      ])
      await vi.waitFor(
        () =>
          expect(levels).toHaveBeenCalledWith({
            id: 'room',
            left: 0,
            right: 0,
          }),
        { timeout: 3000 },
      )
      await host.configure(dir, { plugins: [], connections: [] })
      expect(() =>
        host.send('room', 'set_volume', [{ type: 'f', value: 1 }]),
      ).toThrow('unavailable')
    } finally {
      await host.stop()
      await rm(dir, { recursive: true, force: true })
    }
  },
  30000,
)

it.skipIf(process.env.XM_CARLA_DUMMY_TEST !== '1')(
  'restores saved native plugin parameters into a fresh Carla process',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xmxs-carla-state-'))
    const host = new PluginHost(
      () => undefined,
      'SDL',
      undefined,
      'resources/plugins/carla-control.py',
    )
    const { readFile } = await import('node:fs/promises')
    try {
      await host.configure(dir, session, '/usr/bin/carla')
      host.send('room', 'set_parameter_value', [
        { type: 'i', value: 0 },
        { type: 'f', value: 67 },
      ])
      await new Promise((r) => setTimeout(r, 100))
      // Reloading the graph carries over an unsaved native edit.
      await host.configure(
        dir,
        { ...session, connections: session.connections.slice(0, 1) },
        '/usr/bin/carla',
      )
      await host.saveStates()
      const [file] = await readdir(join(dir, 'plugins'))
      const state = () => readFile(join(dir, 'plugins', file), 'utf8')
      expect(await state()).toMatch(
        /<Symbol>dry_level<\/Symbol>\s*<Value>67<\/Value>/,
      )
      await host.stop()
      await host.configure(dir, session, '/usr/bin/carla')
      await host.saveStates()
      expect(await state()).toMatch(
        /<Symbol>dry_level<\/Symbol>\s*<Value>67<\/Value>/,
      )
    } finally {
      await host.stop()
      await rm(dir, { recursive: true, force: true })
    }
  },
  30000,
)
