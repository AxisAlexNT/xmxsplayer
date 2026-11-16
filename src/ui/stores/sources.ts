import { NotationClient } from '../notation/client'
import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import { useProjectStore } from './project'
import { useRuntimeStore } from './runtime'
import { uniqueId, slugify } from '../../shared/ids'
import type { Source } from '../../shared/model'
import { detachSource, mergeScore, parseScore } from '../sources/sync'
import { exportMidi } from '../sources/export-midi'
export const useSourcesStore = defineStore('sources', () => {
  const doc = useProjectStore(),
    runtime = useRuntimeStore()
  const busy = ref<Record<string, boolean>>({}),
    notice = ref<{ text: string } | null>(null)
  const musicxml = shallowRef<Record<string, string>>({})
  const pending = new Set<string>()
  let initialized = false,
    generation = 0
  function message(text: string): void {
    notice.value = { text }
    runtime.log({ level: 'info', source: 'scores', message: text })
  }
  async function sync(id: string, discardId?: string): Promise<void> {
    if (busy.value[id]) {
      if (discardId)
        throw Error('Wait for the current score sync before discarding changes')
      pending.add(id)
      return
    }
    const source = doc.project.sources.find((s) => s.id === id)
    if (!source || !doc.folder) return
    const folder = doc.folder,
      token = generation
    const discard = discardId
      ? doc.project.tracks.find((t) => t.id === discardId)
      : undefined
    busy.value[id] = true
    try {
      const data =
        source.kind === 'musicxml'
          ? await (async () => {
              const xml = await window.xm.scores.readXml(source.file),
                parser = new NotationClient()
              try {
                await parser.request('load', {
                  musicxml: xml,
                  options: { pageWidth: 1200, scale: 40 },
                })
                const midi = await parser.request('midi', undefined)
                return {
                  musicxml: xml,
                  midi: Uint8Array.from(atob(midi), (c) => c.charCodeAt(0)),
                }
              } finally {
                parser.destroy()
              }
            })()
          : await window.xm.scores.convert({ ...source })
      if (
        folder !== doc.folder ||
        generation !== token ||
        !doc.project.sources.some((s) => s.id === id && s.file === source.file)
      )
        return
      if (
        discard &&
        doc.project.tracks.find((t) => t.id === discardId) !== discard
      )
        throw Error(
          'Track changed while re-syncing; try Discard & re-sync again',
        )
      const parsed = parseScore(data, source)
      if (
        discardId &&
        !parsed.tracks.some(
          (t) =>
            t.key ===
            (discard?.kind === 'midi' ? discard.link?.key : undefined),
        )
      )
        throw Error(
          'This staff is no longer in the score; detach it to keep its notes',
        )
      if (data.musicxml)
        musicxml.value = { ...musicxml.value, [id]: data.musicxml }
      const merged = mergeScore(doc.project, source, parsed, discardId)
      doc.update((draft) => Object.assign(draft, merged.project))
      message(
        `Score updated: ${merged.changed} tracks changed${merged.kept ? `, ${merged.kept} kept (modified here)` : ''}${merged.orphaned ? `, ${merged.orphaned} not in score` : ''}`,
      )
    } catch (error) {
      if (folder !== doc.folder || token !== generation) return
      const reason = String(error)
      doc.update((d) => {
        const s = d.sources.find((s) => s.id === id)
        if (s) s.error = reason
      })
      message(`${source.file}: ${reason}`)
    } finally {
      if (token === generation) {
        delete busy.value[id]
        if (pending.delete(id)) void sync(id)
      }
    }
  }
  function init(): void {
    if (initialized) return
    initialized = true
    watch(
      () => doc.loadRevision,
      () => {
        generation++
        busy.value = {}
        musicxml.value = {}
        pending.clear()
      },
      { flush: 'sync' },
    )
    watch(
      () =>
        [
          doc.folder,
          doc.loadRevision,
          ...doc.project.sources.map((s) => `${s.id}:${s.file}:${s.kind}`),
        ].join('|'),
      () => {
        for (const source of doc.project.sources) void sync(source.id)
      },
      { immediate: true },
    )
    window.xm.scores.onChanged(({ folder, paths }) => {
      if (doc.folder !== folder) return
      for (const source of doc.project.sources)
        if (paths.includes(source.file)) void sync(source.id)
    })
  }
  async function link(): Promise<void> {
    if (!doc.folder) throw Error('Create or open a project folder first')
    const folder = doc.folder,
      file = await window.xm.project.importFile('score')
    if (!file || folder !== doc.folder) return
    const existing = doc.project.sources.find((s) => s.file === file)
    if (existing) {
      await sync(existing.id)
      return
    }
    const ext = file.split('.').at(-1)?.toLowerCase()
    const kind: Source['kind'] =
      ext === 'mscz' || ext === 'mscx'
        ? 'mscz'
        : ext === 'mid'
          ? 'mid'
          : 'musicxml'
    const id = uniqueId(
      file
        .split('/')
        .at(-1)!
        .replace(/\.[^.]+$/, ''),
      doc.project.sources.map((s) => s.id),
    )
    doc.update((d) => {
      d.sources.push({ id, file, kind })
    })
  }
  function unlink(id: string): void {
    doc.update((d) => Object.assign(d, detachSource(doc.project, id)))
    message('Score unlinked; tracks kept')
  }
  function detach(id: string): void {
    doc.update((d) => {
      const t = d.tracks.find((t) => t.id === id)
      if (t?.kind === 'midi') delete t.link
    })
  }
  async function exportForScore(trackId?: string): Promise<void> {
    const file = `scores/export/${slugify(trackId ?? doc.project.name)}.mid`
    await window.xm.scores.exportMidi(file, exportMidi(doc.project, trackId))
    message(`Exported ${file}; merge it into the score in MuseScore`)
  }
  return {
    musicxml,
    busy,
    notice,
    init,
    sync,
    link,
    unlink,
    detach,
    exportForScore,
  }
})
