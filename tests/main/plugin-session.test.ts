import { expect, it } from 'vitest'
import { planPluginSession } from '../../src/main/plugin-session'
import {
  requiredPlugins,
  type DiscoveredPlugin,
  type PluginRef,
} from '../../src/shared/plugins'
import { liveProject } from '../../src/shared/template'
import { fromFiles, toFiles } from '../../src/shared/project-files'
it('restores plugin references and routes a kick into a sidechain and both instruments through the master', () => {
  const project = liveProject('Plugin session')
  const ref = (uri: string): PluginRef => ({ uri, format: 'lv2', name: uri })
  project.instruments[0] = {
    ...project.instruments[0],
    backend: 'plugin',
    plugin: ref('urn:pad'),
  }
  project.instruments.push({
    ...project.instruments[0],
    id: 'kick',
    plugin: ref('urn:kick'),
  })
  project.instruments[0].effects = [
    {
      id: 'duck',
      type: 'plugin',
      plugin: ref('urn:duck'),
      enabled: true,
      params: { '1': 0.5 },
      sidechain: { trackId: 'kick-track' },
    },
  ]
  project.masterEffects = [
    {
      id: 'room',
      type: 'plugin',
      plugin: ref('urn:room'),
      enabled: true,
      params: {},
    },
  ]
  project.tracks.push({ ...project.tracks[0], id: 'kick-track' })
  project.base.patch.push({
    id: 'kick-route',
    trackId: 'kick-track',
    instrumentId: 'kick',
  })
  const restored = fromFiles(toFiles(project))
  const refs = requiredPlugins(restored)
  expect(refs.map((r) => r.uri).sort()).toEqual([
    'urn:duck',
    'urn:kick',
    'urn:pad',
    'urn:room',
  ])
  const installed = refs.map(
    (r) =>
      ({
        ...r,
        file: '',
        instrument: ['urn:pad', 'urn:kick'].includes(r.uri),
        maker: '',
        customUi: false,
        audioInputs: 2,
        audioOutputs: 2,
        parameters: 1,
        midiInputs: 1,
        uniqueId: 0,
      }) satisfies DiscoveredPlugin,
  )
  const ports = Object.fromEntries(
    refs.map((r) => [
      r.uri,
      {
        inputs: ['key L', 'left', 'key R', 'right'],
        sidechains: ['key L', 'key R'],
        outputs: ['out L', 'out R'],
        parameters: [],
      },
    ]),
  )
  const session = planPluginSession(restored, installed, ports)
  expect(session.connections).toContainEqual({
    source: 'instrument-kick:out R',
    target: 'instrument-piano-insert-0:key R',
  })
  expect(session.connections).toContainEqual({
    source: 'master-insert-0:out L',
    target: 'Audio Output:Playback 1',
  })
  expect(session.connections).toContainEqual({
    source: 'instrument-piano-insert-0:out R',
    target: 'master-insert-0:right',
  })
  ports['urn:duck'].inputs = ['Input', 'Sidechain input']
  ports['urn:duck'].sidechains = ['Sidechain input']
  const mono = planPluginSession(restored, installed, ports)
  expect(mono.connections.filter(c => c.target === 'instrument-piano-insert-0:Sidechain input')
    .map(c => c.source).sort()).toEqual(['instrument-kick:out L', 'instrument-kick:out R'])
  expect(() => planPluginSession(restored, [], {})).toThrow('Missing plugin')
})

it.skipIf(process.env.XM_CARLA_DUMMY_TEST !== '1')(
  'meters a Geonkick trigger at an LSP external detector and Dragonfly on the master',
  async () => {
    const { PluginHost } = await import('../../src/main/plugin-host')
    const { readLv2Ports } = await import('../../src/main/plugin-session')
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const project = liveProject('Kick and hall')
    const kick: PluginRef = {
      format: 'lv2',
      uri: 'http://geontime.com/geonkick/single',
      name: 'Geonkick Single',
    }
    const hall: PluginRef = {
      format: 'lv2',
      uri: 'https://github.com/michaelwillis/dragonfly-reverb',
      name: 'Dragonfly Hall',
    }
    project.instruments[0] = {
      ...project.instruments[0],
      backend: 'plugin',
      plugin: kick,
    }
    const duck: PluginRef = {
      format: 'lv2',
      uri: 'http://lsp-plug.in/plugins/lv2/sc_compressor_mono',
      name: 'LSP Sidechain Compressor Mono',
    }
    project.instruments.push({
      ...project.instruments[0],
      id: 'silent',
      effects: [{
        id: 'duck', type: 'plugin', plugin: duck, enabled: true, params: {},
        sidechain: { trackId: project.tracks[0].id },
      }],
    })
    project.masterEffects = [
      { id: 'hall', type: 'plugin', plugin: hall, enabled: true, params: {} },
    ]
    const ports = await readLv2Ports('resources/plugins/lv2-ports.py', [
      kick.uri,
      hall.uri,
      duck.uri,
    ])
    const params = project.instruments[1].effects![0].params
    for (const [name, value] of [['Sidechain type', 2], ['Sidechain listen', 1]] as const) {
      const control = ports[duck.uri].parameters.find(p => p.name === name)!
      params[control.index] = value
    }
    const installed = [kick, hall, duck].map((ref) => ({
      ...ref,
      file: '',
      maker: '',
      instrument: ref === kick,
      customUi: true,
      audioInputs: ref === kick ? 0 : 2,
      audioOutputs: 2,
      midiInputs: 1,
      parameters: 0,
      uniqueId: 0,
    }))
    const plan = planPluginSession(project, installed, ports)
    const dir = await mkdtemp(join(tmpdir(), 'xmxs-plugin-note-'))
    const peaks = new Map<string, number>()
    const host = new PluginHost(
      () => undefined,
      'SDL',
      (f) => peaks.set(f.id, Math.max(peaks.get(f.id) ?? 0, f.left, f.right)),
    )
    try {
      await host.configure(dir, plan)
      for (const note of [36, 60, 38, 42]) {
        host.send('instrument-piano', 'note_on', [
          { type: 'i', value: 0 },
          { type: 'i', value: note },
          { type: 'i', value: 110 },
        ])
        await new Promise((r) => setTimeout(r, 120))
        host.send('instrument-piano', 'note_off', [
          { type: 'i', value: 0 },
          { type: 'i', value: note },
        ])
      }
      expect(peaks.get('instrument-piano')).toBeGreaterThan(0)
      expect(peaks.get('instrument-silent-insert-0')).toBeGreaterThan(0)
      expect(peaks.get('master-insert-0')).toBeGreaterThan(0)
    } finally {
      await host.stop()
      await rm(dir, { recursive: true, force: true })
    }
  },
  30000,
)
