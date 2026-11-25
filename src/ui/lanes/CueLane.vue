<script setup lang="ts">
import { t } from '../i18n'
import { computed, inject, ref } from 'vue'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useEditorStore } from '../stores/editor'
import { useSettingsStore } from '../stores/settings'
import { engineBus } from '../bus'
import type { Cue } from '../../shared/model'
import CueEditor from '../components/CueEditor.vue'
import EditorPopover from '../components/EditorPopover.vue'
const context = inject(timelineKey)!,
  doc = useProjectStore(),
  runtime = useRuntimeStore(),
  editor = useEditorStore(),
  settings = useSettingsStore()
const emit = defineEmits<{ error: [error: unknown] }>()
const surface = ref<HTMLElement>(),
  selected = ref<Cue | null | undefined>(undefined),
  initialTick = ref(0),
  preview = ref<{ id: string; tick: number } | null>(null),
  menu = ref(false),
  anchor = ref({ right: 0, top: 0 })
let suppressClick = false
const cues = computed(() =>
  doc.project.cues
    .map((cue) => {
      const tick = preview.value?.id === cue.id ? preview.value.tick : cue.tick,
        axis = context.axis.value,
        page = axis.pageOfTick(tick)
      return {
        cue,
        x:
          page * axis.pageWidth +
          axis.xInPage(tick, page) -
          context.frame.value.offset,
      }
    })
    .filter((item) => item.x >= -240 && item.x < context.axis.value.pageWidth),
)
function at(event: MouseEvent): number {
  const axis = context.axis.value,
    x =
      event.clientX -
      surface.value!.getBoundingClientRect().left +
      context.frame.value.offset
  const page = Math.max(
      0,
      Math.min(axis.pageCount - 1, Math.floor(x / axis.pageWidth)),
    ),
    tick = axis.tickAt(page, x - page * axis.pageWidth),
    step = editor.snap
  return Math.max(
    0,
    Math.min(
      doc.project.lengthTicks,
      Math.round(step ? Math.round(tick / step) * step : tick),
    ),
  )
}
function add(tick = Math.round(runtime.transport.tick)): void {
  initialTick.value = tick
  selected.value = null
}
function open(cue: Cue): void {
  if (suppressClick) {
    suppressClick = false
    return
  }
  selected.value = cue
  initialTick.value = cue.tick
}
function drag(event: PointerEvent, cue: Cue): void {
  if (event.button !== 0) return
  const el = event.currentTarget as HTMLElement,
    start = event.clientX,
    startTick = at(event),
    folder = doc.folder
  el.setPointerCapture(event.pointerId)
  context.navigation.freeze()
  let moved = false
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    if (Math.abs(e.clientX - start) < 4 && !moved) return
    moved = true
    preview.value = {
      id: cue.id,
      tick: Math.max(
        0,
        Math.min(doc.project.lengthTicks, cue.tick + at(e) - startTick),
      ),
    }
  }
  const cleanup = (): void => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', cancel)
    el.removeEventListener('lostpointercapture', cancel)
  }
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    const value = preview.value
    preview.value = null
    suppressClick = moved
    cleanup()
    if (!value || folder !== doc.folder) return
    try {
      doc.update((d) => {
        const current = d.cues.find((c) => c.id === cue.id)
        if (current && current.tick === cue.tick) current.tick = value.tick
        d.cues.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id))
      })
    } catch (error) {
      emit('error', error)
    }
  }
  const cancel = (): void => {
    preview.value = null
    cleanup()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', cancel)
  el.addEventListener('lostpointercapture', cancel)
}
function options(event: Event): void {
  anchor.value = (event.currentTarget as HTMLElement).getBoundingClientRect()
  menu.value = true
}
async function chase(event: Event): Promise<void> {
  try {
    await settings.save({
      ...settings.value,
      chaseCuesOnSeek: (event.target as HTMLInputElement).checked,
    })
  } catch (error) {
    emit('error', error)
  }
}
</script>
<template>
  <div class="xm-rowgrid xm-cues">
    <div class="xm-corner">
      <span class="flex-grow-1">{{ t('cueLane.cues') }}</span><button
        class="xm-cue-tool"
        :aria-label="t('cueLane.addCueAtPlayhead')"
        :title="t('cueLane.addCueAtPlayhead')"
        @click="add()"
      >
        <i class="bi bi-plus-lg" />
      </button><button
        class="xm-cue-tool"
        :aria-label="t('cueLane.cueOptions')"
        @click="options"
      >
        <i class="bi bi-three-dots" />
      </button>
    </div>
    <div
      ref="surface"
      class="xm-lanearea xm-cue-surface"
      @dblclick.self="add(at($event))"
    >
      <button
        v-for="item in cues"
        :key="item.cue.id"
        class="xm-cue"
        :class="{
          'is-armed':
            runtime.state.armedCueId === item.cue.id ||
            runtime.state.queuedCueIds?.includes(item.cue.id),
        }"
        :style="{ left: `${item.x}px` }"
        :aria-label="`Edit cue ${item.cue.name}`"
        :title="`${item.cue.name} · ${item.cue.trigger}${item.cue.control ? ` · ${item.cue.control}` : ''}`"
        @pointerdown.stop.prevent="drag($event, item.cue)"
        @click.stop="open(item.cue)"
      >
        <i
          :class="`bi bi-${item.cue.trigger === 'wait' ? 'pause-circle' : 'diamond-fill'}`"
        />{{ item.cue.name
        }}<span
          v-if="item.cue.trigger !== 'auto'"
          class="xm-faint"
        >{{
          item.cue.control ||
            (item.cue.trigger === 'wait' ? 'live key' : 'armed')
        }}</span>
      </button>
    </div>
    <CueEditor
      v-if="selected !== undefined"
      :cue="selected ?? undefined"
      :tick="initialTick"
      @close="selected = undefined"
    />
    <EditorPopover
      v-if="menu"
      :title="t('cueLane.cueOptions')"
      :anchor="anchor"
      @close="menu = false"
    >
      <label class="xm-row"><input
        class="form-check-input"
        type="checkbox"
        :checked="settings.value.chaseCuesOnSeek ?? true"
        @change="chase"
      >{{ t('cueLane.chaseCuesOnSeek') }}</label>
      <p class="xm-faint mt-2">
        {{ t('cueLane.onSeekRestoreTheSceneRegistersAndTrackModesFrom') }}
      </p>
      <button
        class="btn btn-sm btn-ghost"
        @click="
          engineBus?.send('action:run', {
            action: { type: 'cue', cmd: 'fireNext' },
          })
        "
      >
        <i class="bi bi-play-fill" /> {{ t('cueLane.fireNextCue') }}
      </button><button
        class="btn btn-sm btn-ghost"
        @click="
          engineBus?.send('action:run', {
            action: { type: 'transport', cmd: 'skipHold' },
          })
        "
      >
        {{ t('followControl.skipHold') }}
      </button>
    </EditorPopover>
  </div>
</template>
