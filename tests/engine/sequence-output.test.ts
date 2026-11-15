import { expect, it } from 'vitest'
import { liveProject } from '../../src/shared/template'
import { SequenceOutput } from '../../src/engine/transport/sequence-output'
import type { ScheduledNote } from '../../src/engine/transport/scheduler'
import { FakeBackend } from './fake-backend'
it('isolates tracks, chases controllers and preserves only started voices when retiming', async () => {
  const project = liveProject('Sequence')
  const track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  project.tracks.push({ ...track, id: 'second', volume: 0.5, notes: [] })
  project.base.patch.push({
    id: 'second',
    trackId: 'second',
    instrumentId: 'piano',
  })
  const backend = new FakeBackend()
  let now = 0
  const output = new SequenceOutput(
    backend,
    async () => undefined,
    () => now,
    () => undefined,
    () => undefined,
  )
  await output.synchronize(project)
  const descriptor = (id: string): ScheduledNote => ({
    id,
    track,
    note: [0, 960, 60, 100],
    start: 0,
    end: 960,
    cycle: 0,
  })
  output.noteOn(descriptor('started'), 0)
  output.noteOn(descriptor('future'), 1)
  output.noteOff(descriptor('started'), 2)
  now = 0.1
  output.reset(true)
  expect(output.hasNote('started')).toBe(true)
  expect(output.hasNote('future')).toBe(false)
  expect(backend.events.filter((e) => e.type === 'clear')).toHaveLength(2)
  expect(
    backend.events.filter((e) => e.type === 'cc' && e.cc === 120),
  ).toHaveLength(0)
  track.events = [
    { tick: 0, type: 'cc', num: 64, value: 127 },
    { tick: 480, type: 'cc', num: 1, value: 80 },
    { tick: 960, type: 'cc', num: 64, value: 0 },
  ]
  output.chase(track, 600, 0.1)
  expect(
    backend.events
      .slice()
      .reverse()
      .find((e) => e.type === 'cc' && e.cc === 64)?.value,
  ).toBe(127)
  output.boundary(0.5)
  now = 0.5
  output.collect(now)
  expect(output.hasNote('started')).toBe(false)
  output.reset(false)
  expect(
    backend.events.filter((e) => e.type === 'cc' && e.cc === 120),
  ).toHaveLength(2)
  output.close()
})
it('updates mixer controls without clearing or retriggering a held sequenced note', async () => {
  const p = liveProject('Mix'),
    track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  const backend = new FakeBackend(),
    output = new SequenceOutput(
      backend,
      async () => undefined,
      () => 0.1,
      () => undefined,
      () => undefined,
    )
  await output.synchronize(p)
  const note: ScheduledNote = {
    id: 'held',
    track,
    note: [0, 1920, 60, 100],
    start: 0,
    end: 1920,
    cycle: 0,
  }
  output.noteOn(note, 0)
  backend.events = []
  track.volume = 0.5
  p.instruments[0].reverb = 0.3
  await output.synchronize(p, true)
  expect(output.hasNote('held')).toBe(true)
  expect(backend.events.map((e) => e.type)).toEqual(['configure'])
  output.noteOff(note, 2)
  expect(backend.events.at(-1)).toMatchObject({ type: 'off', key: 60 })
  output.close()
})
it('prepares scene sounds and routes new notes while old sequenced notes finish on their original slot', async () => {
  const p = liveProject('Scenes'),
    track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  p.instruments.push({ ...p.instruments[0], id: 'horn', program: 60 })
  p.scenes = [
    {
      id: 'b',
      name: 'B',
      color: '#ff0000',
      patch: [{ id: 'new', trackId: track.id, instrumentId: 'horn' }],
    },
  ]
  const backend = new FakeBackend()
  let now = 0
  const output = new SequenceOutput(
    backend,
    async () => undefined,
    () => now,
    () => undefined,
    () => undefined,
  )
  await output.synchronize(p)
  const note = (id: string): ScheduledNote => ({
    id,
    track,
    note: [0, 960, 60, 100],
    start: 0,
    end: 960,
    cycle: 0,
  })
  output.noteOn(note('old'), 0)
  const oldSlot = backend.events.filter((e) => e.type === 'on').at(-1)!.slot
  backend.events = []
  output.reset(true)
  output.route(p.scenes[0].patch!)
  expect(
    backend.events.filter((e) => e.type === 'off' || e.type === 'release'),
  ).toHaveLength(0)
  output.noteOn(note('new'), 0.1)
  const newSlot = backend.events.filter((e) => e.type === 'on').at(-1)!.slot
  expect(newSlot).not.toBe(oldSlot)
  output.noteOff(note('old'), 1)
  expect(backend.events.at(-1)).toMatchObject({
    type: 'off',
    slot: oldSlot,
    key: 60,
  })
  now = 1
  output.collect(now)
  expect(output.hasNote('old')).toBe(false)
  expect(output.hasNote('new')).toBe(true)
  output.close()
})
it('evaluates patch conditions at the note tick and releases unreachable sustain on a register change', async () => {
  const p = liveProject('Gates'),
    track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  p.base.patch[0].when = { all: [{ reg: 0, on: true }, { bars: [2, 2] }] }
  const backend = new FakeBackend()
  let enabled = true
  const output = new SequenceOutput(
    backend,
    async () => undefined,
    () => 0,
    () => undefined,
    () => undefined,
    undefined,
    (tick) => ({
      registers: [enabled],
      activeSceneId: null,
      bar: tick >= 1920 ? 2 : 1,
      playing: true,
    }),
  )
  await output.synchronize(p)
  backend.events = []
  const note = (id: string, start: number): ScheduledNote => ({
    id,
    track,
    note: [start, 480, 60, 100],
    start,
    end: start + 480,
    cycle: 0,
  })
  output.noteOn(note('bar1', 0), 0)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(0)
  output.reconcile(1920)
  output.event(track, { tick: 1920, type: 'cc', num: 64, value: 127 }, 2)
  output.noteOn(note('bar2', 1920), 2)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(1)
  enabled = false
  output.route(p.base.patch, 1920)
  expect(backend.events.at(-1)).toMatchObject({ type: 'cc', cc: 64, value: 0 })
  output.noteOn(note('off', 1920), 2)
  expect(backend.events.filter((e) => e.type === 'on')).toHaveLength(1)
  output.close()
})
it('retains the old preset slot until its held note ends during a document routing refresh', async () => {
  const p = liveProject('Presets'),
    track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  const backend = new FakeBackend()
  let now = 0.1
  const output = new SequenceOutput(
    backend,
    async () => undefined,
    () => now,
    () => undefined,
    () => undefined,
  )
  await output.synchronize(p)
  const note: ScheduledNote = {
    id: 'held',
    track,
    note: [0, 960, 60, 100],
    start: 0,
    end: 960,
    cycle: 0,
  }
  output.noteOn(note, 0)
  const old = backend.events.filter((e) => e.type === 'on').at(-1)!.slot
  backend.events = []
  p.instruments[0].program = 60
  await output.synchronize(p, true)
  expect(
    backend.events.filter((e) => e.type === 'release' || e.type === 'off'),
  ).toHaveLength(0)
  output.noteOff(note, 1)
  expect(backend.events.at(-1)).toMatchObject({
    type: 'off',
    slot: old,
    key: 60,
  })
  now = 1
  output.collect(now)
  expect(backend.events.at(-1)).toEqual({ type: 'release', slot: old })
  output.close()
})
it('reports note activity at its scheduled time and keeps original routing identities after a scene switch', async () => {
  const p = liveProject('Activity'),
    track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  p.instruments.push({ ...p.instruments[0], id: 'horn', program: 60 })
  p.scenes = [
    {
      id: 'b',
      name: 'B',
      color: '#4cc2ff',
      patch: [{ id: 'horn', trackId: 'piano', instrumentId: 'horn' }],
    },
  ]
  const backend = new FakeBackend()
  let now = 0
  const output = new SequenceOutput(
    backend,
    async () => undefined,
    () => now,
    () => undefined,
    () => undefined,
  )
  await output.synchronize(p)
  const note: ScheduledNote = {
    id: 'held',
    track,
    note: [0, 1920, 60, 100],
    start: 0,
    end: 1920,
    cycle: 0,
  }
  output.noteOn(note, 1)
  expect(output.activity(0)).toEqual([])
  now = 1.1
  output.reset(true)
  output.route(p.scenes[0].patch!)
  expect(output.activity(now)).toContainEqual({
    sourceId: 'sequencer',
    trackId: 'piano',
    instrumentId: 'piano',
  })
  output.noteOff(note, 2)
  expect(output.activity(2)).toEqual([])
  output.close()
})
