import { describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { parseMidi } from 'midi-file'
import { newProject } from '../../src/shared/defaults'
import { fromFiles, toFiles } from '../../src/shared/project-files'
import { keySchema, projectSchema } from '../../src/shared/schema'
import { slugify, uniqueId } from '../../src/shared/ids'
import type { MidiTrack } from '../../src/shared/model'

export function sampleTrack(): MidiTrack {
  return {
    id: 'piano-lh',
    name: 'Piano LH',
    color: '#b07cff',
    kind: 'midi',
    mode: 'live',
    solo: false,
    volume: 0.8,
    pan: 0,
    height: 196,
    notes: [
      [0, 480, 60, 100],
      [240, 120, 64, 80],
      [480, 240, 60, 90],
    ],
    events: [
      { tick: 0, type: 'cc', num: 64, value: 127 },
      { tick: 960, type: 'cc', num: 64, value: 0 },
      { tick: 300, type: 'bend', num: 0, value: 12345 },
    ],
    view: 'staff',
    clef: 'bass',
    quantGrid: 120,
    armed: false,
    leads: false,
  }
}
describe('project files', () => {
  it('round trips YAML, format-0 PPQ-480 MIDI, events and mappings', () => {
    const p = newProject('Étude')
    p.tracks.push(sampleTrack())
    p.base.zones.push({
      id: 'left-hand',
      lo: 36,
      hi: 59,
      trackIds: ['piano-lh'],
      transpose: 0,
      velocity: 'linear',
      color: '#b07cff',
    })
    p.mappings['generic'] = { bindings: [], padColors: {}, scenes: {} }
    p.script = '// Project notes\n'
    const files = toFiles(p)
    const midi = parseMidi(files['tracks/piano-lh.mid'] as Uint8Array)
    expect(midi.header).toMatchObject({
      format: 0,
      numTracks: 1,
      ticksPerBeat: 480,
    })
    expect(String(files['setup.yaml'])).toContain('lo: C2')
    expect(fromFiles(files)).toEqual({
      ...p,
      tracks: [
        {
          ...p.tracks[0],
          events: [...sampleTrack().events].sort((a, b) => a.tick - b.tick),
        },
      ],
    })
  })
  it('accepts note names and preserves linked notes on metadata reload', () => {
    const p = newProject()
    const track = sampleTrack()
    track.link = { sourceId: 'score', key: '1', state: 'synced' }
    p.tracks.push(track)
    const files = toFiles(p)
    expect(files['tracks/piano-lh.mid']).toBeUndefined()
    const reloaded = fromFiles(files, p).tracks[0] as MidiTrack
    expect(reloaded).toEqual(track)
    expect(reloaded.notes).toBe(track.notes)
    expect(reloaded.events).toBe(track.events)
    expect(keySchema.parse('Db4')).toBe(61)
    expect(keySchema.parse('C4')).toBe(60)
    expect(keySchema.safeParse('C10').success).toBe(false)
  })
  it('reports file and nested validation paths and keeps malformed MIDI out', () => {
    const files = toFiles(newProject())
    const setup = parse(files['setup.yaml'] as string)
    setup.base.zones = [
      {
        id: 'bad',
        lo: 'C10',
        hi: 70,
        trackIds: [],
        transpose: 0,
        velocity: 'linear',
        color: '#aaaaaa',
      },
    ]
    files['setup.yaml'] = stringify(setup)
    expect(() => fromFiles(files)).toThrow(/setup.yaml:.*base.zones.0.lo/)
    const p = newProject()
    p.tracks.push(sampleTrack())
    const midiFiles = toFiles(p)
    midiFiles['tracks/piano-lh.mid'] = new Uint8Array([1, 2, 3])
    expect(() => fromFiles(midiFiles)).toThrow(/tracks\/piano-lh.mid/)
  })
  it('rejects duplicate ids and unsafe relative paths', () => {
    const p = newProject()
    p.tracks = [sampleTrack(), sampleTrack()]
    expect(projectSchema.safeParse(p).success).toBe(false)
    p.tracks = []
    p.sources = [{ id: 'score', file: '../private.mscz', kind: 'mscz' }]
    expect(projectSchema.safeParse(p).success).toBe(false)
  })
  it('creates stable unique readable slugs', () => {
    expect(slugify('Étude — Piano LH')).toBe('etude-piano-lh')
    expect(uniqueId('Piano LH', ['piano-lh', 'piano-lh-2'])).toBe('piano-lh-3')
    expect(uniqueId('🎵', [])).toBe('item')
  })
})

it('round trips PDF page layout, follow markers and pane preferences', () => {
  const p = newProject()
  p.documents = [{ id:'score', name:'Score', file:'scores/pdf/Score.pdf', theme:'light', zoom:1.5,
    cols:2, scroll:150, follow:true, markers:[{bar:17, page:2, y:0.25}] }]
  p.view.pdf = { placement:'right', width:720, activeId:'score', sheetOnly:true }
  const reopened = fromFiles(toFiles(p))
  expect(reopened.documents).toEqual(p.documents)
  expect(reopened.view.pdf).toEqual(p.view.pdf)
})

it('defaults imported sheets to night mode and leaves legacy projects compatible', () => {
  const p = newProject()
  expect(fromFiles(toFiles(p)).documents).toBeUndefined()
  const sheet = {id:'score', name:'Score', file:'scores/pdf/Score.pdf'}
  const parsed = projectSchema.parse({...p, documents:[sheet], view:{...p.view, pdf:{}}})
  expect(parsed.documents?.[0]).toMatchObject({theme:'night', zoom:'fit', cols:1, scroll:0})
  expect(parsed.view.pdf).toMatchObject({placement:'lane', width:640})
  expect(projectSchema.safeParse({...p, documents:[sheet,sheet]}).success).toBe(false)
})

it('retains PDF controller assignments and timed page-turn cues on disk', () => {
  const p = newProject()
  p.base.bindings.push({control:'pad.1',edge:'press',action:{type:'pdf',cmd:'next'}})
  p.cues.push({id:'page-two',name:'Page two',trigger:'auto',tick:16*4*480,
    actions:[{type:'pdf',cmd:'scroll',documentId:'score',amount:300}]})
  const reopened = fromFiles(toFiles(p))
  expect(reopened.base.bindings).toEqual(p.base.bindings)
  expect(reopened.cues).toEqual(p.cues)
})

it('restores PDF lane height and order without generating a MIDI file', () => {
  const p = newProject()
  p.documents = [{id:'score',name:'Score',file:'scores/pdf/Score.pdf',theme:'night',zoom:'fit',cols:2,scroll:0}]
  p.tracks = [sampleTrack()]
  const migrated = fromFiles(toFiles(p))
  const lane = migrated.tracks[1]
  expect(lane).toMatchObject({kind:'pdf',documentId:'score',height:300})
  lane.height = 410
  migrated.tracks.reverse()
  const files = toFiles(migrated)
  expect(files['tracks/'+lane.id+'.mid']).toBeUndefined()
  expect(fromFiles(files).tracks[0]).toEqual(lane)
})
