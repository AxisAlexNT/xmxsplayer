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
