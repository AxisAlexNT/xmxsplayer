import { describe, expect, it } from 'vitest'
import { writeMidi, parseMidi, type MidiEvent } from 'midi-file'
import { newProject } from '../../src/shared/defaults'
import { toFiles, fromFiles } from '../../src/shared/project-files'
import {
  mergeScore,
  parseScore,
  staffNames,
  detachSource,
  type ParsedScore,
} from '../../src/ui/sources/sync'
import { exportMidi } from '../../src/ui/sources/export-midi'
import type { MidiTrack, Source } from '../../src/shared/model'
const source: Source = { id: 'score', file: 'scores/score.mscz', kind: 'mscz' }
const score = (
  keys = ['0:Piano (staff 1)', '1:Piano (staff 2)'],
  pitch = 60,
): ParsedScore => ({
  maps: {
    tempos: [{ tick: 0, bpm: 80 }],
    timeSigs: [{ tick: 0, num: 3, den: 4 }],
    keySigs: [{ tick: 0, fifths: -2, minor: false }],
  },
  tracks: keys.map((key, i) => ({
    key,
    name: key.split(':')[1],
    notes: [[i * 480, 480, pitch + i, 100]],
    events: [],
    program: 0,
    drum: false,
  })),
})
function linked() {
  return mergeScore(newProject(), source, score()).project
}
describe('score sync', () => {
  it('derives staff names in part order', () => {
    expect(
      staffNames([
        { name: 'Piano', staves: 2 },
        { name: 'Flute', staves: 1 },
      ]),
    ).toEqual(['Piano (staff 1)', 'Piano (staff 2)', 'Flute'])
  })
  it('skips the conductor, preserves empty staves and scales ticks', () => {
    const end: MidiEvent = { deltaTime: 0, meta: true, type: 'endOfTrack' }
    const data = new Uint8Array(
      writeMidi({
        header: { format: 1, numTracks: 3, ticksPerBeat: 240 },
        tracks: [
          [
            {
              deltaTime: 0,
              meta: true,
              type: 'setTempo',
              microsecondsPerBeat: 750000,
            },
            end,
          ],
          [
            {
              deltaTime: 240,
              type: 'noteOn',
              channel: 0,
              noteNumber: 62,
              velocity: 90,
            },
            {
              deltaTime: 120,
              type: 'noteOff',
              channel: 0,
              noteNumber: 62,
              velocity: 0,
            },
            end,
          ],
          [end],
        ],
      }),
    )
    const parsed = parseScore({ midi: data }, source, [
      'Piano (staff 1)',
      'Piano (staff 2)',
    ])
    expect(parsed.tracks.map((t) => t.key)).toEqual([
      '0:Piano (staff 1)',
      '1:Piano (staff 2)',
    ])
    expect(parsed.tracks[0].notes).toEqual([[480, 240, 62, 90]])
    expect(parsed.tracks[1].notes).toEqual([])
    expect(parsed.maps.tempos[0].bpm).toBe(80)
    expect(() => parseScore({ midi: data }, source, ['Piano'])).toThrow(
      /cannot match/,
    )
  })
  it('replaces notes by key and keeps all track, patch, zone and instrument settings', () => {
    const p = linked(),
      t = p.tracks[0] as MidiTrack
    t.mode = 'live'
    t.volume = 0.4
    t.name = 'My right hand'
    t.leads = true
    p.base.zones = [
      {
        id: 'keys',
        lo: 40,
        hi: 80,
        trackIds: [t.id],
        transpose: 12,
        velocity: 'soft',
        color: t.color,
      },
    ]
    const merged = mergeScore(p, source, score(undefined, 65)).project
    expect(merged.tracks[0]).toMatchObject({ ...t, notes: [[0, 480, 65, 100]] })
    expect(merged.base).toEqual(p.base)
    expect(merged.instruments).toEqual(p.instruments)
    expect(merged.mapOwner).toBe('score')
  })
  it('protects ahead tracks, persists their MIDI, and permits an explicit discard', () => {
    const p = linked(),
      t = p.tracks[0] as MidiTrack
    t.notes = [[0, 120, 90, 120]]
    t.link!.state = 'ahead'
    const merged = mergeScore(p, source, score(undefined, 67))
    expect(merged.kept).toBe(1)
    expect(merged.project.tracks[0]).toEqual(t)
    expect(fromFiles(toFiles(merged.project)).tracks[0]).toEqual(t)
    const discarded = mergeScore(
      merged.project,
      source,
      score(undefined, 67),
      t.id,
    ).project.tracks[0] as MidiTrack
    expect(discarded.link!.state).toBe('synced')
    expect(discarded.notes[0][2]).toBe(67)
    expect(t.notes[0][2]).toBe(90)
  })
  it('appends new tracks, keeps vanished staves as persisted orphans and restores returning ones', () => {
    const p = linked(),
      t = p.tracks[0] as MidiTrack
    const merged = mergeScore(
      p,
      source,
      score(['1:Piano (staff 2)', '2:Flute']),
    )
    expect(merged.orphaned).toBe(1)
    expect(merged.project.tracks).toHaveLength(3)
    expect(
      (fromFiles(toFiles(merged.project)).tracks[0] as MidiTrack).notes,
    ).toEqual(t.notes)
    expect((merged.project.tracks[0] as MidiTrack).link!.orphaned).toBe(true)
    expect(
      (
        mergeScore(merged.project, source, score()).project
          .tracks[0] as MidiTrack
      ).link!.orphaned,
    ).toBeUndefined()
  })
  it('detaches without losing notes and releases map ownership', () => {
    const p = linked(),
      next = detachSource(p, source.id)
    expect(next.sources).toEqual([])
    expect(next.mapOwner).toBeNull()
    expect((next.tracks[0] as MidiTrack).link).toBeUndefined()
    expect(next.tracks.map((t) => (t.kind === 'midi' ? t.notes : []))).toEqual(
      p.tracks.map((t) => (t.kind === 'midi' ? t.notes : [])),
    )
  })
  it('takes maps only from the owner, while linked MIDI changes notes only', () => {
    const p = linked()
    p.tempos = [{ tick: 0, bpm: 100 }]
    expect(
      mergeScore(p, { ...source, id: 'second' }, score()).project.tempos,
    ).toEqual(p.tempos)
    const mid = mergeScore(
      newProject(),
      { ...source, kind: 'mid' },
      score(),
    ).project
    expect(mid.tempos).toEqual(newProject().tempos)
    expect(mid.mapOwner).toBe(source.id)
  })
  it('exports a selected track or only ahead/unlinked tracks, with all maps', () => {
    const p = linked()
    ;(p.tracks[0] as MidiTrack).link!.state = 'ahead'
    const parsed = parseMidi(exportMidi(p))
    expect(parsed.tracks).toHaveLength(2)
    expect(parsed.header.ticksPerBeat).toBe(480)
    expect(parsed.tracks[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'setTempo',
          microsecondsPerBeat: 750000,
        }),
        expect.objectContaining({
          type: 'timeSignature',
          numerator: 3,
          denominator: 4,
        }),
        expect.objectContaining({ type: 'keySignature', key: -2 }),
      ]),
    )
    expect(parseMidi(exportMidi(p, p.tracks[1].id)).tracks).toHaveLength(2)
    ;(p.tracks[0] as MidiTrack).link!.state = 'synced'
    expect(() => exportMidi(p)).toThrow(/No edited/)
  })
  it('exports derived tempo from tapped beat anchors when maps are editable', () => {
    const p = linked()
    p.mapOwner = null
    p.beatAnchors = [
      { tick: 0, sec: 0 },
      { tick: 480, sec: 1 },
    ]
    const midi = parseMidi(exportMidi(p, p.tracks[0].id))
    expect(midi.tracks[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'setTempo',
          microsecondsPerBeat: 1000000,
        }),
      ]),
    )
  })
})
