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
    backend.events.slice().reverse().find((e) => e.type === 'cc' && e.cc === 64)?.value,
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
