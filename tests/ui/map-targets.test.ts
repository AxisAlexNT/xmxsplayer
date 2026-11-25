import { expect, it } from 'vitest'
import { liveProject } from '../../src/shared/template'
import { unbound } from '../../src/shared/overlay'
import { mappedBindings, mapBinding } from '../../src/ui/bindings/map-targets'
it('matches physical control kinds and resolves badges from effective scene and device mappings', () => {
  const p = liveProject('Mapping')
  const target = {
    type: 'param',
    target: 'track.volume',
    id: 'piano',
    min: 0,
    max: 1,
  } as const
  expect(mapBinding(target, 'pad.1', 'press')).toBeUndefined()
  const move = mapBinding(target, 'fader.1', 'change')!
  p.base.bindings = [move]
  p.scenes = [
    {
      id: 'solo',
      name: 'Solo',
      color: '#123456',
      bindings: [unbound('fader.1', 'change')],
    },
  ]
  p.mappings.generic = {
    bindings: [],
    padColors: {},
    scenes: {
      solo: { bindings: [{ ...move, control: 'knob.1' }], padColors: {} },
    },
  }
  expect(
    mappedBindings(p, null, 'generic', target).map((b) => b.control),
  ).toEqual(['fader.1'])
  expect(
    mappedBindings(p, 'solo', 'generic', target).map((b) => b.control),
  ).toEqual(['knob.1'])
  const clip = { type: 'clip', cmd: 'launch', clipId: 'hit' } as const
  expect(mapBinding(clip, 'knob.2', 'change')?.action).toEqual({
    ...clip,
    cmd: 'sweep',
  })
  expect(mapBinding(clip, 'pad.3', 'press')?.action).toEqual(clip)
})
