import { expect, it } from 'vitest'
import { addEmptyOrchestra, addPreset, presets } from '../../src/shared/orchestra-presets'
import {
  layerBalance,
  pickLayers,
  sharedExternalMembers,
} from '../../src/shared/orchestra'
import { newProject } from '../../src/shared/defaults'
import { toFiles, fromFiles } from '../../src/shared/project-files'
it('creates independent custom orchestras sharing one playable track without a soundfont', () => {
  const p = newProject()
  const first = addEmptyOrchestra(p, 'My strings')
  const second = addEmptyOrchestra(p, 'My strings')
  expect(second).not.toBe(first)
  const restored = fromFiles(toFiles(p))
  expect(restored.orchestras?.map(o => o.id)).toEqual([first, second])
  expect(restored.tracks).toHaveLength(1)
  expect(restored.tracks[0]).toMatchObject({orchestraId: second})
  expect(restored.base.zones[0].trackIds).toEqual([restored.tracks[0].id])
  expect(restored.soundfonts).toHaveLength(0)
})
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

it('maps section level independently of member velocity and retains it across a save', async () => {
  const { parameterValue, parameterPatch } =
    await import('../../src/shared/parameters')
  const project = newProject()
  addPreset(project, 'symphonic', 'gm')
  const action = {
    type: 'param' as const,
    target: 'section.gain' as const,
    id: 'section:symphonic:0',
    min: 0,
    max: 1,
  }
  expect(parameterValue(project, action)).toBe(1)
  Object.assign(project, parameterPatch(project, action, 0.4))
  const restored = fromFiles(toFiles(project))
  const orchestra = restored.orchestras![0]
  const member = orchestra.sections[0].members[0]
  member.balance = 'velocity'
  member.gain = 0.5
  orchestra.maxLayers = 0
  const layers = pickLayers(orchestra, member.comfortLo, [
    true,
    false,
    false,
    false,
  ])
  const layer = layers.find((l) => l.instrumentId === member.instrumentId)!
  expect(layerBalance(layer, new Set())).toEqual({
    velocity: 0.5,
    expression: 0.4,
  })
  expect(layerBalance(layer, new Set([member.instrumentId]))).toEqual({
    velocity: 0.2,
    expression: undefined,
  })
  orchestra.sections[0].gain = 0
  expect(pickLayers(orchestra, 0, [true, false, false, false])).toEqual([])
})

it('applies orchestra controls to each member and scales exposed plugin parameters across preset switches', async () => {
  const { applyOrchestraControls, unsupportedMembers } =
    await import('../../src/shared/orchestra-controls')
  const { parameterPatch, parameterValue } =
    await import('../../src/shared/parameters')
  const p = newProject()
  addPreset(p, 'symphonic', 'gm')
  const orchestra = p.orchestras![0]
  const plugin = p.instruments[1]
  plugin.backend = 'plugin'
  plugin.plugin = {
    format: 'lv2',
    name: 'Synth',
    uri: 'urn:test',
    parameters: [
      {
        index: 3,
        name: 'Cutoff',
        min: 20,
        max: 20000,
        initial: 500,
        input: true,
      },
    ],
  }
  expect(unsupportedMembers(p, orchestra, 'reverb')).toContain(plugin)
  expect(unsupportedMembers(p, orchestra, 'brightness')).toHaveLength(0)
  const target = {
    type: 'param' as const,
    target: 'orchestra.brightness' as const,
    id: orchestra.id,
    min: 0,
    max: 1,
  }
  Object.assign(p, parameterPatch(p, target, 0.5))
  const restored = fromFiles(toFiles(p))
  expect(parameterValue(restored, target)).toBe(0.5)
  const other = {
    ...restored.orchestras![0],
    id: 'other',
    fx: { brightness: 1 },
  }
  restored.orchestras!.push(other)
  const mixed = applyOrchestraControls(restored)
  expect(
    mixed.instruments.find((i) => i.id === plugin.id)?.pluginParams?.[3],
  ).toBe(10010)
  expect(
    applyOrchestraControls(restored, {
      [restored.tracks[0].id]: 'other',
    }).instruments.find((i) => i.id === plugin.id)?.pluginParams?.[3],
  ).toBe(20000)
  for (const i of mixed.instruments.filter((i) => i.backend !== 'plugin'))
    expect(i.initCc?.[74]).toBe(64)
  expect(restored.instruments[0].initCc).toBeUndefined()
})
