import { describe, expect, it } from 'vitest'
import { mergeNotation, musicXmlGrid } from '../../src/ui/notation/merge-score'
import {
  children,
  descendants,
  parseXml,
  text,
} from '../../src/ui/notation/xml'
import { newProject } from '../../src/shared/defaults'
import type { MidiTrack } from '../../src/shared/model'
const attrs =
  '<attributes><divisions>480</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
const note = (staff = 1) =>
  `<note><pitch><step>C</step><octave>${staff === 1 ? 4 : 3}</octave></pitch><duration>1920</duration><voice>${staff}</voice><type>whole</type><staff>${staff}</staff></note>`
const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1">${attrs}<barline location="left"><repeat direction="forward"/></barline>${note()}<backup><duration>1920</duration></backup>${note(2)}</measure><measure number="2">${note()}<backup><duration>1920</duration></backup>${note(2)}<barline><repeat direction="backward"/></barline></measure></part></score-partwise>`
function fixture() {
  const p = newProject()
  p.mapOwner = 'score'
  p.sources = [
    {
      id: 'score',
      file: 'scores/score.mscz',
      kind: 'mscz',
      durationTicks: 7680,
    },
  ]
  p.lengthTicks = 7680
  p.tracks = [1, 2].map((staff): MidiTrack => ({
    id: `staff-${staff}`,
    kind: 'midi',
    name: `Piano (staff ${staff})`,
    color: '#4fc3ff',
    mode: 'auto',
    solo: false,
    volume: 1,
    pan: 0,
    height: 196,
    notes: [0, 1920, 3840, 5760].map((t) => [
      t,
      1920,
      staff === 1 ? 60 : 48,
      100,
    ]),
    events: [],
    view: 'staff',
    clef: 'auto',
    quantGrid: 120,
    armed: false,
    leads: false,
    link: {
      sourceId: 'score',
      key: `${staff - 1}:Piano (staff ${staff})`,
      state: 'synced',
    },
  }))
  return p
}
describe('notation merge', () => {
  it('splits grand staves in source order, unrolls repeats and preserves pitch and clefs', () => {
    const p = fixture(),
      merged = mergeNotation(p, xml),
      parts = children(parseXml(merged.musicxml).documentElement, 'part')
    expect(merged.warnings).toEqual([])
    expect(merged.staffTrackIds).toEqual(['staff-1', 'staff-2'])
    expect(parts.map((p) => children(p, 'measure').length)).toEqual([4, 4])
    expect(parts.map((p) => text(descendants(p, 'clef')[0], 'sign'))).toEqual([
      'G',
      'F',
    ])
    expect(
      parts.map((p) => descendants(p, 'pitch').map((n) => text(n, 'octave'))),
    ).toEqual([
      ['4', '4', '4', '4'],
      ['3', '3', '3', '3'],
    ])
  })
  it('replaces only an ahead staff and pads generated parts to the shared measure grid', () => {
    const p = fixture(),
      t = p.tracks[0] as MidiTrack
    t.link!.state = 'ahead'
    t.notes = [[0, 480, 72, 100]]
    const local = {
      ...t,
      id: 'local',
      name: 'Local',
      link: undefined,
      notes: [[0, 480, 67, 100]] as MidiTrack['notes'],
    }
    p.tracks.push(local)
    const result = mergeNotation(p, xml),
      parts = children(parseXml(result.musicxml).documentElement, 'part')
    expect(parts).toHaveLength(3)
    expect(parts.map((p) => children(p, 'measure').length)).toEqual([4, 4, 4])
    expect(parts.map((p) => descendants(p, 'pitch').length)).toEqual([1, 4, 1])
    expect(text(descendants(parts[0], 'pitch')[0], 'octave')).toBe('5')
  })
  it('maps source staves correctly after display reordering', () => {
    const p = fixture()
    p.tracks.reverse()
    const result = mergeNotation(p, xml),
      parts = children(parseXml(result.musicxml).documentElement, 'part')
    expect(result.staffTrackIds).toEqual(['staff-2', 'staff-1'])
    expect(text(descendants(parts[0], 'clef')[0], 'sign')).toBe('F')
  })
  it('disables only mismatched source staves and reports the count problem', () => {
    const p = fixture()
    p.tracks.pop()
    const result = mergeNotation(p, xml)
    expect(result.excludedTrackIds).toEqual(['staff-1'])
    expect(result.warnings.join(' ')).toMatch(/staff count/)
    expect(result.staffTrackIds).toEqual([])
  })
  it('renders linked MIDI from generated notes and excludes other score sources and drums', () => {
    const p = fixture()
    p.sources[0].kind = 'mid'
    const midi = mergeNotation(p)
    expect(midi.staffTrackIds).toHaveLength(2)
    p.mapOwner = 'other'
    expect(mergeNotation(p).excludedTrackIds).toHaveLength(2)
  })
  it('respects an implicit pickup rather than padding it to a full bar', () => {
    const p = fixture(),
      pickup = xml
        .replace('<measure number="1">', '<measure number="0" implicit="yes">')
        .replaceAll('<duration>1920</duration>', '<duration>480</duration>')
    const grid = musicXmlGrid(pickup, p)
    expect(grid[0]).toMatchObject({ start: 0, end: 480, implicit: true })
    expect(grid[1]).toMatchObject({ start: 480, end: 2400 })
  })
})
