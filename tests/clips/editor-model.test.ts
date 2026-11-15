import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { newProject } from '../../src/shared/defaults'
import type { AudioTrack, ControlDef } from '../../src/shared/model'
import { fromFiles, toFiles } from '../../src/shared/project-files'
import { effectiveSetup, isUnbound } from '../../src/shared/overlay'
import {
  clipBindings,
  bindClip,
  clipFromLoop,
  deleteClip,
  newClip,
  snapClipBar,
} from '../../src/ui/clips/model'
import { zeroCrossing } from '../../src/engine/clips/zero-crossing'
import { clip } from './fixture'
it('round trips complete clip definitions and hand edits through clips.yaml', () => {
  const project = newProject(),
    definition = clip('break', {
      file: 'audio/break.m4a',
      group: 'breaks',
      pressureToGain: true,
    })
  project.clips = [definition]
  const files = toFiles(project),
    yaml = parse(String(files['clips.yaml']))
  expect(fromFiles(files).clips).toEqual(project.clips)
  expect(yaml.clips).toEqual([definition])
  yaml.clips[0].sweep.mode = 'position'
  yaml.clips[0].startSec = 1.5
  files['clips.yaml'] = stringify(yaml)
  expect(fromFiles(files).clips[0]).toMatchObject({
    startSec: 1.5,
    sweep: { mode: 'position' },
  })
  yaml.clips[0].endSec = 1
  files['clips.yaml'] = stringify(yaml)
  expect(() => fromFiles(files)).toThrow(/clips.yaml/)
})
it('creates a synced fragment from the selected loop using its audio offset and written time map', () => {
  const project = newProject(),
    track = {
      kind: 'audio',
      name: 'Reference',
      file: 'audio/ref.wav',
      durationSec: 10,
      offsetSec: 1,
    } as AudioTrack
  project.tempos = [{ tick: 0, bpm: 120 }]
  project.loop = { enabled: true, startTick: 0, endTick: 3840 }
  expect(clipFromLoop(project, track)).toMatchObject({
    startSec: 0,
    endSec: 3,
    beats: 6,
    sync: true,
    quantize: 'bar',
  })
  project.loop.enabled = false
  expect(() => clipFromLoop(project, track)).toThrow(/overlap/)
  project.clips = [newClip(project, track.file, 10)]
  expect(newClip(project, track.file, 10).id).not.toBe(project.clips[0].id)
})
it('uses a bar grid only with an explicit beat map for that audio file', () => {
  const project = newProject(),
    track = { kind: 'audio', file: 'audio/ref.wav', offsetSec: 0 } as AudioTrack
  project.tracks = [track]
  expect(snapClipBar(project, track.file, 1.9)).toBe(null)
  project.beatAnchors = [
    { tick: 0, sec: 0 },
    { tick: 1920, sec: 2 },
  ]
  expect(snapClipBar(project, track.file, 1.9)).toBe(2)
  expect(snapClipBar(project, 'audio/another.wav', 1.9)).toBe(null)
})
it('binds pads to launch and continuous controls to sweep in the chosen layer; deletion masks inherited references', () => {
  const project = newProject(),
    scope = { kind: 'controller', profileId: 'keylab', sceneId: null } as const
  project.clips = [clip()]
  bindClip(project, { ...scope, kind: 'shared' }, 'loop', {
    id: 'pad.1',
    mode: 'momentary',
  } as ControlDef)
  bindClip(project, scope, 'loop', {
    id: 'knob.1',
    mode: 'relative64',
  } as ControlDef)
  project.scenes = [
    {
      id: 'scene',
      name: 'Scene',
      color: '#ffffff',
      bindings: [
        {
          control: 'pad.2',
          edge: 'press',
          action: { type: 'clip', cmd: 'stop', clipId: 'loop' },
        },
      ],
    },
  ]
  project.cues = [
    {
      id: 'cue',
      name: 'Cue',
      tick: 0,
      trigger: 'auto',
      actions: [
        { type: 'clip', cmd: 'launch', clipId: 'loop' },
        { type: 'transport', cmd: 'play' },
      ],
    },
  ]
  expect(
    project.base.bindings.find((b) => b.control === 'pad.1'),
  ).toMatchObject({
    edge: 'press',
    action: { cmd: 'launch' },
  })
  expect(project.mappings.keylab.bindings[0]).toMatchObject({
    edge: 'change',
    action: { cmd: 'sweep' },
  })
  deleteClip(project, 'loop')
  expect(project.clips).toEqual([])
  expect(
    effectiveSetup(project, 'scene', ['keylab'])
      .bindings.filter((b) => ['pad.1', 'pad.2', 'knob.1'].includes(b.control))
      .every(isUnbound),
  ).toBe(true)
  expect(project.cues[0].actions).toEqual([{ type: 'transport', cmd: 'play' }])
})
it('snaps within five milliseconds and leaves a range with no crossing alone', () => {
  const samples = new Float32Array(100).fill(0.8)
  samples.fill(-0.8, 50)
  expect(zeroCrossing([samples], 1000, 0.048)).toBe(0.05)
  expect(zeroCrossing([samples], 1000, 0.02)).toBe(0.02)
  expect(zeroCrossing([samples], 1000, -1)).toBe(0)
  expect(zeroCrossing([samples], 1000, 1)).toBe(0.099)
})

it('reports effective controller bindings without listing a shadowed shared assignment', () => {
  const project = newProject()
  project.clips = [clip('a'), clip('b')]
  bindClip(project, { kind: 'shared', profileId: '', sceneId: null }, 'a', {
    id: 'pad.1',
    mode: 'momentary',
  } as ControlDef)
  bindClip(
    project,
    { kind: 'controller', profileId: 'keylab', sceneId: null },
    'b',
    { id: 'pad.1', mode: 'momentary' } as ControlDef,
  )
  expect(clipBindings(project, 'a', null, ['keylab'])).toEqual([])
  expect(clipBindings(project, 'b', null, ['keylab'])).toEqual([
    'Pad 1 (launch)',
  ])
})
