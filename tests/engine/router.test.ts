import { expect, it } from 'vitest'
import { Router } from '../../src/engine/router/router'
import { InstrumentRack } from '../../src/engine/synth/rack'
import { liveProject } from '../../src/shared/template'
import { FakeBackend } from './fake-backend'
async function rig() {
  const project = liveProject('Live')
  project.instruments.push({
    ...project.instruments[0],
    id: 'strings',
    name: 'Strings',
    program: 48,
  })
  const piano = project.tracks[0]
  if (piano.kind !== 'midi') throw Error('Expected MIDI')
  project.tracks.push({ ...piano, id: 'strings', name: 'Strings', notes: [] })
  project.base.patch.push({
    id: 'strings',
    trackId: 'strings',
    instrumentId: 'strings',
  })
  const backend = new FakeBackend()
  const rack = new InstrumentRack(
    backend,
    async () => undefined,
    () => undefined,
  )
  await rack.synchronize(project)
  const router = new Router(rack, () => undefined)
  router.setProject(project)
  backend.events = []
  return { project, backend, rack, router }
}
it('routes a split on every MIDI channel', async () => {
  const { project, backend, router, rack } = await rig()
  project.base.zones = [
    { ...project.base.zones[0], hi: 59 },
    { ...project.base.zones[0], id: 'upper', lo: 60, trackIds: ['strings'] },
  ]
  router.note('keys', 6, 48, 100, true)
  router.note('keys', 6, 72, 90, true)
  expect(backend.events.filter((e) => e.type === 'on')).toEqual([
    { type: 'on', slot: rack.get('piano')!.slot, key: 48, value: 100 },
    { type: 'on', slot: rack.get('strings')!.slot, key: 72, value: 90 },
  ])
  router.close()
  rack.close()
})
it('supports overlapping zones, layered patches and all three transpositions', async () => {
  const { project, backend, router, rack } = await rig()
  project.instruments[1].transpose = -12
  await rack.synchronize(project)
  project.base.zones.push({
    ...project.base.zones[0],
    id: 'overlap',
    lo: 48,
    hi: 72,
    trackIds: ['strings'],
    transpose: 12,
    velocity: 'soft',
  })
  project.base.patch[1].transpose = 7
  router.note('keys', 0, 60, 64, true)
  const on = backend.events.filter((e) => e.type === 'on')
  expect(on.map((e) => e.key)).toEqual([60, 67])
  expect(on[1].value).toBeGreaterThan(64)
  router.note('keys', 0, 60, 0, false)
  project.base.zones = project.base.zones.slice(0, 1)
  project.base.patch.push({
    id: 'layer',
    trackId: 'piano',
    instrumentId: 'strings',
  })
  router.note('keys', 0, 60, 100, true)
  expect(
    backend.events
      .filter((e) => e.type === 'on')
      .slice(-2)
      .map((e) => e.key),
  ).toEqual([60, 48])
  router.close()
  rack.close()
})
it('sends note-off to the original slot and key after routing, transpose and preset changes', async () => {
  const { project, backend, router, rack } = await rig()
  project.base.patch.push({
    id: 'layer',
    trackId: 'piano',
    instrumentId: 'strings',
    transpose: 7,
  })
  router.note('keys', 6, 60, 100, true)
  const original = backend.events.filter((e) => e.type === 'on')
  const changed = structuredClone(project)
  changed.base.zones[0].trackIds = ['strings']
  changed.base.zones[0].transpose = 12
  changed.instruments[0].program = 6
  changed.instruments[1].program = 11
  await rack.synchronize(changed)
  router.setProject(changed)
  expect(backend.events.filter((e) => e.type === 'release')).toEqual([])
  router.note('keys', 6, 60, 0, false)
  expect(backend.events.filter((e) => e.type === 'off')).toEqual(
    original.map((e) => ({ type: 'off', slot: e.slot, key: e.key })),
  )
  expect(backend.events.filter((e) => e.type === 'release')).toHaveLength(2)
  router.close()
  rack.close()
})
it('releases unreachable sustain immediately and applies the held pedal to new destinations', async () => {
  const { project, backend, router, rack } = await rig()
  const old = rack.get('piano')!.slot
  router.cc('keys', 0, 64, 127)
  router.note('keys', 0, 60, 100, true)
  router.note('keys', 0, 60, 0, false)
  const changed = structuredClone(project)
  changed.base.zones[0].trackIds = ['strings']
  changed.instruments = changed.instruments.filter((i) => i.id !== 'piano')
  await rack.synchronize(changed)
  router.setProject(changed)
  router.note('keys', 0, 72, 100, true)
  router.note('keys', 0, 72, 0, false)
  expect(backend.events).toContainEqual({ type: 'release', slot: old })
  router.cc('keys', 0, 64, 0)
  expect(backend.events).toContainEqual({
    type: 'cc',
    slot: old,
    cc: 64,
    value: 0,
  })
  expect(backend.events).toContainEqual({
    type: 'cc',
    slot: rack.get('strings')!.slot,
    cc: 64,
    value: 0,
  })
  expect(backend.events).toContainEqual({ type: 'release', slot: old })
  router.close()
  rack.close()
})
it('keeps a shared pitch sounding until all input owners release it', async () => {
  const { backend, router, rack } = await rig()
  router.note('one', 0, 60, 100, true)
  router.note('two', 0, 60, 100, true)
  router.note('one', 0, 60, 0, false)
  expect(backend.events.filter((e) => e.type === 'off')).toHaveLength(0)
  router.disconnect('two')
  expect(backend.events.filter((e) => e.type === 'off')).toHaveLength(1)
  expect(router.keys()).toEqual({ held: [] })
  router.close()
  rack.close()
})
it('forwards modulation, bend and pressure and remembers transformed poly-pressure keys', async () => {
  const { project, backend, router, rack } = await rig()
  project.base.zones[0].transpose = 12
  router.cc('keys', 6, 1, 93)
  router.pitchBend('keys', 6, 12345)
  router.pressure('keys', 6, 80)
  router.note('keys', 6, 60, 100, true)
  router.polyPressure('keys', 6, 60, 70)
  expect(backend.events).toContainEqual({
    type: 'cc',
    slot: rack.get('piano')!.slot,
    cc: 1,
    value: 93,
  })
  expect(backend.events).toContainEqual({
    type: 'bend',
    slot: rack.get('piano')!.slot,
    value: 12345,
  })
  expect(backend.events).toContainEqual({
    type: 'pressure',
    slot: rack.get('piano')!.slot,
    value: 80,
  })
  expect(backend.events).toContainEqual({
    type: 'poly',
    slot: rack.get('piano')!.slot,
    key: 72,
    value: 70,
  })
  router.close()
  rack.close()
})
it('skips muted, gated and out-of-range paths; panic clears held and sustained ownership', async () => {
  const { project, backend, router, rack } = await rig()
  project.tracks[0].mode = 'mute'
  router.note('keys', 0, 60, 100, true)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(0)
  router.panic()
  project.tracks[0].mode = 'live'
  project.base.patch[0].when = { reg: 0, on: true }
  router.note('keys', 0, 60, 100, true)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(0)
  delete project.base.patch[0].when
  project.base.zones[0].transpose = 100
  router.note('keys', 0, 60, 100, true)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(0)
  router.panic()
  project.base.zones[0].transpose = 0
  router.cc('keys', 0, 64, 127)
  router.note('keys', 0, 60, 100, true)
  router.note('keys', 0, 60, 0, false)
  router.panic()
  expect(router.keys()).toEqual({ held: [] })
  expect(backend.events.at(-1)?.type).toBe('panic')
  router.close()
  rack.close()
})
it('auditions an instrument directly without cutting the same pitch held by a routed input', async () => {
  const { backend, router, rack } = await rig()
  router.note('keys', 0, 60, 100, true)
  router.note('audition', 0, 60, 100, true, 'piano')
  router.note('audition', 0, 60, 0, false, 'piano')
  expect(backend.events.filter((e) => e.type === 'off')).toHaveLength(0)
  router.note('keys', 0, 60, 0, false)
  expect(backend.events.filter((e) => e.type === 'off')).toHaveLength(1)
  expect(router.keys()).toEqual({ held: [] })
  router.close()
  rack.close()
})
it('isolates mixer levels for two live tracks sharing an instrument', async () => {
  const { project, backend, router, rack } = await rig()
  router.close()
  rack.close()
  project.base.patch[1].instrumentId = 'piano'
  project.tracks[0].volume = 0.5
  project.tracks[1].volume = 0.25
  project.tracks[1].pan = 0.75
  const isolated = new InstrumentRack(
    backend,
    async () => undefined,
    () => undefined,
    true,
  )
  await isolated.synchronize(project)
  const lower = isolated.get('piano', 'piano')!,
    upper = isolated.get('piano', 'strings')!
  expect(lower.slot).not.toBe(upper.slot)
  expect(lower.instrument.volume).toBeCloseTo(0.4)
  expect(upper.instrument.volume).toBeCloseTo(0.2)
  expect(upper.instrument.pan).toBe(0.75)
  const live = new Router(isolated, () => undefined)
  live.setProject(project)
  project.base.zones.push({
    ...project.base.zones[0],
    id: 'upper',
    trackIds: ['strings'],
  })
  live.note('keys', 0, 60, 100, true)
  expect(
    backend.events
      .filter((e) => e.type === 'on')
      .slice(-2)
      .map((e) => e.slot),
  ).toEqual([lower.slot, upper.slot])
  project.tracks[1].solo = true
  live.note('keys', 0, 62, 100, true)
  expect(backend.events.filter((e) => e.type === 'on').slice(-1)[0].slot).toBe(
    upper.slot,
  )
  live.close()
  isolated.close()
})
it('captures a post-zone note once before layers and releases it on the original track', async () => {
  const { project, backend, rack, router } = await rig()
  router.close()
  project.base.zones[0].transpose = 12
  project.base.zones[0].velocity = 'soft'
  project.base.patch.push({
    id: 'layer',
    trackId: 'piano',
    instrumentId: 'strings',
    transpose: 7,
  })
  const recorded: import('../../src/shared/recording').RoutedNote[] = []
  const input = new Router(
    rack,
    () => undefined,
    (n) => recorded.push(n),
  )
  input.setProject(project)
  input.note('keys', 4, 48, 64, true)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(2)
  expect(recorded).toHaveLength(1)
  expect(recorded[0]).toMatchObject({ trackId: 'piano', key: 60, on: true })
  expect(recorded[0].velocity).toBeGreaterThan(64)
  project.base.zones[0].trackIds = ['strings']
  input.note('keys', 4, 48, 0, false)
  expect(recorded[1]).toMatchObject({
    id: recorded[0].id,
    trackId: 'piano',
    key: 60,
    on: false,
  })
  input.close()
  rack.close()
})
it('records direct pad notes on their track while keeping editor auditions out of takes', async () => {
  const { project, backend, rack } = await rig(),
    notes: import('../../src/shared/recording').RoutedNote[] = [],
    router = new Router(
      rack,
      () => undefined,
      (n) => notes.push(n),
    )
  router.setProject(project)
  router.note('editor', 0, 60, 100, true, undefined, 'piano')
  router.note('editor', 0, 60, 0, false, undefined, 'piano')
  expect(notes).toHaveLength(0)
  router.note('pad', 0, 64, 100, true, undefined, 'strings', undefined, true)
  router.note('pad', 0, 64, 0, false, undefined, 'strings', undefined, true)
  expect(
    notes.map((n) => ({ on: n.on, trackId: n.trackId, key: n.key })),
  ).toEqual([
    { on: true, trackId: 'strings', key: 64 },
    { on: false, trackId: 'strings', key: 64 },
  ])
  expect(notes.every((n) => n.live === false)).toBe(true)
  router.note(
    'controller-pad',
    0,
    60,
    100,
    true,
    undefined,
    'piano',
    undefined,
    true,
    60,
    true,
  )
  router.note('controller-pad', 0, 60, 0, false, undefined, 'piano')
  expect(notes.slice(-2).every((n) => n.live === true)).toBe(true)
  const count = backend.events.filter((e) => e.type === 'on').length
  project.tracks.find((t) => t.id === 'strings')!.mode = 'mute'
  router.note('pad', 0, 65, 100, true, undefined, 'strings', undefined, true)
  router.note('pad', 0, 65, 0, false, undefined, 'strings', undefined, true)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(count)
  expect(notes.at(-2)).toMatchObject({ on: true, trackId: 'strings', key: 65 })
  router.close()
  rack.close()
})
it('reports semantic instrument ids and virtual-track activity even when an instrument gate is closed', async () => {
  const { project, backend, rack, router } = await rig()
  project.base.patch[0].when = { reg: 0, on: true }
  router.setProject(project)
  router.note('keys', 0, 60, 100, true)
  expect(router.activity()).toContainEqual({
    sourceId: 'keys:keys',
    trackId: 'piano',
    zoneId: 'keyboard',
  })
  expect(router.activity().some((r) => r.instrumentId)).toBe(false)
  router.note('keys', 0, 60, 0, false)
  delete project.base.patch[0].when
  project.base.patch[1].instrumentId = 'piano'
  project.base.zones.push({
    ...project.base.zones[0],
    id: 'upper',
    trackIds: ['strings'],
  })
  router.close()
  rack.close()
  const isolated = new InstrumentRack(
    backend,
    async () => undefined,
    () => undefined,
    true,
  )
  await isolated.synchronize(project)
  const input = new Router(isolated, () => undefined)
  input.setProject(project)
  input.note('keylab', 0, 60, 100, true)
  expect(
    input
      .activity()
      .filter((r) => r.instrumentId)
      .map((r) => r.instrumentId),
  ).toEqual(['piano', 'piano'])
  input.note('keylab', 0, 60, 0, false)
  expect(input.activity()).toEqual([])
  input.close()
  isolated.close()
})
it('keeps transformed notes from different physical keys independent across route changes', async () => {
  const { project, backend, router, rack } = await rig()
  router.note(
    'keys',
    0,
    72,
    100,
    true,
    undefined,
    undefined,
    undefined,
    false,
    60,
  )
  project.base.patch = [
    { id: 'new', trackId: 'piano', instrumentId: 'strings' },
  ]
  router.setProject(project)
  router.note(
    'keys',
    0,
    72,
    100,
    true,
    undefined,
    undefined,
    undefined,
    false,
    61,
  )
  backend.events = []
  router.note(
    'keys',
    0,
    72,
    0,
    false,
    undefined,
    undefined,
    undefined,
    false,
    61,
  )
  const released = backend.events.filter((e) => e.type === 'off')
  expect(released).toHaveLength(1)
  expect(released[0].slot).toBe(rack.get('strings')!.slot)
  router.disconnect('keys')
  expect(router.keys().held).toEqual([])
})
it('releases the original orchestra layers after a preset switch and section toggle', async () => {
  const { project, backend, rack } = await rig()
  const track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI track')
  track.orchestraId = 'first'
  project.base.patch = []
  const registers = [true]
  project.orchestras = ['first', 'second'].map((id, i) => ({
    id,
    name: id,
    color: '#ffffff',
    maxLayers: 1,
    outOfRange: 'silent',
    sections: [
      {
        name: 'Section',
        register: 0,
        startOn: true,
        members: [
          {
            instrumentId: i ? 'strings' : 'piano',
            lo: 0,
            hi: 127,
            comfortLo: 48,
            comfortHi: 72,
            enabled: true,
            octave: i,
            gain: 1,
          },
        ],
      },
    ],
  }))
  const router = new Router(
    rack,
    () => undefined,
    () => undefined,
    () => ({ registers, bar: 1, activeSceneId: null, playing: false }),
  )
  router.setProject(project)
  router.cc('keys', 0, 64, 127)
  backend.events = []
  router.note('keys', 0, 60, 90, true)
  router.note('keys', 0, 60, 0, false)
  track.orchestraId = 'second'
  router.setProject(project)
  router.note('keys', 0, 62, 90, true)
  registers[0] = false
  router.setProject(project)
  router.note('keys', 0, 62, 0, false)
  expect(
    backend.events.filter((e) => e.type === 'off').map((e) => e.key),
  ).toEqual([60, 74])
  expect(
    backend.events.filter(
      (e) => e.type === 'cc' && e.cc === 64 && e.value === 0,
    ),
  ).toHaveLength(0)
  router.cc('keys', 0, 64, 0)
  expect(
    backend.events.filter(
      (e) => e.type === 'cc' && e.cc === 64 && e.value === 0,
    ),
  ).toHaveLength(2)
  router.close()
  rack.close()
})
