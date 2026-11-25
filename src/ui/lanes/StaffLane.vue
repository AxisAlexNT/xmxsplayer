<script setup lang="ts">
import { computed, inject } from 'vue'
import type { MidiTrack } from '../../shared/model'
import { notationKey } from '../notation/context'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
const props = defineProps<{ track: MidiTrack; height: number }>(),
  notation = inject(notationKey)!,
  timeline = inject(timelineKey)!,
  doc = useProjectStore()
const staff = computed(
  () => notation.merged.value?.staffTrackIds.indexOf(props.track.id) ?? -1,
)
const pages = computed(() =>
  timeline.frame.value.pages.flatMap((p) => {
    const page = notation.pages.value.get(p),
      clip = page?.clips[staff.value]
    const last =
      page?.clips[
        notation.merged.value?.staffTrackIds.lastIndexOf(props.track.id) ?? -1
      ]
    return page && clip && last
      ? [
          {
            ...page,
            clip: {
              top: clip.top,
              bottom: last.bottom,
              center: (clip.center + last.center) / 2,
            },
            x: p * timeline.axis.value.pageWidth - timeline.frame.value.offset,
          },
        ]
      : []
  }),
)
function seek(event: PointerEvent): void {
  if (event.button !== 0 || event.shiftKey) return
  const surface = event.currentTarget as HTMLElement,
    a = timeline.axis.value,
    x =
      event.clientX -
      surface.getBoundingClientRect().left +
      timeline.frame.value.offset,
    page = Math.max(0, Math.min(a.pageCount - 1, Math.floor(x / a.pageWidth)))
  engineBus.value?.send('transport:seek', {
    tick: Math.round(a.tickAt(page, x - page * a.pageWidth)),
  })
}
</script>
<template>
  <div
    class="xm-lane xm-staff-lane"
    :class="{ 'is-paper': doc.project.view.staffTheme === 'paper' }"
    :aria-label="`${track.name} staff`"
    role="img"
    @pointerdown="seek"
  >
    <svg
      v-for="page in pages"
      :key="page.id"
      class="xm-staff-page"
      :viewBox="`0 ${page.clip.top} ${page.width} ${page.clip.bottom - page.clip.top}`"
      :style="{
        left: `${page.x}px`,
        width: `${page.width}px`,
        height: `${page.clip.bottom - page.clip.top}px`,
        top: `calc(50% - ${page.clip.center - page.clip.top}px)`,
      }"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <use
        :href="`#${page.id}`"
        :width="page.width"
        :height="page.height"
      />
    </svg>
    <span
      v-if="!pages.length"
      class="xm-roll-label"
    >{{
      notation.busy.value ? 'Laying out score…' : 'Loading staff…'
    }}</span>
  </div>
</template>
