import { expect, it } from 'vitest'
import { liveProject } from '../../src/shared/template'
import { voiceNotes, staffSettings } from '../../src/ui/notation/voicing'

it('cuts a third overlapping line at its new onset without cutting the melody', () => {
  const project = liveProject('Voices')
  const track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  track.notes = [
    [0, 1440, 76, 100],
    [240, 960, 65, 80],
    [480, 240, 60, 70],
  ]
  const { staves, truncated } = voiceNotes(track, {
    ...staffSettings(track, project),
    mode: 'single',
  })
  expect(truncated).toBe(true)
  expect(staves[0][0][0].end).toBe(1440)
  expect(staves[0][1].map((n) => [n.tick, n.end])).toEqual([
    [240, 480],
    [480, 720],
  ])
})
it('follows the moving hand gap and honours a fixed split even when hands cross middle C', () => {
  const project = liveProject('Piano')
  const track = project.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  track.notes = [
    [0, 240, 56, 90],
    [0, 240, 68, 90],
    [240, 240, 61, 90],
    [240, 240, 72, 90],
  ]
  const settings = staffSettings(track, project)
  expect(
    voiceNotes(track, settings).staves[1][0].map((g) => g.notes[0][2]),
  ).toEqual([56, 61])
  expect(
    voiceNotes(track, { ...settings, split: 60 }).staves[1][0].map(
      (g) => g.notes[0][2],
    ),
  ).toEqual([56])
})
