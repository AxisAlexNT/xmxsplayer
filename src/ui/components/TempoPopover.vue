<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import EditorPopover from './EditorPopover.vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { useSourcesStore } from '../stores/sources'
import { useI18n } from '../i18n'
import { engineBus } from '../bus'
import { editTempo } from '../../shared/bar-edit'
import { TimeMap } from '../../shared/time-map'
import type { TempoMode } from '../../shared/model'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  sources = useSourcesStore()
const { t, number } = useI18n()
const button = ref<HTMLButtonElement>(),
  field = ref<HTMLInputElement>(),
  inline = ref(false)
const anchor = ref<{ right: number; top: number }>(),
  error = ref('')
const map = computed(() => new TimeMap(doc.project)),
  tick = computed(() => runtime.transport.tick)
const bpm = computed(() => map.value.tempoAt(tick.value)),
  mode = computed(() => settings.value.tempoMode ?? 'scale')
const factor = computed(
  () =>
    runtime.state.followMode === 'tempoTrack' ||
    Math.abs(runtime.transport.followFactor - 1) > 0.005,
)
const sectionBars = computed(() => {
  const p = doc.project
  const start = p.loop.enabled
    ? p.loop.startTick
    : map.value.tempos.filter((e) => e.tick <= tick.value).at(-1)!.tick
  const end = p.loop.enabled
    ? p.loop.endTick
    : (map.value.tempos.find((e) => e.tick > tick.value)?.tick ?? p.lengthTicks)
  return {
    first: map.value.tickToBarBeat(start).bar,
    last: map.value.tickToBarBeat(Math.max(start, end - 1)).bar,
  }
})
const locked = computed(
  () => doc.project.mapOwner !== null || doc.project.beatAnchors.length > 0,
)
let clickTimer: ReturnType<typeof setTimeout> | undefined
let pointer:
  { id: number; y: number; steps: number; dragged: boolean } | undefined
