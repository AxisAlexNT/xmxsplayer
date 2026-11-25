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

it('resolves dropped orchestra, registered section and instrument to persistent pad actions', async () => {
  const { padAction } = await import('../../src/ui/bindings/pad-drop')
  const { liveProject } = await import('../../src/shared/template')
  const p = liveProject('Pad assignment')
  p.orchestras = [{id:'ensemble',name:'Ensemble',color:'#112233',maxLayers:1,outOfRange:'nearest',
    sections:[{name:'Strings',register:2,startOn:true,members:[]},{name:'Solo',register:null,startOn:true,members:[]}]}]
  const sources = ['orchestra:ensemble','section:ensemble:0','instrument:piano']
  sources.forEach((source,i) => writeBinding(p,{kind:'controller',profileId:'generic',sceneId:null},
    {control:'pad.'+(i+1),edge:'press',action:padAction(p,source)}))
  expect(fromFiles(toFiles(p)).mappings.generic.bindings.map(b => b.action)).toEqual([
    {type:'orchestra',cmd:'select',orchestraId:'ensemble'}, {type:'register',cmd:'toggle',index:2},
    {type:'note',instrumentId:'piano',key:60,velocity:'control'},
  ])
  p.instruments[0].isDrum = true
  expect(padAction(p,'instrument:piano')).toMatchObject({key:36})
  expect(() => padAction(p,'section:ensemble:1')).toThrow()
  expect(() => padAction(p,'instrument:missing')).toThrow()
})
