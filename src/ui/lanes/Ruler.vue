<script setup lang="ts">
defineOptions({ name: 'TimelineRuler' })
import { computed, inject, ref } from 'vue'
import { timelineKey } from '../timeline/context'
import { useRuntimeStore } from '../stores/runtime'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
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