let skipClick = false
function open() {
  const r = button.value?.getBoundingClientRect()
  if (r) anchor.value = { right: r.left - 8, top: r.bottom + 4 }
  error.value = ''
}
function click(e: MouseEvent) {
  if (skipClick) {
    skipClick = false
    return
  }
  clearTimeout(clickTimer)
  if (e.detail === 0) open()
  else if (e.detail === 1) clickTimer = setTimeout(open, 300)
}
async function inlineEdit() {
  clearTimeout(clickTimer)
  if (locked.value) {
    open()
    return
  }
  anchor.value = undefined
  inline.value = true
  await nextTick()
  field.value?.select()
}
function apply(value: number, grouped = false) {
  if (locked.value) return
  try {
    if (!Number.isFinite(value) || value < 20 || value > 400)
      throw Error(t('tempo.range'))
    const next = editTempo(doc.project, tick.value, value, mode.value)
    doc.update(() => next, grouped ? 'tempo-gesture' : undefined)
    error.value = ''
  } catch (e) {
    const message = String(e instanceof Error ? e.message : e)
    if (!anchor.value && !inline.value) open()
    error.value = message
  }
}
function step(amount: number, grouped = false) {
  apply(
    Math.max(20, Math.min(400, Math.round((bpm.value + amount) * 10) / 10)),
    grouped,
  )
}
function pointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  pointer = { id: e.pointerId, y: e.clientY, steps: 0, dragged: false }
  skipClick = false
  button.value?.setPointerCapture(e.pointerId)
}
function pointerMove(e: PointerEvent) {
  if (!pointer || e.pointerId !== pointer.id || locked.value) return
  const steps = Math.trunc((pointer.y - e.clientY) / 6)
  if (steps === pointer.steps) return
  step((steps - pointer.steps) * (e.shiftKey ? 0.1 : 1), true)
  pointer.steps = steps
  pointer.dragged = true
}
function endPointer() {
  skipClick = pointer?.dragged ?? false
  pointer = undefined
}
async function finishInline() {
  if (!inline.value) return
  apply(field.value?.valueAsNumber ?? NaN)
  inline.value = false
  if (error.value) {
    const message = error.value
    await nextTick()
    open()
    error.value = message
  }
}
async function remember(value: TempoMode) {
  try {
    await settings.save({ ...settings.value, tempoMode: value })
  } catch (e) {
    error.value = String(e)
  }
}
function unlock() {
  if (doc.project.mapOwner !== null) sources.unlink(doc.project.mapOwner)
  else
    doc.update((d) => {
      d.tempos = map.value.tempos.map(({ tick, bpm }) => ({ tick, bpm }))
      d.beatAnchors = []
    })
}
onUnmounted(() => clearTimeout(clickTimer))
</script>
<template>
  <div class="xm-field xm-tempo-field">
    <input
      v-if="inline"
      ref="field"
      type="number"
      min="20"
      max="400"
      step=".1"
      :aria-label="t('tempo.bpm')"
      :value="bpm.toFixed(1)"
      @keydown.enter.prevent.stop="finishInline"
      @keydown.esc.stop="inline=false"
      @blur="finishInline"
    >
    <button
      v-else
      ref="button"
      class="xm-tempo-button"
      :title="t('tempo.hint')"
      aria-haspopup="dialog"
      @click="click"
      @dblclick="inlineEdit"
      @wheel.prevent="step(($event.deltaY<0?1:-1)*($event.shiftKey?.1:1),true)"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="endPointer"
      @pointercancel="endPointer"
    >
      <span>{{ t('tempo.title') }}</span><b>{{ number(Number((bpm*(factor?runtime.transport.rate*runtime.transport.followFactor:1)).toFixed(1))) }}</b>
      <small v-if="factor">{{ t('control.factorSymbol') }}{{ runtime.transport.followFactor.toFixed(2) }}</small>
    </button>
    <EditorPopover
      v-if="anchor"
      :title="t('tempo.title')"
      :anchor="anchor"
      @close="anchor=undefined"
    >
      <small class="xm-muted">{{ t('tempo.bar', { bar: map.tickToBarBeat(tick).bar }) }}</small>
      <div class="xm-tempo-big">
        <button
          class="btn btn-xm"
          :disabled="locked"
          :aria-label="t('tempo.lower')"
          @click="step(-1)"
        >
          −
        </button>
        <input
          class="form-control"
          type="number"
          min="20"
          max="400"
          step=".1"
          :disabled="locked"
          :aria-label="t('tempo.bpm')"
          :value="bpm.toFixed(1)"
          @change="apply(($event.target as HTMLInputElement).valueAsNumber)"
          @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        >
        <button
          class="btn btn-xm"
          :disabled="locked"
          :aria-label="t('tempo.raise')"
          @click="step(1)"
        >
          +
        </button>
      </div>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
      <div
        v-if="locked"
        class="xm-banner"
      >
        <span>{{ doc.project.mapOwner!==null?t('tempo.linked'):t('tempo.tapped') }}</span><button
          class="btn btn-xm"
          @click="unlock"
        >
          {{ doc.project.mapOwner!==null?t('tempo.detach'):t('tempo.clear') }}
        </button>
      </div>
      <template v-else>
        <label class="form-label mt-2">{{ t('tempo.change') }}</label>
        <div class="xm-seg">
          <button
            v-for="item in (['scale','rewrite','section'] as const)"
            :key="item"
            :class="{'is-on':mode===item}"
            :aria-pressed="mode===item"
            @click="remember(item)"
          >
            {{ item==='scale'?t('tempo.scale'):item==='rewrite'?t('tempo.rewrite'):t('tempo.section') }}
          </button>
        </div>
        <small
          v-if="mode==='section'"
          class="xm-muted"
        >{{ t('tempo.sectionRange',{first:sectionBars.first,last:sectionBars.last}) }}</small>
        <div class="xm-row my-2">
          <button
            class="xm-tap flex-grow-1"
            @click="engineBus?.send('action:run',{action:{type:'transport',cmd:'tap'}})"
          >
            {{ t('tempo.tap') }}
          </button>
          <button
            class="btn btn-xm"
            @click="apply(bpm*.5)"
          >
            {{ t('control.halfSymbol') }}
          </button><button
            class="btn btn-xm"
            @click="apply(bpm*2)"
          >
            {{ t('control.doubleSymbol') }}
          </button>
        </div>
        <label class="form-label">{{ t('tempo.changes') }}</label>
        <div class="xm-tempo-list">
          <div
            v-for="entry in map.tempos"
            :key="entry.tick"
            class="xm-row"
          >
            <span>{{ t('tempo.bar',{bar:map.tickToBarBeat(entry.tick).bar}) }}</span><b class="flex-grow-1">{{ number(entry.bpm) }}</b>
            <button
              class="btn btn-sm btn-ghost"
              :disabled="entry.tick===0"
              :aria-label="t('tempo.delete')"
              @click="doc.update(d=>{d.tempos=d.tempos.filter(e=>e.tick!==entry.tick)})"
            >
              <i class="bi bi-trash" />
            </button>
          </div>
        </div>
      </template>
    </EditorPopover>
  </div>
</template>
