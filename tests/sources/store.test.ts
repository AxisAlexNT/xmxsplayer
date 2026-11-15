import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import { writeMidi } from 'midi-file'
import { newProject } from '../../src/shared/defaults'
import { toFiles } from '../../src/shared/project-files'
import { useProjectStore } from '../../src/ui/stores/project'
import { useSourcesStore } from '../../src/ui/stores/sources'
import type { MidiTrack } from '../../src/shared/model'
import type { ScoreData } from '../../src/shared/api'
let pinia: Pinia
const data = (pitch = 60): ScoreData => ({
  midi: new Uint8Array(
    writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
      tracks: [
        [
          {
            deltaTime: 0,
            type: 'noteOn',
            channel: 0,
            noteNumber: pitch,
            velocity: 100,
          },
          {
            deltaTime: 480,
            type: 'noteOff',
            channel: 0,
            noteNumber: pitch,
            velocity: 0,
          },
          { deltaTime: 0, type: 'endOfTrack', meta: true },
        ],
      ],
    }),
  ),
})
function fixture() {
  const convert = vi.fn(async () => data())
  let changed: (change: { folder: string; paths: string[] }) => void = () =>
    undefined
  vi.stubGlobal('window', {
    xm: {
      scores: {
        convert,
        onChanged: (handler: typeof changed) => {
          changed = handler
          return () => undefined
        },
      },
    },
  })
  const doc = useProjectStore(),
    sources = useSourcesStore(),
    p = newProject()
  p.sources = [{ id: 'score', kind: 'mid', file: 'scores/score.mid' }]
  doc.load({ folder: '/project', files: toFiles(p), hashes: {} })
  sources.init()
  return {
    doc,
    sources,
    convert,
    changed: (paths = ['scores/score.mid']) =>
      changed({ folder: doc.folder, paths }),
  }
}
async function settled(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await nextTick()
    if (check()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw Error('Sync did not settle')
}
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  for (const store of pinia._s.values()) store.$dispose()
  vi.unstubAllGlobals()
})
describe('source jobs', () => {
  it('rebuilds linked notes when reopening the same project folder', async () => {
    const { doc, sources, convert } = fixture()
    await settled(() => doc.project.tracks.length === 1 && !sources.busy.score)
    const files = toFiles(doc.project)
    expect(files['tracks/acoustic-grand-piano.mid']).toBeUndefined()
    doc.load({ folder: '/project', files, hashes: {} })
    expect((doc.project.tracks[0] as MidiTrack).notes).toEqual([])
    await settled(() => convert.mock.calls.length === 2 && !sources.busy.score)
    expect((doc.project.tracks[0] as MidiTrack).notes[0][2]).toBe(60)
  })
  it('queues another save during conversion and protects edits made while it runs', async () => {
    const { doc, sources, convert, changed } = fixture()
    await settled(() => doc.project.tracks.length === 1 && !sources.busy.score)
    let resolve!: (d: ScoreData) => void
    convert.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const job = sources.sync('score')
    changed()
    doc.update((d) => {
      const t = d.tracks[0] as MidiTrack
      t.notes = [[0, 120, 90, 100]]
      t.link!.state = 'ahead'
    })
    resolve(data(65))
    await job
    await settled(() => convert.mock.calls.length === 3 && !sources.busy.score)
    expect((doc.project.tracks[0] as MidiTrack).notes[0][2]).toBe(90)
  })
  it('ignores a conversion result after another project is opened', async () => {
    const { doc, sources, convert } = fixture()
    await settled(() => doc.project.tracks.length === 1 && !sources.busy.score)
    let resolve!: (d: ScoreData) => void
    convert.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    const job = sources.sync('score')
    doc.load({
      folder: '/other',
      files: toFiles(newProject('Other')),
      hashes: {},
    })
    resolve(data(70))
    await job
    await nextTick()
    expect(doc.project.name).toBe('Other')
    expect(doc.project.tracks).toEqual([])
    expect(sources.busy).toEqual({})
  })
  it('makes an explicit discard undoable and a detached track locally saveable', async () => {
    const { doc, sources } = fixture()
    await settled(() => doc.project.tracks.length === 1 && !sources.busy.score)
    const id = doc.project.tracks[0].id
    doc.update((d) => {
      const t = d.tracks[0] as MidiTrack
      t.notes = [[0, 120, 90, 100]]
      t.link!.state = 'ahead'
    })
    await sources.sync('score', id)
    expect((doc.project.tracks[0] as MidiTrack).notes[0][2]).toBe(60)
    doc.undo()
    expect((doc.project.tracks[0] as MidiTrack).notes[0][2]).toBe(90)
    sources.detach(id)
    expect(toFiles(doc.project)[`tracks/${id}.mid`]).toBeInstanceOf(Uint8Array)
  })
})
