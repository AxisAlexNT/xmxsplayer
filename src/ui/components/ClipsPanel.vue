<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { AudioTrack, Clip } from '../../shared/model'
import type { RequestMap } from '../../shared/protocol'
import { TimeMap } from '../../shared/time-map'
import { engineBus } from '../bus'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import {
  CLIP_DRAG_TYPE,
  clipBindings,
  clipFromLoop,
  newClip,
} from '../clips/model'
import ClipEditor from './ClipEditor.vue'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  error = ref(''),
  busy = ref(false)
const editing = shallowRef<{
  clip: Clip
  fresh?: boolean
  source?: RequestMap['clip:source']['output']
} | null>(null)
const audio = computed(() =>
  doc.project.tracks.find(
    (track): track is AudioTrack =>
      track.kind === 'audio' && track.id === runtime.selectedAudioId,
  ),
)
const map = computed(() => new TimeMap(doc.project))
const beatMs = computed(
  () =>
    60000 /
    map.value.tempoAt(runtime.transport.tick) /
    (runtime.transport.rate * runtime.transport.followFactor),
)
const held = new Set<string>()
const pointers = new Map<number, string>()
let disposed = false
function source(id: string): string {
  return `ui:clip:${id}`
}
function run(clip: Clip, pressed: boolean): void {
  engineBus.value?.send('action:run', {
    action: { type: 'clip', cmd: 'launch', clipId: clip.id },
    pressed,
    source: source(clip.id),
  })
}
function press(clip: Clip, event: PointerEvent): void {
  if (clip.launch !== 'hold' || event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, clip.id)
  if (!held.has(clip.id)) {
    held.add(clip.id)
    run(clip, true)
  }
}
function release(id: string): void {
  for (const [pointer, clip] of pointers)
    if (clip === id) pointers.delete(pointer)
  if (!held.delete(id)) return
  engineBus.value?.send('action:run', {
    action: { type: 'clip', cmd: 'launch', clipId: id },
    pressed: false,
    source: source(id),
  })
}
function releaseAll(): void {
  for (const id of [...held]) release(id)
}
function key(clip: Clip, event: KeyboardEvent, down: boolean): void {
  if (clip.launch !== 'hold' || ![' ', 'Enter'].includes(event.key)) return
  event.preventDefault()
  if (!down) release(clip.id)
  else if (!event.repeat && !held.has(clip.id)) {
    held.add(clip.id)
    run(clip, true)
  }
}
function launch(clip: Clip, event: MouseEvent): void {
  if (clip.launch !== 'hold') run(clip, true)
  // Assistive technology can activate a button without pointer or key events.
  else if (event.detail === 0 && !held.has(clip.id)) {
    run(clip, true)
    run(clip, false)
  }
}
function drag(event: DragEvent, clip: Clip): void {
  release(clip.id)
  event.dataTransfer?.setData(CLIP_DRAG_TYPE, clip.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link'
}
function bound(clip: Clip): string {
  return clipBindings(
    doc.project,
    clip.id,
    runtime.state.activeSceneId,
    runtime.midi.devices.map((device) => device.profileId),
  ).join(', ')
}
function bindingCaption(clip: Clip): string {
  const names = bound(clip).split(', ').filter(Boolean)
  return names.length
    ? names[0].replace(/ \([^)]*\)$/, '') +
        (names.length > 1 ? ` +${names.length - 1}` : '')
    : '—'
}
function description(clip: Clip): string {
  if (bound(clip).includes('(sweep)')) {
    if (clip.sweep.mode === 'position') return 'Position'
    if (clip.sweep.mode === 'pitchOnly') return 'Pitch only'
    const [lo, hi] = clip.sweep.range
    return lo === -hi ? `Moving ±${Math.abs(hi)}` : `Moving ${lo}…${hi}`
  }
  return clip.sync
    ? `${clip.beats} beats · sync`
    : clip.launch === 'oneShot'
      ? 'One-shot'
      : `${(clip.endSec - clip.startSec).toFixed(2)} s · ${clip.launch}`
}
async function create(fromLoop: boolean): Promise<void> {
  const folder = doc.folder
  if (!folder || !engineBus.value) return
  error.value = ''
  busy.value = true
  try {
    const track = audio.value,
      project = doc.project
    if (fromLoop && !track) throw Error('Select an audio track first')
    const file = fromLoop
      ? track!.file
      : await window.xm.project.importFile('audio')
    if (!file || disposed || doc.folder !== folder) return
    const metadata = await engineBus.value.request(
      'clip:source',
      { file },
      120000,
    )
    if (disposed || doc.folder !== folder) return
    editing.value = {
      clip: fromLoop
        ? clipFromLoop(project, track!)
        : newClip(doc.project, file, metadata.durationSec),
      fresh: true,
      source: metadata,
    }
  } catch (reason) {
    if (!disposed && doc.folder === folder) error.value = String(reason)
  } finally {
    if (!disposed) busy.value = false
  }
}
watch(
  () => doc.folder,
  () => {
    releaseAll()
    editing.value = null
    error.value = ''
  },
)
watch(
  () => runtime.connected,
  (connected) => {
    if (!connected) {
      held.clear()
      editing.value = null
    }
  },
)
function pointerEnd(event: PointerEvent): void {
  const id = pointers.get(event.pointerId)
  if (id) release(id)
}
onMounted(() => {
  window.addEventListener('blur', releaseAll)
  window.addEventListener('pointerup', pointerEnd)
  window.addEventListener('pointercancel', pointerEnd)
})
onUnmounted(() => {
  disposed = true
  releaseAll()
  window.removeEventListener('blur', releaseAll)
  window.removeEventListener('pointerup', pointerEnd)
  window.removeEventListener('pointercancel', pointerEnd)
})
</script>
<template>
  <div class="xm-row xm-clip-add">
    <button
      class="btn btn-sm btn-ghost"
      :disabled="busy || !doc.folder || !runtime.connected"
      @click="create(false)"
    >
      {{ t('clipsPanel.fromFile') }}
    </button>
    <button
      class="btn btn-sm btn-ghost"
      :disabled="
        busy || !audio || !doc.project.loop.enabled || !runtime.connected
      "
      :title="t('clipsPanel.useTheLoopRangeOfTheSelectedAudioTrack')"
      @click="create(true)"
    >
      {{ t('clipsPanel.fromLoop') }}
    </button>
    <span
      v-if="busy"
      class="xm-faint"
      role="status"
    >{{ t('clipsPanel.loading') }}</span>
  </div>
  <div
    class="xm-clips"
    :style="{ '--clip-beat': `${beatMs}ms` }"
  >
    <div
      v-for="clip in doc.project.clips"
      :key="clip.id"
      class="xm-clip"
      :class="{
        'is-playing': runtime.state.clips[clip.id] === 'playing',
        'is-queued': runtime.state.clips[clip.id] === 'queued',
      }"
      :style="{
        '--c': clip.color,
        '--p': `${(runtime.clipProgress[clip.id] ?? 0) * 100}%`,
      }"
      draggable="true"
      @dragstart="drag($event, clip)"
    >
      <button
        v-mappable="{label:clip.name,action:{type:'clip',cmd:'launch',clipId:clip.id}}"
        class="xm-clip-launch"
        :aria-label="`Launch ${clip.name}`"
        :aria-pressed="runtime.state.clips[clip.id] === 'playing'"
        :disabled="!runtime.connected"
        :title="`${clip.name} · ${description(clip)} · ${bound(clip) || 'Drag onto a controller control to bind'}`"
        @pointerdown="press(clip, $event)"
        @pointerup="release(clip.id)"
        @pointercancel="release(clip.id)"
        @lostpointercapture="release(clip.id)"
        @blur="release(clip.id)"
        @keydown="key(clip, $event, true)"
        @keyup="key(clip, $event, false)"
        @click="launch(clip, $event)"
      >
        <b>{{ clip.name }}</b><small><span>{{ description(clip) }}</span><span>{{ bindingCaption(clip) }}</span></small>
      </button>
      <button
        class="xm-clip-edit"
        :aria-label="`Edit clip ${clip.name}`"
        @click="editing = { clip }"
      >
        <i class="bi bi-pencil" />
      </button>
      <i class="xm-prog" />
    </div>
  </div>
  <span
    v-if="!doc.project.clips.length"
    class="xm-faint"
  >{{ t('clipsPanel.addAFileOrUseALoopFromAnAudio') }}</span>
  <small
    v-else
    class="xm-faint d-block mt-2"
  >{{ t('clipsPanel.tapToLaunchPencilToEditDragOntoAControl') }}</small>
  <p
    v-for="clip in doc.project.clips.filter((c) => runtime.clipErrors[c.id])"
    :key="clip.id"
    class="text-danger mt-2 mb-0"
    role="alert"
  >
    {{ runtime.clipErrors[clip.id] }}
  </p>
  <p
    v-if="error"
    class="text-danger mt-2 mb-0"
    role="alert"
  >
    {{ error }}
  </p>
  <ClipEditor
    v-if="editing"
    v-bind="editing"
    @close="editing = null"
  />
</template>
