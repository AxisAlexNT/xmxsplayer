import type { Effect } from '../../src/shared/effects'
import { parameterValue, parameterPatch } from '../../src/shared/parameters'
import { expect, it } from 'vitest'
import {
  effectDefaults,
  effectTypes,
  effectParameters,
} from '../../src/shared/effects'
import { roomImpulse } from '../../src/engine/audio/effects/reverb'
import { liveProject } from '../../src/shared/template'
import { fromFiles, toFiles } from '../../src/shared/project-files'

it('round-trips a chain of all built-in effects and fills omitted parameter defaults', () => {
  const project = liveProject('Echo')
  project.masterEffects = effectTypes.map((type) => ({
    type,
    id: type,
    enabled: true,
    params: {},
  }))
  project.instruments[0].effects = [
    {
      id: 'echo',
      type: 'delay',
      params: { beats: 0.5 },
      enabled: false,
      preset: 'Short echo',
    },
  ]
  const restored = fromFiles(toFiles(project))
  expect(restored.masterEffects).toEqual(
    project.masterEffects.map((effect) => ({
      ...effect,
      params: effectDefaults(effect.type),
    })),
  )
  expect(restored.instruments[0].effects?.[0]).toMatchObject(
    project.instruments[0].effects[0],
  )
  project.masterEffects[0].params = { highpass: -1 }
  expect(() => toFiles(project)).toThrow()
})

it('builds repeatable decorrelated stereo room tails after the pre-delay', () => {
  const params = { ...effectDefaults('reverb'), size: 0.1, preDelay: 0.01 }
  const first = roomImpulse(8000, params)
  expect(first).toEqual(roomImpulse(8000, params))
  expect(first[0]).toHaveLength(880)
  expect(first[0].slice(0, 80).every((value) => value === 0)).toBe(true)
  expect(first[0].slice(80)).not.toEqual(first[1].slice(80))
  expect(Math.abs(first[0][879])).toBeLessThan(0.00001)
})

it('maps a controller to one instrument parameter while preserving a like-named master insert', () => {
  const project = liveProject('Bindings')
  const filter: Effect = {
    id: 'filter',
    type: 'filter',
    enabled: true,
    params: effectDefaults('filter'),
  }
  project.masterEffects = [filter]
  project.instruments[0].effects = [structuredClone(filter)]
  const action = {
    type: 'param',
    target: 'effect.param',
    id: 'instrument:piano',
    effectId: 'filter',
    param: 'mode',
    min: 0,
    max: 2,
  } as const
  const updated = { ...project, ...parameterPatch(project, action, 0.7) }
  expect(parameterValue(updated, action)).toBe(1)
  expect(updated.masterEffects?.[0].params.mode).toBe(0)
  expect(parameterValue(project, action)).toBe(0)
  project.base.bindings.push({ control: 'knob.1', edge: 'change', action })
  expect(
    fromFiles(toFiles(project)).base.bindings.at(-1)?.action,
  ).toMatchObject(action)
})

it.each(effectTypes)(
  'scales all %s controls to their specified endpoints',
  (type) => {
    const project = liveProject('Mapping')
    project.masterEffects = [
      { id: type, type, enabled: true, params: effectDefaults(type) },
    ]
    for (const [param, spec] of Object.entries(effectParameters[type])) {
      const action = {
        type: 'param',
        target: 'effect.param',
        id: 'master',
        effectId: type,
        param,
        min: spec.min,
        max: spec.max,
      } as const
      for (const unit of [0, 1]) {
        const updated = { ...project, ...parameterPatch(project, action, unit) }
        expect(parameterValue(updated, action)).toBeCloseTo(
          unit ? spec.max : spec.min,
          5,
        )
      }
    }
  },
)
