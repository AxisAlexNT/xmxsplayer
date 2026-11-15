import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'
import {
  TapTempo,
  applyBeatMap,
  snapLoop,
  fitAudioLength,
} from '../../src/shared/beat-grid'
import { defaultBindings } from '../../src/shared/default-bindings'
import { newProject } from '../../src/shared/defaults'
import { importedAudio } from '../../src/ui/sources/import-audio'
import { fromFiles, toFiles } from '../../src/shared/project-files'
import { TimeMap } from '../../src/shared/time-map'
it('averages the last four to eight taps and resets after a pause', () => {
  const tap = new TapTempo()
  expect(tap.tap(0)).toBeNull()
  expect(tap.tap(0.5)).toBeNull()
  expect(tap.tap(1)).toBeNull()
  expect(tap.tap(1.5)).toBe(120)
  for (let i = 2; i <= 10; i++) tap.tap(i * 0.5)
  expect(tap.tap(5.5)).toBe(120)
  expect(tap.tap(10)).toBeNull()
})
it('aligns rubato anchors to audio time, preserves the current sample and back-converts every anchor', () => {
  const p = newProject(),
    track = importedAudio(p, 'audio/reference.flac', 60).track
  p.tracks = [track]
  track.offsetSec = 2
  const anchors = [
    { tick: 0, sec: 10 },
    { tick: 480, sec: 10.5 },
    { tick: 960, sec: 11.3 },
    { tick: 1440, sec: 12.4 },
  ]
  const applied = applyBeatMap(p, track.id, anchors, 14),
    next = { ...p, ...applied.patch },
    map = new TimeMap(next),
    audio = next.tracks[0]
  if (audio.kind !== 'audio') throw Error('Expected audio')
  expect(audio.offsetSec).toBe(-10)
  for (const anchor of anchors) {
    expect(map.tickToSec(anchor.tick) - audio.offsetSec).toBeCloseTo(anchor.sec)
    expect(map.secToTick(anchor.sec + audio.offsetSec)).toBeCloseTo(anchor.tick)
  }
  expect(map.tickToSec(applied.tick) - audio.offsetSec).toBeCloseTo(12)
  expect(() =>
    applyBeatMap({ ...p, mapOwner: 'score' }, track.id, anchors, 14),
  ).toThrow('owns')
})
it('snaps the loop outward to bars and ships consistent speed/scrub bindings', async () => {
  const map = new TimeMap(newProject())
  expect(
    snapLoop(map, { enabled: true, startTick: 240, endTick: 2200 }),
  ).toEqual({ enabled: true, startTick: 0, endTick: 3840 })
  expect(
    snapLoop(map, { enabled: true, startTick: 1920, endTick: 3840 }),
  ).toEqual({ enabled: true, startTick: 1920, endTick: 3840 })
  const yaml = parse(await readFile('resources/defaults/bindings.yaml', 'utf8'))
  expect(yaml.bindings).toEqual(defaultBindings)
})

it('keeps the entire reference audible when the editable tempo increases', () => {
  const p = newProject()
  p.tracks = [importedAudio(p, 'audio/dance.wav', 60).track]
  p.lengthTicks = 57600
  p.tempos = [{ tick: 0, bpm: 128 }]
  expect(fitAudioLength(p)).toBe(61440)
  const map = new TimeMap({ ...p, lengthTicks: fitAudioLength(p) })
  expect(map.tickToSec(61440)).toBe(60)
})

it('rejects malformed hand-edited beat maps before they reach the timeline', () => {
  const files = toFiles(newProject()),
    meta = parse(files['project.yaml'] as string)
  meta.beatAnchors = [
    { tick: 0, sec: 1 },
    { tick: 480, sec: 0.5 },
  ]
  files['project.yaml'] = stringify(meta)
  expect(() => fromFiles(files)).toThrow(/project.yaml:.*beatAnchors.1.sec/)
  meta.beatAnchors = [
    { tick: 0, sec: 1 },
    { tick: 0, sec: 2 },
  ]
  files['project.yaml'] = stringify(meta)
  expect(() => fromFiles(files)).toThrow('must advance')
})
