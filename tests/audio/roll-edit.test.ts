import { expect, it } from 'vitest'
import type { Note } from '../../src/shared/model'
import {
  createNote,
  moveNotes,
  resizeNotes,
  velocityNotes,
  deleteNotes,
  duplicateNotes,
  quantizeNotes,
  marquee,
  pressureVelocity,
} from '../../src/ui/lanes/roll-edit'
it('draws snapped notes with pressure velocity and keeps input immutable', () => {
  const old: Note[] = [[0, 120, 60, 100]],
    r = createNote(old, 189, 410, 64, pressureVelocity(0.25), 120)
  expect(r.selection).toEqual([[120, 360, 64, 32]])
  expect(old).toEqual([[0, 120, 60, 100]])
  expect(r.notes[0]).toBe(old[0])
})
it('moves a chord together within time and pitch bounds', () => {
  const notes: Note[] = [
      [120, 240, 1, 100],
      [240, 120, 126, 80],
    ],
    r = moveNotes(notes, notes, -480, 20, 120)
  expect(r.selection).toEqual([
    [0, 240, 2, 100],
    [120, 120, 127, 80],
  ])
  expect(notes[0][0]).toBe(120)
})
it('resizes either edge, adjusts velocity and deletes selected notes', () => {
  const notes: Note[] = [
    [240, 480, 60, 80],
    [960, 120, 64, 100],
  ]
  expect(resizeNotes(notes, [notes[0]], -120, 'start', 120).selection).toEqual([
    [120, 600, 60, 80],
  ])
  expect(
    resizeNotes(notes, [notes[0]], -1000, 'end', 120).selection[0][1],
  ).toBe(120)
  expect(velocityNotes(notes, [notes[0]], 100).selection[0][3]).toBe(127)
  expect(deleteNotes(notes, [notes[0]]).notes).toEqual([notes[1]])
})
it('duplicates after the selected phrase and quantizes both edges without zero durations', () => {
  const notes: Note[] = [
    [189, 90, 60, 100],
    [500, 20, 64, 80],
  ]
  expect(duplicateNotes(notes, notes, 120).selection).toEqual([
    [549, 90, 60, 100],
    [860, 20, 64, 80],
  ])
  expect(quantizeNotes(notes, notes, 120).notes).toEqual([
    [240, 120, 60, 100],
    [480, 120, 64, 80],
  ])
  expect(quantizeNotes(notes, notes, 0).notes[0]).toBe(notes[0])
})
it('selects an intersecting marquee and supports triplet and unsnapped movement', () => {
  const notes: Note[] = [
    [0, 480, 60, 100],
    [480, 120, 64, 100],
  ]
  expect(marquee(notes, 400, 200, 61, 59)).toEqual([notes[0]])
  expect(moveNotes(notes, [notes[0]], 82, 0, 80).notes[0][0]).toBe(80)
  expect(moveNotes(notes, [notes[0]], 17, 0, 0).notes[0][0]).toBe(17)
})
