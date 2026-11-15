import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Draft } from 'immer'
import type { PatchConn, Project, TrackMode, Zone } from '../../shared/model'
import { effectiveSetup } from '../../shared/overlay'
import { useProjectStore } from './project'
import { useRuntimeStore } from './runtime'

export const usePerformanceStore = defineStore('performance', () => {
  const doc = useProjectStore(),
    runtime = useRuntimeStore()
  const editScene = ref(true)
  const scene = computed(() =>
    doc.project.scenes.find((s) => s.id === runtime.state.activeSceneId),
  )
  const sceneId = computed(() =>
    editScene.value ? (scene.value?.id ?? null) : null,
  )
  const setup = computed(() => effectiveSetup(doc.project, sceneId.value))
  const label = computed(() => (sceneId.value ? scene.value!.name : 'Base'))
  function zones(recipe: (zones: Draft<Zone[]>) => void): void {
    doc.update((draft) => {
      const layer =
        draft.scenes.find((s) => s.id === sceneId.value) ?? draft.base
      layer.zones ??= JSON.parse(JSON.stringify(draft.base.zones))
      recipe(layer.zones!)
    })
  }
  function patch(
    recipe: (patch: Draft<PatchConn[]>) => void,
    extra?: (draft: Draft<Project>) => void,
  ): void {
    doc.update((draft) => {
      extra?.(draft)
      const layer =
        draft.scenes.find((s) => s.id === sceneId.value) ?? draft.base
      layer.patch ??= JSON.parse(JSON.stringify(draft.base.patch))
      recipe(layer.patch!)
    })
  }
  function mode(trackId: string, value: TrackMode): void {
    doc.update((draft) => {
      const scene = draft.scenes.find((s) => s.id === sceneId.value)
      if (scene) {
        scene.trackModes ??= {}
        scene.trackModes[trackId] = value
      } else {
        const track = draft.tracks.find((t) => t.id === trackId)
        if (track) track.mode = value
        delete draft.base.trackModes[trackId]
      }
    })
  }
  watch(
    () => runtime.state.activeSceneId,
    () => {
      editScene.value = true
    },
  )
  return { editScene, scene, sceneId, setup, label, zones, patch, mode }
})
