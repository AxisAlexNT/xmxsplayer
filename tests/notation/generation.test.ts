import { describe, expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import type { MidiTrack } from '../../src/shared/model'
import {
  notesToMusicXml,
  spelling,
} from '../../src/ui/notation/notes-to-musicxml'
import {
  child,
  children,
  descendants,
  parseXml,
  text,
} from '../../src/ui/notation/xml'
function fixture() {
  const p = newProject()
  p.lengthTicks = 3840
  const t: MidiTrack = {
    id: 'lead',
    name: 'A & B',
    kind: 'midi',
    color: '#4fc3ff',
    mode: 'live',
    solo: false,
    volume: 1,
    pan: 0,
    height: 196,
    notes: [],
    events: [],
    view: 'staff',
    clef: 'auto',
    quantGrid: 120,
    armed: false,
    leads: true,
  }
  p.tracks = [t]
  return { p, t }
}
describe('generated MusicXML', () => {
  it('writes clef, key, time, escaped names and complete rests', () => {
    const { p, t } = fixture()
    p.keySigs = [{ tick: 0, fifths: -3, minor: false }]
    const doc = parseXml(notesToMusicXml(t, p)),
      root = doc.documentElement
    expect(text(descendants(root, 'score-part')[0], 'part-name')).toBe('A & B')
    expect(text(descendants(root, 'clef')[0], 'sign')).toBe('G')
    expect(text(descendants(root, 'key')[0], 'fifths')).toBe('-3')
    expect(descendants(root, 'measure')).toHaveLength(2)
    expect(descendants(root, 'rest')).toHaveLength(2)
  })
  it('ties notes over barlines and splits non-binary durations', () => {
    const { p, t } = fixture()
    t.notes = [[1440, 960, 60, 100]]
    const doc = parseXml(notesToMusicXml(t, p)),
      notes = descendants(doc, 'note').filter((n) => child(n, 'pitch'))
    expect(notes.map((n) => Number(text(n, 'duration')))).toEqual([480, 480])
    expect(children(notes[0], 'tie')[0].getAttribute('type')).toBe('start')
    expect(children(notes[1], 'tie')[0].getAttribute('type')).toBe('stop')
    expect(descendants(doc, 'rest').length).toBeGreaterThan(0)
  })
  it('groups equal onset and duration as chords and preserves overlapping voices', () => {
    const { p, t } = fixture()
    t.notes = [
      [0, 960, 60, 100],
      [0, 960, 64, 100],
      [480, 480, 67, 100],
    ]
    const doc = parseXml(notesToMusicXml(t, p)),
      notes = descendants(doc, 'note').filter((n) => child(n, 'pitch'))
    expect(notes.map((n) => text(n, 'duration'))).toEqual(['960', '960', '480'])
    expect(children(notes[1], 'chord')).toHaveLength(1)
    expect(descendants(doc, 'tie')).toHaveLength(0)
  })
  it('quantizes and chooses the clef from the median pitch', () => {
    const { p, t } = fixture()
    t.notes = [
      [125, 235, 40, 80],
      [485, 241, 45, 90],
    ]
    const doc = parseXml(notesToMusicXml(t, p))
    expect(text(descendants(doc, 'clef')[0], 'sign')).toBe('F')
    expect(text(descendants(doc, 'note')[0], 'duration')).toBe('120')
    expect(text(descendants(doc, 'note')[1], 'duration')).toBe('240')
  })
  it('spells enharmonics by the current key, including C-flat and E-sharp', () => {
    expect(spelling(61, -4)).toEqual({ step: 'D', alter: -1, octave: 4 })
    expect(spelling(61, 3)).toEqual({ step: 'C', alter: 1, octave: 4 })
    expect(spelling(59, -7)).toEqual({ step: 'C', alter: -1, octave: 4 })
    expect(spelling(65, 6)).toEqual({ step: 'E', alter: 1, octave: 4 })
  })
  it('preserves triplet duration with time modification', () => {
    const { p, t } = fixture()
    t.quantGrid = 160
    t.notes = [
      [0, 160, 60, 100],
      [160, 160, 62, 100],
      [320, 160, 64, 100],
    ]
    const doc = parseXml(notesToMusicXml(t, p)),
      notes = descendants(doc, 'note').filter((n) => child(n, 'pitch'))
    expect(notes.map((n) => text(n, 'duration'))).toEqual(['160', '160', '160'])
    expect(
      notes.map((n) => text(child(n, 'time-modification')!, 'actual-notes')),
    ).toEqual(['3', '3', '3'])
  })
})

it('writes an arpeggio below a sustained melody, spread chords and pedal on the lower staff', () => {
  const { p, t } = fixture()
  t.name = 'Piano'
  t.notes = [
    [0, 960, 71, 90],
    [0, 240, 47, 80],
    [240, 240, 54, 80],
    [480, 240, 57, 80],
    [720, 240, 54, 80],
    [960, 480, 72, 90],
    [980, 460, 76, 80],
  ]
  t.events = [
    { tick: 0, type: 'cc', num: 64, value: 127 },
    { tick: 960, type: 'cc', num: 64, value: 0 },
  ]
  const doc = parseXml(notesToMusicXml(t, p))
  expect(text(descendants(doc, 'attributes')[0], 'staves')).toBe('2')
  const pitched = descendants(doc, 'note').filter((n) => child(n, 'pitch'))
  expect(pitched.filter((n) => text(n, 'staff') === '2')).toHaveLength(4)
  expect(text(pitched[0], 'duration')).toBe('960')
  expect(descendants(doc, 'chord')).toHaveLength(1)
  expect(descendants(doc, 'backup').length).toBeGreaterThan(0)
  expect(descendants(doc, 'direction').map((n) => text(n, 'staff'))).toEqual([
    '2',
    '2',
  ])
  expect(descendants(doc, 'pedal').map((n) => n.getAttribute('type'))).toEqual([
    'start',
    'stop',
  ])
})
