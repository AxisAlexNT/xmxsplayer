import { expect, it } from 'vitest'
import { matchesCondition } from '../../src/shared/conditions'
import { effectiveSetup, isUnbound, unbound } from '../../src/shared/overlay'
import { newProject } from '../../src/shared/defaults'
import type { Binding, ControllerMapping } from '../../src/shared/model'
const b = (cmd: 'play' | 'stop' | 'pause'): Binding => ({
  control: 'pad.1',
  edge: 'press',
  action: { type: 'transport', cmd },
})
const mapping = (bindings: Binding[]): ControllerMapping => ({
  bindings,
  padColors: {},
  scenes: {},
})
it('evaluates nested conditions, inclusive bar ranges, scene, playing and zero-based registers', () => {
  const context = {
    registers: [false, true],
    activeSceneId: 'verse',
    bar: 33,
    playing: true,
  }
  expect(
    matchesCondition(
      {
        all: [
          { reg: 1, on: true },
          { scene: 'verse' },
          { bars: [33, 40] },
          { playing: true },
          { not: { reg: 0, on: true } },
          { any: [{ bars: [1, 2] }, { scene: 'verse' }] },
        ],
      },
      context,
    ),
  ).toBe(true)
  expect(matchesCondition({ bars: [1, 32] }, context)).toBe(false)
  expect(matchesCondition({ any: [] }, context)).toBe(false)
  expect(matchesCondition({ all: [] }, context)).toBe(true)
  expect(matchesCondition(undefined, context)).toBe(true)
})
it('replaces zones and patches, merges keyed fields and resolves controller/scene precedence without mutation', () => {
  const p = newProject()
  p.base.bindings = [b('play')]
  p.base.padColors = { 'pad.1': '#111111' }
  p.scenes = [
    {
      id: 'verse',
      name: 'Verse',
      color: '#ffffff',
      zones: [],
      patch: [],
      bindings: [b('stop')],
      trackModes: { lead: 'live' },
    },
  ]
  p.mappings.a = mapping([b('pause')])
  p.mappings.a.padColors = { 'pad.2': '#222222' }
  p.mappings.a.scenes.verse = {
    bindings: [b('play')],
    padColors: { 'pad.1': '#333333' },
  }
  p.mappings.b = mapping([b('stop')])
  expect(effectiveSetup(p, 'verse', ['a']).bindings).toEqual([b('play')])
  expect(effectiveSetup(p, 'verse', ['b']).bindings).toEqual([b('stop')])
  const both = effectiveSetup(p, 'verse', ['a', 'b'])
  expect(both.bindings).toEqual([b('stop')])
  expect(both.padColors).toEqual({ 'pad.1': '#333333', 'pad.2': '#222222' })
  expect(both.trackModes).toEqual({ lead: 'live' })
  expect(p.base.bindings).toEqual([b('play')])
  expect(p.base.padColors).toEqual({ 'pad.1': '#111111' })
  p.mappings.b.bindings = [unbound('pad.1', 'press')]
  expect(isUnbound(effectiveSetup(p, null, ['b']).bindings[0])).toBe(true)
})
it('creates controller mappings in new projects from validated default files', () => {
  const p = newProject()
  expect(p.mappings['arturia-keylab-essential-mk3'].bindings[0]).toMatchObject({
    control: 'pad.9',
    action: { type: 'register', index: 0 },
  })
  expect(p.mappings['m-audio-axiom-61-mk2'].bindings[7]).toMatchObject({
    control: 'button.8',
    action: { index: 7 },
  })
  expect(
    p.base.bindings.find((b) => b.control === 'fader.9')?.action,
  ).toMatchObject({ target: 'masterVolume' })
  const another = newProject()
  p.mappings['arturia-keylab-essential-mk3'].bindings = []
  expect(
    another.mappings['arturia-keylab-essential-mk3'].bindings,
  ).toHaveLength(8)
})
