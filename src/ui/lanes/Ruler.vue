<script setup lang="ts">
defineOptions({ name: 'TimelineRuler' })
import { computed, inject, ref, onBeforeUnmount } from 'vue'
import { timelineKey } from '../timeline/context'
import { useRuntimeStore } from '../stores/runtime'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import {
  insertBars,
  deleteBars,
  setTimeSigFrom,
  setTempoFrom,
} from '../../shared/bar-edit'
import BarGridTools from '../components/BarGridTools.vue'
import { TimeMap } from '../../shared/time-map'
const context = inject(timelineKey)!,
  doc = useProjectStore(),
  runtime = useRuntimeStore(),
  surface = ref<HTMLElement>()
const measures = computed(() => {
  const axis = context.axis.value
  const map = new TimeMap(doc.project)
  return context.frame.value.pages.flatMap((page) =>
    (axis.measures?.(page) ?? map.measures(...axis.pageRange(page))).map(
      (m) => ({
        ...m,
        page,
        x:
          page * axis.pageWidth +
          (axis.measureX?.(m.start, page) ?? axis.xInPage(m.start, page)) -
          context.frame.value.offset,
        beats: m.beats.map(
          (t, i) =>
            page * axis.pageWidth +
            (i === 0
              ? (axis.measureX?.(t, page) ?? axis.xInPage(t, page))
              : axis.xInPage(t, page)) -
            context.frame.value.offset,
        ),
      }),
    ),
  )
})
function at(event: MouseEvent): number {
  const axis = context.axis.value,
    x =
      event.clientX -
      surface.value!.getBoundingClientRect().left +
      context.frame.value.offset,
    page = Math.max(
      0,
      Math.min(axis.pageCount - 1, Math.floor(x / axis.pageWidth)),
    )
  const local = x - page * axis.pageWidth
  for (const m of axis.measures?.(page) ?? [])
    for (const tick of [m.start, m.end])
      if (
        Math.abs(
          (axis.measureX?.(tick, page) ?? axis.xInPage(tick, page)) - local,
        ) <= 3
      )
        return tick
  return Math.round(axis.tickAt(page, local))
}
const menu = ref<{ bar: number; x: number; y: number }>()
const operation = ref('insertBefore')
const count = ref(1)
const numerator = ref(4)
const denominator = ref(4)
const bpm = ref(120)
const message = ref('')
function openMenu(event: MouseEvent) {
  const map = new TimeMap(doc.project)
  const position = map.tickToBarBeat(at(event))
  menu.value = {
    bar: position.bar,
    x: Math.max(0, Math.min(event.clientX, window.innerWidth - 260)),
    y: Math.max(0, Math.min(event.clientY, window.innerHeight - 225)),
  }
  operation.value = 'insertBefore'
  count.value = 1
  numerator.value = position.num
  denominator.value = position.den
  bpm.value = map.tempoAt(at(event))
  message.value = ''
}
function applyEdit() {
  if (!menu.value) return
  const project = doc.project
  const map = new TimeMap(project)
  let bar = menu.value.bar
  let next: typeof project
  try {
    switch (operation.value) {
      case 'delete':
        next = deleteBars(project, bar, count.value)
        break
      case 'loop':
        bar = map.tickToBarBeat(project.loop.startTick).bar
        next = deleteBars(
          project,
          bar,
          map.tickToBarBeat(
            Math.max(project.loop.startTick, project.loop.endTick - 1),
          ).bar -
            bar +
            1,
        )
        break
      case 'signature':
        next = setTimeSigFrom(project, bar, numerator.value, denominator.value)
        break
      case 'tempo':
        next = setTempoFrom(project, bar, bpm.value)
        break
      default:
        if (operation.value === 'insertAfter') bar++
        next = insertBars(project, bar, count.value)
    }
    doc.update(() => next)
    menu.value = undefined
    message.value =
      operation.value !== 'append' &&
      project.tracks.some(
        (t) =>
          t.kind === 'audio' &&
          t.offsetSec + t.durationSec > map.tickToSec(map.barToTick(bar)),
      )
        ? 'Reference audio stays in place and may no longer line up.'
        : ''
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error)
  }
}
let hold: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(hold))
function drag(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  if (event.pointerType !== 'mouse')
    hold = setTimeout(() => openMenu(event), 550)
  const element = surface.value!
  element.setPointerCapture(event.pointerId)
  const start = at(event),
    looping = event.shiftKey
  if (!looping) engineBus.value?.send('transport:seek', { tick: start })
  const move = (e: PointerEvent): void => {
    if (Math.abs(e.clientX - event.clientX) > 5) clearTimeout(hold)
    if (!looping && !menu.value)
      engineBus.value?.send('transport:seek', { tick: at(e) })
  }
  const up = (e: PointerEvent): void => {
    clearTimeout(hold)
    if (looping) {
      const end = at(e)
      if (end !== start)
        doc.update((d) => {
          d.loop = {
            enabled: true,
            startTick: Math.min(start, end),
            endTick: Math.max(start, end),
          }
        })
    }
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
  }
  const cancel = (): void => {
    clearTimeout(hold)
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
}
function anchorX(tick: number): number {
  const a = context.axis.value
  return (
    a.pageOfTick(tick) * a.pageWidth +
    a.xInPage(tick) -
    context.frame.value.offset
  )
}
function referenceId(): string {
  return (
    runtime.selectedAudioId ??
    doc.project.tracks.find((t) => t.kind === 'audio')?.id ??
    ''
  )
}
function removeAnchor(index: number): void {
  if (doc.project.mapOwner !== null) return
  const anchors = doc.project.beatAnchors.filter((_, i) => i !== index)
  if (anchors.length >= 2)
    engineBus.value?.send('grid:apply', { trackId: referenceId(), anchors })
  else
    doc.update((d) => {
      d.beatAnchors = []
    })
}
function dragAnchor(event: PointerEvent, index: number): void {
  if (event.button !== 0 || doc.project.mapOwner !== null) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  let end = event
  const move = (e: PointerEvent): void => {
    end = e
    target.style.transform = `translateX(${e.clientX - event.clientX}px)`
  }
  const cleanup = (): void => {
    target.style.transform = ''
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', cancel)
  }
  const up = (): void => {
    const anchors = doc.project.beatAnchors.map((a) => ({ ...a })),
      track = doc.project.tracks.find((t) => t.id === referenceId())
    if (track?.kind === 'audio') {
      const axis = context.axis.value,
        page = axis.pageOfTick(anchors[index].tick),
        [start, finish] = axis.pageRange(page)
      const targetTick =
        anchors[index].tick +
        ((end.clientX - event.clientX) * (finish - start)) /
          (axis.pageWidth - 96)
      const sec =
        new TimeMap(doc.project).tickToSec(targetTick) - track.offsetSec
      anchors[index].sec = Math.max(
        (anchors[index - 1]?.sec ?? -0.001) + 0.001,
        Math.min((anchors[index + 1]?.sec ?? Infinity) - 0.001, sec),
      )
      engineBus.value?.send('grid:apply', { trackId: track.id, anchors })
    }
    cleanup()
  }
  const cancel = (): void => cleanup()
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', cancel)
}
</script>
<template>
  <div class="xm-rowgrid xm-ruler">
    <div class="xm-corner">
      <BarGridTools />

      <Teleport to="body">
        <form
          v-if="menu"
          class="bar-edit-menu"
          :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
          @submit.prevent="applyEdit"
          @keydown.esc="menu = undefined"
        >
          <strong>Bar {{ menu.bar }}</strong>
          <select
            v-model="operation"
            aria-label="Measure operation"
          >
            <option value="insertBefore">
              Insert bars before
            </option>
            <option value="insertAfter">
              Insert bars after
            </option>
            <option value="delete">
              Delete bars
            </option>
            <option
              v-if="doc.project.loop.enabled"
              value="loop"
            >
              Delete loop range bars
            </option>
            <option value="signature">
              Time signature from here
            </option>
            <option value="tempo">
              Tempo from here
            </option>
          </select>
          <label v-if="operation === 'tempo'">BPM <input
            v-model.number="bpm"
            type="number"
            min="1"
            required
          ></label>
          <label v-else-if="operation === 'signature'">Signature
            <input
              v-model.number="numerator"
              type="number"
              min="1"
              max="32"
              required
            >
            /
            <select v-model.number="denominator">
              <option
                v-for="d in [1, 2, 4, 8, 16, 32]"
                :key="d"
              >
                {{ d }}
              </option>
            </select></label>
          <label v-else-if="operation !== 'loop'">Bars <input
            v-model.number="count"
            type="number"
            min="1"
            required
          ></label>
          <div>
            <button type="submit">
              Apply
            </button>
            <button
              type="button"
              @click="menu = undefined"
            >
              Cancel
            </button>
          </div>
          <span role="status">{{ message }}</span>
        </form>
        <button
          v-else-if="message"
          class="bar-edit-menu"
          style="bottom: 1rem; right: 1rem"
          @click="message = ''"
        >
          {{ message }} ×
        </button>
      </Teleport>
    </div>
    <div
      ref="surface"
      class="xm-lanearea xm-ruler-surface"
      title="Drag to seek · Shift-drag to set loop"
      @contextmenu.prevent="openMenu"
      @pointerdown="drag"
    >
      <template
        v-for="m in measures"
        :key="`${m.page}:${m.bar}`"
      >
        <span
          v-for="(x, i) in m.beats"
          :key="i"
          class="xm-ruler-tick"
          :class="{ 'is-bar': i === 0 }"
          :style="{ left: `${x}px` }"
        ><b v-if="i === 0">{{ m.bar }}</b></span>
      </template>
      <button
        v-for="(anchor, index) in doc.project.beatAnchors"
        :key="`anchor-${index}`"
        class="xm-beat-anchor"
        :style="{ left: `${anchorX(anchor.tick)}px` }"
        :title="`Beat anchor ${index + 1} · ${anchor.sec.toFixed(3)} s · drag to adjust, right-click or Delete to remove`"
        :aria-label="`Beat anchor ${index + 1}`"
        @pointerdown.stop="dragAnchor($event, index)"
        @keydown.delete.prevent="removeAnchor(index)"
        @contextmenu.prevent="removeAnchor(index)"
      >
        ◆
      </button>
    </div>
  </div>
</template>

<style scoped>
.bar-edit-menu {
  position: fixed;
  z-index: 1000;
  display: grid;
  gap: 8px;
  padding: 12px;
  background: var(--panel, #20232b);
  color: var(--text, #eee);
  border: 1px solid #555;
  border-radius: 6px;
  max-width: 250px;
}
.bar-edit-menu input {
  width: 64px;
}
</style>
