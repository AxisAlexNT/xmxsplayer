import { expect, it } from 'vitest'
import { InstrumentRack } from '../../src/engine/synth/rack'
import { liveProject } from '../../src/shared/template'
import { FakeBackend } from './fake-backend'

it('keeps a leased old patch alive across program and soundfont changes', async () => {
  const backend = new FakeBackend()
  const rack = new InstrumentRack(
    backend,
    async () => undefined,
    () => undefined,
  )
  const project = liveProject('Performance')
  await rack.synchronize(project)
  const old = rack.acquire('piano')!
  const next = structuredClone(project)
  next.instruments[0].program = 48
  await rack.synchronize(next)
  expect(rack.get('piano')!.slot).not.toBe(old.slot)
  expect(backend.events).not.toContainEqual({ type: 'release', slot: old.slot })
  rack.release(old)
  expect(backend.events).toContainEqual({ type: 'release', slot: old.slot })
  const before = rack.get('piano')!
  next.soundfonts[0].file = 'Other.sf2'
  await rack.synchronize(next)
  expect(rack.get('piano')!.slot).not.toBe(before.slot)
  rack.close()
})
it('configures the existing slot for volume changes and releases removed instruments', async () => {
  const backend = new FakeBackend()
  const rack = new InstrumentRack(
    backend,
    async () => undefined,
    () => undefined,
  )
  const project = liveProject('Performance')
  await rack.synchronize(project)
  const slot = rack.get('piano')!.slot
  project.instruments[0].volume = 0.2
  await rack.synchronize(project)
  expect(rack.get('piano')!.slot).toBe(slot)
  project.instruments = []
  await rack.synchronize(project)
  expect(rack.get('piano')).toBeUndefined()
  expect(backend.events).toContainEqual({ type: 'release', slot })
})
