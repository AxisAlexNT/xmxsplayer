import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import type { MidiTrack, Note, Project } from '../../shared/model'
import { useProjectStore } from './project'
import { useRuntimeStore } from './runtime'
import { engineBus } from '../bus'
import {
  deleteNotes,
  duplicateNotes,
  moveNotes,
  quantizeNotes,
  type EditResult,
} from '../lanes/roll-edit'
interface Selection {
  trackId: string | null
  notes: Note[]
}
export const useEditorStore = defineStore('editor', () => {
  const doc = useProjectStore(),
    runtime = useRuntimeStore(),
    tool = ref<'select' | 'draw' | 'erase'>('select'),
    snap = ref(120),
    activeTrackId = ref<string | null>(null),
    selection = shallowRef<Selection>({ trackId: null, notes: [] }),
    followRevision = ref(0),
    notice = shallowRef<{ text: string } | null>(null)
  const snapshots = new WeakMap<Project, Selection>()
  const track = computed(() =>
    doc.project.tracks.find(
      (t): t is MidiTrack => t.id === activeTrackId.value && t.kind === 'midi',
    ),
  )
  const selected = computed(() =>
    selection.value.trackId === track.value?.id
      ? track.value.notes.filter((n) => selection.value.notes.includes(n))
      : [],
  )
  function select(trackId: string, notes: readonly Note[]): void {
    activeTrackId.value = trackId
    selection.value = { trackId, notes: [...notes] }
    snapshots.set(doc.project, selection.value)
  }
  function activate(trackId: string): void {
    if (activeTrackId.value !== trackId) select(trackId, [])
  }
  watch(
    () => doc.project,
    (p) => {
      const saved = snapshots.get(p)
      if (saved) {
        selection.value = saved
        activeTrackId.value = saved.trackId
      } else {
        const current = p.tracks.find((t) => t.id === selection.value.trackId)
        selection.value = {
          trackId: selection.value.trackId,
          notes:
            current?.kind === 'midi'
              ? current.notes.filter((n) => selection.value.notes.includes(n))
              : [],
        }
        snapshots.set(p, selection.value)
      }
      if (
        !p.tracks.some((t) => t.id === activeTrackId.value && t.kind === 'midi')
      )
        activeTrackId.value =
          p.tracks.find((t) => t.kind === 'midi')?.id ?? null
    },
    { immediate: true, flush: 'sync' },
  )
  watch(
    () => doc.folder,
    () => {
      selection.value = { trackId: null, notes: [] }
      runtime.lastTake = []
    },
  )
  let preview: { trackId: string; key: number; source: string } | undefined,
    timer: ReturnType<typeof setTimeout> | undefined
  function stopAudition(): void {
    clearTimeout(timer)
    if (preview)
      engineBus.value?.send('track:audition', {
        ...preview,
        vel: 100,
        on: false,
      })
    preview = undefined
  }
  function audition(trackId: string, key: number, velocity: number): void {
    stopAudition()
    preview = { trackId, key, source: `roll-${trackId}` }
    engineBus.value?.send('track:audition', {
      ...preview,
      vel: velocity,
      on: true,
    })
    timer = setTimeout(stopAudition, 180)
  }
  function commitMany(
    changes: { trackId: string; result: EditResult }[],
  ): boolean {
    const changed = changes.filter(({ trackId, result }) => {
      const t = doc.project.tracks.find((t) => t.id === trackId)
      return (
        t?.kind === 'midi' &&
        (t.notes.length !== result.notes.length ||
          t.notes.some((n, i) => n !== result.notes[i]))
      )
    })
    if (!changed.length) return false
    snapshots.set(doc.project, selection.value)
    doc.update((d) => {
      for (const { trackId, result } of changed) {
        const t = d.tracks.find((t) => t.id === trackId)
        if (t?.kind !== 'midi') continue
        t.notes = result.notes
        if (t.link) t.link.state = 'ahead'
        d.lengthTicks = result.notes.reduce(
          (end, n) => Math.max(end, n[0] + n[1]),
          d.lengthTicks,
        )
      }
    })
    runtime.lastTake = runtime.lastTake.map((take) => {
      const change = changed.find((c) => c.trackId === take.trackId)
      if (!change) return take
      const aliases = new Set(take.notes)
      for (const [old, next] of change.result.replacements)
        if (aliases.has(old) && next) aliases.add(next)
      return { ...take, notes: [...aliases] }
    })
    const active = changed.find((c) => c.trackId === activeTrackId.value)
    if (active) select(active.trackId, active.result.selection)
    return true
  }
  function commit(trackId: string, result: EditResult): boolean {
    return commitMany([{ trackId, result }])
  }
  function quantize(): boolean {
    if (!snap.value) return false
    if (track.value && selected.value.length)
      return commit(
        track.value.id,
        quantizeNotes(track.value.notes, selected.value, snap.value),
      )
    const changes = runtime.lastTake.flatMap((take) => {
      const t = doc.project.tracks.find((t) => t.id === take.trackId)
      if (t?.kind !== 'midi') return []
      const chosen = t.notes.filter((n) => take.notes.includes(n))
      return chosen.length
        ? [
            {
              trackId: t.id,
              result: quantizeNotes(t.notes, chosen, snap.value),
            },
          ]
        : []
    })
    return commitMany(changes)
  }
  function keydown(event: KeyboardEvent): boolean {
    const t = track.value
    if (!t || !selected.value.length) return false
    let result: EditResult | undefined
    if (event.key === 'Delete' || event.key === 'Backspace')
      result = deleteNotes(t.notes, selected.value)
    else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'd'
    )
      result = duplicateNotes(t.notes, selected.value, snap.value)
    else if (event.key.startsWith('Arrow'))
      result = moveNotes(
        t.notes,
        selected.value,
        event.key === 'ArrowLeft'
          ? -(snap.value || 120)
          : event.key === 'ArrowRight'
            ? snap.value || 120
            : 0,
        event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0,
        snap.value,
      )
    if (!result) return false
    event.preventDefault()
    commit(t.id, result)
    if (result.selection[0])
      audition(t.id, result.selection[0][2], result.selection[0][3])
    return true
  }
  return {
    notice,
    tool,
    snap,
    activeTrackId,
    selection,
    selected,
    followRevision,
    activate,
    select,
    commit,
    quantize,
    keydown,
    audition,
    stopAudition,
  }
})
