import { expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import { effectiveSetup, unbound } from '../../src/shared/overlay'
import {
  writeBinding,
  writePadColor,
  type BindingScope,
} from '../../src/ui/bindings/edit'
import { fromFiles, toFiles } from '../../src/shared/project-files'
it('stores shared, controller, scene and controller-in-scene bindings independently and persists them', () => {
  const p = newProject(),
    base: BindingScope = {
      kind: 'shared',
      profileId: 'generic',
      sceneId: 'verse',
    },
    binding = unbound('pad.2', 'press')
  p.scenes = [{ id: 'verse', name: 'Verse', color: '#4cc2ff' }]
  writeBinding(p, base, {
    ...binding,
    when: undefined,
    action: { type: 'transport', cmd: 'play' },
  })
  writeBinding(
    p,
    { ...base, kind: 'controller' },
    { ...binding, when: undefined, action: { type: 'transport', cmd: 'stop' } },
  )
  writeBinding(
    p,
    { ...base, kind: 'scene' },
    {
      ...binding,
      when: undefined,
      action: { type: 'transport', cmd: 'pause' },
    },
  )
  writeBinding(
    p,
    { ...base, kind: 'controller', controllerScene: true },
    { ...binding, when: undefined, action: { type: 'app', cmd: 'save' } },
  )
  writePadColor(
    p,
    { ...base, kind: 'controller', controllerScene: true },
    'pad.2',
    '#ff9f43',
  )
  const reloaded = fromFiles(toFiles(p)),
    find = (scene: string | null, ids: string[]) =>
      effectiveSetup(reloaded, scene, ids).bindings.find(
        (b) => b.control === 'pad.2',
      )?.action
  expect(find(null, [])).toEqual({ type: 'transport', cmd: 'play' })
  expect(find(null, ['generic'])).toEqual({ type: 'transport', cmd: 'stop' })
  expect(find('verse', [])).toEqual({ type: 'transport', cmd: 'pause' })
  expect(find('verse', ['generic'])).toEqual({ type: 'app', cmd: 'save' })
  expect(
    effectiveSetup(reloaded, 'verse', ['generic']).padColors['pad.2'],
  ).toBe('#ff9f43')
  expect(() =>
    writeBinding(p, { ...base, kind: 'scene', sceneId: null }, binding),
  ).toThrow('Choose a scene')
})
