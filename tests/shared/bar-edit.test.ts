import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { newProject } from '../../src/shared/defaults'
import {
  appendBars,
  deleteBars,
  insertBars,
  setTempoFrom,
  setTimeSigFrom,
} from '../../src/shared/bar-edit'
import { useProjectStore } from '../../src/ui/stores/project'

describe('measure edits', () => {
  it('shifts maps, loop and cues across a signature boundary and round trips', () => {
    const project = newProject()
    project.lengthTicks = 12000
    project.timeSigs = [
      { tick: 0, num: 4, den: 4 },
      { tick: 3840, num: 3, den: 4 },
    ]
    project.loop = { enabled: true, startTick: 1920, endTick: 5280 }
    project.cues = [
      { id: 'cue', name: 'Cue', tick: 3840, actions: [], trigger: 'auto' },
    ]
    const inserted = insertBars(project, 2, 2)
    expect(inserted.cues[0].tick).toBe(7680)
    expect(inserted.loop.endTick).toBe(9120)
    expect(deleteBars(inserted, 2, 2)).toEqual(project)
    expect(setTimeSigFrom(project, 2, 3, 4).timeSigs.at(-1)?.tick).toBe(3360)
    expect(deleteBars(project, 2, 2).timeSigs.at(-1)?.tick).toBe(1920)
  })
  it('preserves notes spanning an insertion and trims them on deletion', () => {
    const p = newProject()
    p.tracks.push({
      kind: 'midi',
      id: 'part',
      name: 'Part',
      mode: 'auto',
      color: '#456789',
      solo: false,
      volume: 1,
      pan: 0,
      height: 128,
      view: 'roll',
      clef: 'auto',
      quantGrid: 120,
      armed: false,
      leads: false,
      notes: [
        [1800, 300, 60, 90],
        [2000, 100, 62, 90],
        [3900, 100, 64, 90],
      ],
      events: [{ tick: 2000, type: 'bend', num: 0, value: 8192 }],
      link: { sourceId: 'score', key: 'part', state: 'synced' },
    })
    expect(insertBars(p, 2, 1).tracks[0]).toMatchObject({
      notes: [
        [1800, 300, 60, 90],
        [3920, 100, 62, 90],
        [5820, 100, 64, 90],
      ],
      link: { state: 'ahead' },
    })
    expect(deleteBars(p, 2, 1).tracks[0]).toMatchObject({
      notes: [
        [1800, 120, 60, 90],
        [1980, 100, 64, 90],
      ],
      events: [],
      link: { state: 'ahead' },
    })
  })
  it('protects linked and tapped grids', () => {
    const p = newProject()
    p.mapOwner = 'score'
    expect(() => setTempoFrom(p, 1, 80)).toThrow(/linked score/)
    expect(appendBars(p, 1).lengthTicks).toBe(p.lengthTicks + 1920)
    p.mapOwner = null
    p.beatAnchors = [{ tick: 0, sec: 0 }]
    expect(() => insertBars(p, 1, 1)).toThrow(/tapped beat/)
  })
  it('restores the document with one undo', () => {
    setActivePinia(createPinia())
    const doc = useProjectStore()
    const original = doc.project
    doc.update(() => insertBars(doc.project, 1, 2))
    doc.undo()
    expect(doc.project).toEqual(original)
  })
})

it('scales, rewrites and edits bounded tempo sections while preserving surrounding time', async () => {
  const { scaleTempos, flattenTempo, setSectionTempo } =
    await import('../../src/shared/bar-edit')
  const project = newProject()
  project.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 1920, bpm: 90 },
    { tick: 3840, bpm: 100 },
  ]
  expect(scaleTempos(project, 0.5).tempos.map((t) => t.bpm)).toEqual([
    60, 45, 50,
  ])
  expect(flattenTempo(project, 75).tempos).toEqual([{ tick: 0, bpm: 75 }])
  expect(setSectionTempo(project, 2000, 120).tempos).toEqual([
    project.tempos[0],
    project.tempos[2],
  ])
  project.loop = { enabled: true, startTick: 1440, endTick: 2400 }
  expect(setSectionTempo(project, 0, 80).tempos).toEqual([
    project.tempos[0],
    { tick: 1440, bpm: 80 },
    { tick: 2400, bpm: 90 },
    project.tempos[2],
  ])
  expect(() => scaleTempos(project, 4)).toThrow()
  project.mapOwner = 'score'
  expect(() => flattenTempo(project, 60)).toThrow()
  project.mapOwner = null
  project.beatAnchors = [{ tick: 0, sec: 0 }]
  expect(() => setSectionTempo(project, 0, 60)).toThrow()
})
