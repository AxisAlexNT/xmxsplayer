import { expect, it } from 'vitest'
import { Registers } from '../../src/engine/performance/registers'
import { Scenes } from '../../src/engine/performance/scenes'
import { liveProject } from '../../src/shared/template'
import type { RegisterDef } from '../../src/shared/model'

const definitions = (): RegisterDef[] =>
  Array.from({ length: 8 }, (_, i) => ({
    name: `Register ${i + 1}`,
    mode: i < 3 ? 'exclusive' : 'toggle',
    ...(i < 3 ? { group: 'accompaniment' } : {}),
  }))
it('combines toggles, keeps exclusive groups exclusive and ignores invalid indices', () => {
  const bank = new Registers()
  bank.configure(definitions())
  bank.toggle(0)
  bank.toggle(1)
  bank.toggle(4)
  bank.toggle(5)
  bank.set(8, true)
  bank.set(-1, true)
  bank.set(1.5, true)
  expect(bank.values).toEqual([
    false,
    true,
    false,
    false,
    true,
    true,
    false,
    false,
  ])
  bank.toggle(1)
  expect(bank.values[1]).toBe(false)
})
it('owns momentary registers per source and restores underlying exclusive choices', () => {
  const bank = new Registers()
  bank.configure(definitions())
  bank.set(0, true)
  bank.momentary(1, 'pad-one', true)
  bank.momentary(2, 'pad-two', true)
  expect(bank.values.slice(0, 3)).toEqual([false, false, true])
  bank.momentary(1, 'pad-one', false)
  expect(bank.values.slice(0, 3)).toEqual([false, false, true])
  bank.momentary(2, 'pad-two', false)
  expect(bank.values.slice(0, 3)).toEqual([true, false, false])
  bank.momentary(4, 'one', true)
  bank.momentary(4, 'two', true)
  bank.momentary(4, 'one', false)
  expect(bank.values[4]).toBe(true)
  bank.momentary(4, 'two', false)
  expect(bank.values[4]).toBe(false)
})
it('applies partial scene presets without leaving exclusive groups in an invalid state', () => {
  const bank = new Registers()
  bank.configure(definitions())
  bank.set(0, true)
  bank.set(4, true)
  bank.preset([null, true, null, true, null, false])
  expect(bank.values).toEqual([
    false,
    true,
    false,
    true,
    true,
    false,
    false,
    false,
  ])
  bank.configure(
    definitions().map((d, i) =>
      i === 4 ? { ...d, mode: 'exclusive', group: 'accompaniment' } : d,
    ),
  )
  expect(bank.values).toEqual([
    false,
    false,
    false,
    true,
    true,
    false,
    false,
    false,
  ])
  bank.reset()
  expect(bank.values.every((on) => !on)).toBe(true)
})
it('activates scenes at the queued boundary and resolves conditional patching without mutating the document', () => {
  const project = liveProject('Scenes')
  project.registers = definitions()
  project.base.patch[0].when = { reg: 1, on: true }
  project.scenes = [
    { id: 'a', name: 'A', color: '#ff0000', registers: [true] },
    {
      id: 'b',
      name: 'B',
      color: '#00ff00',
      registers: [null, true, null, null, null, null, null, null],
      zones: [{ ...project.base.zones[0], lo: 48, hi: 84 }],
      trackModes: { piano: 'auto' },
    },
  ]
  const pending: (() => void)[] = []
  let changed = 0
  const scenes = new Scenes({
    queue(at, run) {
      if (at === 'now') {
        run()
        return 0
      }
      pending.push(run)
      return pending.length
    },
    changed() {
      changed++
    },
    context: () => ({ bar: 1, playing: true }),
  })
  scenes.configure(project)
  scenes.activate('a')
  expect(scenes.setup()?.patch).toHaveLength(0)
  expect(scenes.activate('b', 'bar')).toBe(1)
  expect(scenes.activeId).toBe('a')
  pending.shift()!()
  const effective = scenes.effectiveProject()!
  expect(scenes.activeId).toBe('b')
  expect(effective.base.patch[0].when).toBeUndefined()
  expect(effective.base.zones[0]).toMatchObject({ lo: 48, hi: 84 })
  expect(effective.tracks[0].mode).toBe('auto')
  expect(project.base.zones[0].lo).not.toBe(48)
  expect(project.base.patch[0].when).toEqual({ reg: 1, on: true })
  expect(project.tracks[0].mode).toBe('live')
  expect(changed).toBe(2)
  scenes.run({ type: 'scene', cmd: 'next' })
  expect(scenes.activeId).toBe('a')
  scenes.run({ type: 'scene', cmd: 'prev' })
  expect(scenes.activeId).toBe('b')
  scenes.run({ type: 'scene', cmd: 'clear' })
  expect(scenes.activeId).toBeNull()
  scenes.activate('missing')
  expect(scenes.activeId).toBeNull()
})
it('keeps register choices on project refresh and ignores a queued scene removed before activation', () => {
  const project = liveProject('Scenes'),
    pending: (() => void)[] = []
  project.scenes = [{ id: 'a', name: 'A', color: '#ff0000', registers: [true] }]
  const scenes = new Scenes({
    queue(_at, run) {
      pending.push(run)
      return 1
    },
    changed() {},
    context: () => ({ bar: 1, playing: false }),
  })
  scenes.configure(project)
  scenes.register({ type: 'register', cmd: 'set', index: 4, on: true }, 'ui')
  scenes.configure({ ...project, name: 'Renamed' })
  expect(scenes.registers.values[4]).toBe(true)
  scenes.activate('a', 'bar')
  scenes.configure({ ...project, scenes: [] })
  pending.shift()!()
  expect(scenes.activeId).toBeNull()
  scenes.reset()
  expect(scenes.registers.values.every((on) => !on)).toBe(true)
})
it('changes a conditional split while held notes finish on their original instrument', async () => {
  const { Router } = await import('../../src/engine/router/router')
  const { InstrumentRack } = await import('../../src/engine/synth/rack')
  const { FakeBackend } = await import('./fake-backend')
  const project = liveProject('Performance')
  project.instruments.push({
    ...project.instruments[0],
    id: 'horn',
    program: 60,
  })
  project.scenes = [
    {
      id: 'reprise',
      name: 'Reprise',
      color: '#ff0000',
      registers: [true, null, null, null, null, null, null, null],
      zones: [{ ...project.base.zones[0], lo: 36, hi: 84 }],
      patch: [
        {
          id: 'horn',
          trackId: 'piano',
          instrumentId: 'horn',
          when: { reg: 0, on: true },
          transpose: -12,
        },
      ],
    },
  ]
  const backend = new FakeBackend(),
    rack = new InstrumentRack(
      backend,
      async () => undefined,
      () => undefined,
    )
  await rack.synchronize(project)
  const router = new Router(rack, () => undefined)
  const scenes = new Scenes({
    queue(_at, run) {
      run()
      return 0
    },
    changed() {
      router.setProject(scenes.effectiveProject()!)
    },
    context: () => ({ bar: 33, playing: true }),
  })
  scenes.configure(project)
  router.setProject(scenes.effectiveProject()!)
  router.cc('keys', 0, 64, 127)
  router.note('keys', 0, 60, 100, true)
  const oldSlot = rack.get('piano')!.slot
  scenes.activate('reprise')
  expect(backend.events.filter((e) => e.type === 'off')).toHaveLength(0)
  expect(backend.events).toContainEqual({
    type: 'cc',
    slot: oldSlot,
    cc: 64,
    value: 0,
  })
  router.note('keys', 0, 64, 90, true)
  expect(backend.events.filter((e) => e.type === 'on').at(-1)).toMatchObject({
    slot: rack.get('horn')!.slot,
    key: 52,
  })
  router.note('keys', 0, 60, 0, false)
  expect(backend.events.filter((e) => e.type === 'off').at(-1)).toEqual({
    type: 'off',
    slot: oldSlot,
    key: 60,
  })
  expect(rack.get('piano')!.refs).toBe(0)
  router.note('keys', 0, 64, 0, false)
  router.cc('keys', 0, 64, 0)
  expect(rack.get('horn')!.refs).toBe(0)
  router.close()
  rack.close()
})
it('keeps runtime track modes across mixer refreshes, then clears them on a scene activation or explicit mode edit', () => {
  const project = liveProject('Modes')
  project.scenes = [{ id: 'a', name: 'A', color: '#4cc2ff' }]
  const scenes = new Scenes({
    queue(_at, run) {
      run()
      return 0
    },
    changed() {},
    context: () => ({ bar: 1, playing: false }),
  })
  scenes.configure(project)
  scenes.mode({ type: 'trackMode', trackId: 'piano', mode: 'auto' })
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('auto')
  expect(project.tracks[0].mode).toBe('live')
  scenes.configure({ ...project, name: 'Renamed' })
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('auto')
  scenes.activate('a')
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('live')
  scenes.mode({ type: 'trackMode', trackId: 'piano', mode: 'cycle' })
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('mute')
  scenes.configure({
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, mode: 'auto' })),
  })
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('auto')
})
it('keeps script routing transient and clears it on scene activation or reload', () => {
  const project = liveProject('Script rig')
  project.scenes.push({ id: 'reprise', name: 'Reprise', color: '#4cc2ff' })
  const scenes = new Scenes({
    queue: (_at, run) => {
      run()
      return 0
    },
    changed: () => undefined,
    context: () => ({ playing: false, bar: 1 }),
  })
  scenes.configure(project)
  scenes.setZones([])
  scenes.setPatch('piano', [])
  scenes.setScriptMode('piano', 'auto')
  scenes.setFollow('waitNotes')
  expect(scenes.effectiveProject()!.base.zones).toEqual([])
  expect(scenes.effectiveProject()!.base.patch).toEqual([])
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('auto')
  expect(scenes.effectiveProject()!.follow.mode).toBe('waitNotes')
  expect(project.tracks[0].mode).toBe('live')
  scenes.activate('reprise')
  expect(scenes.effectiveProject()!.base.patch).toEqual(project.base.patch)
  expect(scenes.effectiveProject()!.tracks[0].mode).toBe('live')
  expect(scenes.effectiveProject()!.follow.mode).toBe('written')
})
it('gives script patch overrides valid, unique IDs when captured into a saved scene', async () => {
  const { projectSchema } = await import('../../src/shared/schema')
  const project = liveProject('Capture script')
  project.tracks.push({ ...project.tracks[0], id: 'upper' })
  project.base.patch.push({
    id: 'script-piano-piano',
    trackId: 'upper',
    instrumentId: 'piano',
  })
  const scenes = new Scenes({
    queue: (_at, run) => {
      run()
      return 0
    },
    changed: () => undefined,
    context: () => ({ playing: false, bar: 1 }),
  })
  scenes.configure(project)
  scenes.setPatch('piano', ['piano'])
  const setup = scenes.setup([], false)!
  expect(new Set(setup.patch.map((p) => p.id)).size).toBe(setup.patch.length)
  project.scenes.push({
    ...setup,
    id: 'captured',
    name: 'Captured',
    color: '#4cc2ff',
  })
  expect(() => projectSchema.parse(project)).not.toThrow()
})
it('restores an action-selected follow mode after script overrides clear', () => {
  const project = liveProject('Follow ownership')
  const scenes = new Scenes({
    queue: (_at, run) => {
      run()
      return 0
    },
    changed: () => undefined,
    context: () => ({ playing: false, bar: 1 }),
  })
  scenes.configure(project)
  scenes.setFollow('waitNotes', 'action')
  scenes.setFollow('written')
  expect(scenes.effectiveProject()!.follow.mode).toBe('written')
  scenes.clearScript()
  expect(scenes.effectiveProject()!.follow.mode).toBe('waitNotes')
  const saved = structuredClone(project)
  saved.follow.mode = 'tempoTrack'
  scenes.configure(saved)
  expect(scenes.effectiveProject()!.follow.mode).toBe('tempoTrack')
})
