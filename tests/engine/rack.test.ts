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
it('changes the default backend while retaining leased destinations and honoring explicit overrides', async () => {
  const web = new FakeBackend(),
    fluid = new FakeBackend()
  let selected = web
  const loads: unknown[] = []
  const rack = new InstrumentRack(
    web,
    async (_font, target) => {
      loads.push(target)
    },
    () => undefined,
    false,
    (instrument) => (instrument.backend === 'web' ? web : selected),
  )
  const project = liveProject('Switch')
  await rack.synchronize(project)
  const held = rack.acquire('piano')!
  selected = fluid
  await rack.synchronize(project)
  expect(rack.get('piano')!.backend).toBe(fluid)
  expect(loads).toContain(fluid)
  expect(
    web.events.some(
      (event) => event.type === 'release' && event.slot === held.slot,
    ),
  ).toBe(false)
  rack.release(held)
  expect(
    web.events.some(
      (event) => event.type === 'release' && event.slot === held.slot,
    ),
  ).toBe(true)
  project.instruments[0].backend = 'web'
  await rack.synchronize(project)
  expect(rack.get('piano')!.backend).toBe(web)
  rack.panic()
  expect(web.events.at(-1)!.type).toBe('panic')
  rack.close()
  expect(web.events.at(-1)!.type).toBe('release')
})
