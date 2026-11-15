import { expect, it } from 'vitest'
import { writeMidi, type MidiEvent } from 'midi-file'
import { importMidi } from '../../src/ui/sources/import-midi'
import { liveProject } from '../../src/shared/template'
import { projectSchema } from '../../src/shared/schema'
import { fromFiles, toFiles } from '../../src/shared/project-files'
function fixture(): Uint8Array {
  const conductor: MidiEvent[] = [
    {
      deltaTime: 0,
      type: 'setTempo',
      microsecondsPerBeat: 1000000,
      meta: true,
    },
    {
      deltaTime: 0,
      type: 'timeSignature',
      numerator: 3,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
      meta: true,
    },
    { deltaTime: 0, type: 'keySignature', key: 0, scale: 1, meta: true },
    { deltaTime: 0, type: 'endOfTrack', meta: true },
  ]
  const notes: MidiEvent[] = [
    { deltaTime: 0, type: 'trackName', text: 'Piano', meta: true },
    { deltaTime: 0, type: 'programChange', channel: 0, programNumber: 0 },
    {
      deltaTime: 0,
      type: 'controller',
      channel: 0,
      controllerType: 64,
      value: 127,
    },
    { deltaTime: 0, type: 'pitchBend', channel: 0, value: 4096 },
    { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 60, velocity: 100 },
    {
      deltaTime: 240,
      type: 'noteOff',
      channel: 0,
      noteNumber: 60,
      velocity: 0,
    },
    { deltaTime: 0, type: 'endOfTrack', meta: true },
  ]
  const drums: MidiEvent[] = [
    { deltaTime: 0, type: 'trackName', text: 'Drums', meta: true },
    { deltaTime: 0, type: 'noteOn', channel: 9, noteNumber: 36, velocity: 110 },
    {
      deltaTime: 120,
      type: 'noteOff',
      channel: 9,
      noteNumber: 36,
      velocity: 0,
    },
    { deltaTime: 0, type: 'endOfTrack', meta: true },
  ]
  return new Uint8Array(
    writeMidi({
      header: { format: 1, numTracks: 3, ticksPerBeat: 240 },
      tracks: [conductor, notes, drums],
    }),
  )
}
it('skips conductor-only tracks, rescales PPQ and imports maps, CC, bends, GM programs and unique slugs', () => {
  const project = importMidi(liveProject('Import'), fixture(), 'example.mid')
  expect(project.tracks.map((t) => t.id)).toEqual(['piano', 'piano-2', 'drums'])
  expect(project.tracks[1]).toMatchObject({
    kind: 'midi',
    mode: 'auto',
    notes: [[0, 480, 60, 100]],
    events: [
      { tick: 0, type: 'cc', num: 64, value: 127 },
      { tick: 0, type: 'bend', num: 0, value: 12288 },
    ],
  })
  expect(project.instruments.at(-1)).toMatchObject({ bank: 128, isDrum: true })
  expect(project.tempos).toEqual([{ tick: 0, bpm: 60 }])
  expect(project.timeSigs).toEqual([{ tick: 0, num: 3, den: 4 }])
  expect(project.keySigs).toEqual([{ tick: 0, fifths: 0, minor: true }])
  projectSchema.parse(project)
  expect(fromFiles(toFiles(project))).toEqual(project)
})
it('keeps owned maps unchanged while adding unlinked MIDI tracks', () => {
  const project = liveProject('Import')
  project.mapOwner = 'score'
  const next = importMidi(project, fixture(), 'example.mid')
  expect(next.tempos).toEqual(project.tempos)
  expect(next.timeSigs).toEqual(project.timeSigs)
  expect(next.tracks.slice(1).every((t) => t.kind === 'midi' && !t.link)).toBe(
    true,
  )
})
