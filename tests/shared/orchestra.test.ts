import { expect, it } from 'vitest'
import { addPreset, presets } from '../../src/shared/orchestra-presets'
import {
  layerBalance,
  pickLayers,
  sharedExternalMembers,
} from '../../src/shared/orchestra'
import { newProject } from '../../src/shared/defaults'
import { toFiles, fromFiles } from '../../src/shared/project-files'
it('saves all presets and reloads member ranges and the orchestra track', () => {
  const p = newProject()
  for (const id of Object.keys(presets)) addPreset(p, id, 'gm')
  expect(p.tracks).toHaveLength(1)
  const files = toFiles(p)
  expect(files['orchestras.yaml']).toBeTruthy()
  expect(fromFiles(files).orchestras).toEqual(p.orchestras)
})
it('ranks by comfort, limits layers, gates sections and folds by octaves', () => {
  const p = newProject()
  addPreset(p, 'symphonic', 'gm')
  const o = p.orchestras![0],
    regs = [true, true, true, true]
  expect(pickLayers(o, 60, regs)).toHaveLength(3)
  expect(pickLayers(o, 60, [])).toEqual([])
  o.maxLayers = 0
  expect(pickLayers(o, 60, regs).length).toBeGreaterThan(3)
  o.outOfRange = 'silent'
  expect(pickLayers(o, 10, regs)).toEqual([])
  o.outOfRange = 'nearest'
  const [folded] = pickLayers(o, 10, regs)
  expect(folded.key % 12).toBe(10)
  expect(folded.key).toBeGreaterThanOrEqual(24)
})

it('covers all MIDI keys in each factory section by default', () => {
  const p = newProject()
  for (const id of Object.keys(presets)) {
    addPreset(p, id, 'gm')
    const o = p.orchestras!.find((o) => o.id === id)!
    for (let section = 0; section < 4; section++)
      for (let key = 0; key < 128; key++) {
        const layers = pickLayers(
          o,
          key,
          [0, 1, 2, 3].map((i) => i === section),
        )
        expect(layers.length).toBeGreaterThan(0)
        expect(layers.every((l) => l.key % 12 === key % 12)).toBe(true)
      }
  }
})

it('splits member proportion between expression and velocity and isolates shared MIDI channels', () => {
  const member = { instrumentId: 'horn', gain: 0.25 }
  const independent = new Set<string>()
  expect(layerBalance(member, independent)).toEqual({
    velocity: 1,
    expression: 0.25,
  })
  expect(layerBalance({ ...member, balance: 'both' }, independent)).toEqual({
    velocity: 0.5,
    expression: 0.5,
  })
  expect(layerBalance({ ...member, balance: 'velocity' }, independent)).toEqual(
    { velocity: 0.25, expression: 1 },
  )
  const p = newProject()
  addPreset(p, 'symphonic', 'gm')
  const instrument = {
    ...p.instruments[0],
    backend: 'midi' as const,
    midiOut: { portName: 'module', channel: 2 },
  }
  const shared = sharedExternalMembers([
    { ...instrument, id: 'horn' },
    { ...instrument, id: 'strings' },
  ])
  expect(layerBalance(member, shared)).toEqual({
    velocity: 0.25,
    expression: undefined,
  })
})
