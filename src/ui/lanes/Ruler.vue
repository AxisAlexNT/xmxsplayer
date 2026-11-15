<script setup lang="ts">
defineOptions({name:'TimelineRuler'})
import { computed, inject, ref } from 'vue'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import { TimeMap } from '../../shared/time-map'
const context = inject(timelineKey)!,
  doc = useProjectStore(),
  surface = ref<HTMLElement>()
const measures = computed(() => {
  const axis = context.axis.value
  const map = new TimeMap(doc.project)
  return context.frame.value.pages.flatMap((page) =>
    map
      .measures(...axis.pageRange(page))
      .map((m) => ({
        ...m,
        page,
        x:
          page * axis.pageWidth +
          axis.xInPage(m.start, page) -
          context.frame.value.offset,
        beats: m.beats.map(
          (t) =>
            page * axis.pageWidth +
            axis.xInPage(t, page) -
            context.frame.value.offset,
        ),
      })),
  )
})
function at(event: PointerEvent): number {
  const axis = context.axis.value,
    x =
      event.clientX -
      surface.value!.getBoundingClientRect().left +
      context.frame.value.offset,
    page = Math.max(
      0,
      Math.min(axis.pageCount - 1, Math.floor(x / axis.pageWidth)),
    )
  return Math.round(axis.tickAt(page, x - page * axis.pageWidth))
}
function drag(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const element = surface.value!
  element.setPointerCapture(event.pointerId)
  const start = at(event),
    looping = event.shiftKey
  if (!looping) engineBus.value?.send('transport:seek', { tick: start })
  const move = (e: PointerEvent): void => {
    if (!looping) engineBus.value?.send('transport:seek', { tick: at(e) })
  }
  const up = (e: PointerEvent): void => {
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
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
}
</script>
<template>
  <div class="xm-rowgrid xm-ruler">
    <div class="xm-corner">
      <i class="bi bi-rulers" /> Bars
    </div>
    <div
      ref="surface"
      class="xm-lanearea xm-ruler-surface"
      title="Drag to seek · Shift-drag to set loop"
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
    </div>
  </div>
</template>
