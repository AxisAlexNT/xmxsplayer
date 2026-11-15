<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { Scene, Timing } from '../../shared/model'
import { uniqueId } from '../../shared/ids'
import { effectiveSetup } from '../../shared/overlay'
import { engineBus } from '../bus'
import { palette } from '../bindings/labels'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { usePerformanceStore } from '../stores/performance'
import EditorPopover from './EditorPopover.vue'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  performance = usePerformanceStore()
const timing = ref<Timing>('now'),
  selectedId = ref<string | null>(null),
  anchor = ref({ right: 0, top: 0 }),
  error = ref('')
const selected = computed(() =>
  doc.project.scenes.find((s) => s.id === selectedId.value),
)
function activate(id: string | null): void {
  performance.editScene = id !== null
  engineBus.value?.send('action:run', {
    action: id
      ? { type: 'scene', cmd: 'activate', sceneId: id }
      : { type: 'scene', cmd: 'clear' },
    at: timing.value,
  })
}
function edit(id: string, event: Event): void {
  selectedId.value = id
  anchor.value = (event.currentTarget as HTMLElement).getBoundingClientRect()
  error.value = ''
}
async function capture(): Promise<void> {
  const p = doc.project,
    setup = effectiveSetup(p, runtime.state.activeSceneId)
  const scene: Scene = {
    id: uniqueId(
      'scene',
      p.scenes.map((s) => s.id),
    ),
    name: `Scene ${p.scenes.length + 1}`,
    color: palette[p.scenes.length % palette.length],
    zones: JSON.parse(
      JSON.stringify(
        runtime.connected ? runtime.state.effective.zones : setup.zones,
      ),
    ),
    patch: JSON.parse(JSON.stringify(setup.patch)),
    trackModes: Object.fromEntries(
      p.tracks.map((t) => [t.id, setup.trackModes[t.id] ?? t.mode]),
    ),
    registers: [...runtime.state.registers],
  }
  doc.update((d) => {
    d.scenes.push(scene)
  })
  await nextTick()
  activate(scene.id)
}
function update(patch: Partial<Scene>): void {
  try {
    doc.update((d) => {
      const scene = d.scenes.find((s) => s.id === selectedId.value)
      if (scene) Object.assign(scene, patch)
    })
    error.value = ''
  } catch (reason) {
    error.value = String(reason)
  }
}
function duplicate(): void {
  if (!selected.value) return
  const copy = JSON.parse(JSON.stringify(selected.value)) as Scene
  copy.id = uniqueId(
    copy.id,
    doc.project.scenes.map((s) => s.id),
  )
  copy.name += ' copy'
  doc.update((d) => {
    d.scenes.push(copy)
  })
  selectedId.value = copy.id
}
function reset(): void {
  doc.update((d) => {
    const scene = d.scenes.find((s) => s.id === selectedId.value)
    if (!scene) return
    delete scene.zones
    delete scene.patch
    delete scene.trackModes
    delete scene.bindings
    delete scene.padColors
    delete scene.beatChase
    delete scene.registers
  })
}
function remove(): void {
  doc.update((d) => {
    d.scenes = d.scenes.filter((s) => s.id !== selectedId.value)
  })
  selectedId.value = null
}
</script>
<template>
  <div class="xm-row justify-content-between mb-2">
    <div
      class="xm-seg"
      aria-label="Store performance edits in"
    >
      <button
        :class="{ 'is-on': !performance.editScene }"
        @click="performance.editScene = false"
      >
        Base
      </button>
      <button
        :disabled="!performance.scene"
        :class="{ 'is-on': performance.editScene && performance.scene }"
        @click="performance.editScene = true"
      >
        {{ performance.scene?.name ?? 'Scene' }}
      </button>
    </div>
    <select
      v-model="timing"
      class="form-select xm-scene-timing"
      aria-label="Scene activation timing"
    >
      <option value="now">
        Now
      </option>
      <option value="beat">
        Beat
      </option>
      <option value="bar">
        Bar
      </option>
    </select>
  </div>
  <div class="xm-wrap">
    <button
      class="xm-chip"
      :class="{ 'is-active': runtime.state.activeSceneId === null }"
      aria-label="Activate base setup"
      @click="activate(null)"
    >
      Base
    </button>
    <div
      v-for="scene in doc.project.scenes"
      :key="scene.id"
      class="xm-scene-chip"
      :style="{ '--c': scene.color }"
    >
      <button
        class="xm-chip"
        :class="{ 'is-active': runtime.state.activeSceneId === scene.id }"
        :aria-label="`Activate scene ${scene.name}`"
        :aria-pressed="runtime.state.activeSceneId === scene.id"
        @click="activate(scene.id)"
        @contextmenu.prevent="edit(scene.id, $event)"
      >
        <i class="xm-sw" />{{ scene.name }}
      </button>
      <button
        class="btn btn-sm btn-ghost"
        :aria-label="`Edit scene ${scene.name}`"
        @click="edit(scene.id, $event)"
      >
        <i class="bi bi-three-dots" />
      </button>
    </div>
    <button
      class="xm-chip is-add"
      @click="capture"
    >
      <i class="bi bi-camera" />Capture
    </button>
  </div>
  <p
    v-if="!doc.project.scenes.length"
    class="xm-faint mt-2 mb-0"
  >
    Capture the current zones, patch and registers as a scene.
  </p>
  <EditorPopover
    v-if="selected"
    title="Scene"
    :anchor="anchor"
    @close="selectedId = null"
  >
    <label class="form-label">Name<input
      class="form-control"
      aria-label="Scene name"
      :value="selected.name"
      @change="update({ name: ($event.target as HTMLInputElement).value })"
    ></label>
    <label class="form-label mt-2">Colour</label>
    <div class="xm-wrap mb-3">
      <button
        v-for="color in palette"
        :key="color"
        class="xm-color-choice"
        :style="{ background: color }"
        :aria-label="`Scene colour ${color}`"
        :aria-pressed="selected.color === color"
        @click="update({ color })"
      />
    </div>
    <div class="xm-row mb-2">
      <button
        class="btn btn-sm btn-ghost"
        @click="duplicate"
      >
        <i class="bi bi-copy" /> Duplicate
      </button><button
        class="btn btn-sm btn-ghost"
        @click="reset"
      >
        <i class="bi bi-arrow-counterclockwise" /> Reset to base
      </button>
    </div>
    <button
      class="btn btn-sm btn-ghost text-danger"
      @click="remove"
    >
      <i class="bi bi-trash" /> Delete scene
    </button>
    <p
      v-if="error"
      class="text-danger mb-0"
      role="alert"
    >
      {{ error }}
    </p>
  </EditorPopover>
</template>
