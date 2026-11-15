<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch, computed } from 'vue'
import type { MidiTrack } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
const props = defineProps<{ track: MidiTrack; height: number }>(),
  context = inject(timelineKey)!,
  doc = useProjectStore(),
  runtime = useRuntimeStore()
const canvas = ref<HTMLCanvasElement>()
let observer: IntersectionObserver | undefined,
  visible = true
const range = computed(() => {
  const keys = props.track.notes.map((n) => n[2])
  if (!keys.length) return [48, 72]
  const lo = Math.max(0, keys.reduce((a, b) => Math.min(a, b), 127) - 2),
    hi = Math.min(127, keys.reduce((a, b) => Math.max(a, b), 0) + 2)
  return hi - lo < 12 ? [Math.max(0, lo - 5), Math.min(127, hi + 5)] : [lo, hi]
})
let backgrounds = new Map<number, HTMLCanvasElement>()
let previousAxis = context.axis.value,
  previousTrack = props.track,
  previousHeight = 0
function draw(): void {
  if (!visible || !canvas.value) return
  const el = canvas.value,
    axis = context.axis.value,
    frame = context.frame.value,
    dpr = window.devicePixelRatio || 1,
    w = axis.pageWidth,
    h = props.height
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
  }
  const ctx = el.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (
    previousAxis !== axis ||
    previousTrack !== props.track ||
    previousHeight !== h
  ) {
    backgrounds.clear()
    previousAxis = axis
    previousTrack = props.track
    previousHeight = h
  }
  const [lo, hi] = range.value,
    row = h / (hi - lo + 1)
  for (const page of frame.pages) {
    const origin = page * w - frame.offset
    let image = backgrounds.get(page)
    if (!image) {
      image = document.createElement('canvas')
      image.width = Math.round(w * dpr)
      image.height = Math.round(h * dpr)
      const c = image.getContext('2d')!
      c.scale(dpr, dpr)
      for (let key = lo; key <= hi; key++) {
        const y = (hi - key) * row
        c.fillStyle = [1, 3, 6, 8, 10].includes(key % 12)
          ? '#14202a'
          : '#172530'
        c.fillRect(0, y, w, row)
        c.strokeStyle = '#1c2d38'
        c.beginPath()
        c.moveTo(96, y)
        c.lineTo(w, y)
        c.stroke()
        if (key % 12 === 0) {
          c.fillStyle = '#8796a5'
          c.font = '10px Inter'
          c.fillText(
            `C${Math.floor(key / 12) - 1}`,
            45,
            y + Math.min(row - 1, 11),
          )
        }
      }
      const [start, end] = axis.pageRange(page),
        map = new TimeMap(doc.project)
      for (const measure of map.measures(start, end))
        for (let i = 0; i < measure.beats.length; i++) {
          const x = axis.xInPage(measure.beats[i], page)
          c.strokeStyle = i === 0 ? '#34434f' : '#21323e'
          c.beginPath()
          c.moveTo(x, 0)
          c.lineTo(x, h)
          c.stroke()
        }
      c.save()
      c.beginPath()
      c.rect(96, 0, w - 96, h)
      c.clip()
      for (const note of props.track.notes) {
        if (note[0] >= end || note[0] + note[1] <= start) continue
        const x = axis.xInPage(Math.max(start, note[0]), page),
          right = axis.xInPage(Math.min(end, note[0] + note[1]), page),
          y = (hi - note[2]) * row + 1
        c.globalAlpha = 0.75
        c.fillStyle = props.track.color
        c.strokeStyle = props.track.color
        if (props.track.mode === 'live')
          c.strokeRect(x, y, Math.max(2, right - x - 1), Math.max(2, row - 2))
        else c.fillRect(x, y, Math.max(2, right - x - 1), Math.max(2, row - 2))
      }
      c.restore()
      backgrounds.set(page, image)
      for (const cached of backgrounds.keys())
        if (!frame.pages.includes(cached)) backgrounds.delete(cached)
    }
    ctx.drawImage(image, origin, 0, w, h)
    if (props.track.mode !== 'mute' && (runtime.transport.playing || props.track.mode === 'live')) {
      const [start, end] = axis.pageRange(page)
      ctx.save()
      ctx.beginPath()
      ctx.rect(origin + 96, 0, w - 96, h)
      ctx.clip()
      for (const note of props.track.notes) {
        if (
          (props.track.mode === 'live' ? !runtime.heldKeys.some(held => held.key === note[2] && held.trackIds.includes(props.track.id)) : note[0] > frame.tick || note[0] + note[1] <= frame.tick) ||
          note[0] >= end ||
          note[0] + note[1] <= start
        )
          continue
        const x = origin + axis.xInPage(Math.max(start, note[0]), page),
          right = origin + axis.xInPage(Math.min(end, note[0] + note[1]), page)
        ctx.strokeStyle = '#eef9ff'
        ctx.shadowColor = props.track.color
        ctx.shadowBlur = 9
        ctx.strokeRect(
          x,
          (hi - note[2]) * row + 1,
          Math.max(2, right - x - 1),
          Math.max(2, row - 2),
        )
      }
      ctx.restore()
    }
  }
}
watch(() => context.frame.value, draw, { flush: 'post' })
onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting
    if (visible) draw()
  })
  observer.observe(canvas.value!)
  draw()
})
onUnmounted(() => observer?.disconnect())
</script>
<template>
  <div
    class="xm-lane"
    :class="{ 'is-muted': track.mode === 'mute' }"
  >
    <canvas
      ref="canvas"
      class="xm-roll-canvas"
      :aria-label="`${track.name} piano roll`"
    /><span
      v-if="
        doc.project.view.lanes === 'staff' ||
          (doc.project.view.lanes === 'per-track' && track.view === 'staff')
      "
      class="xm-roll-label"
    >Piano roll · Staff view coming later</span>
  </div>
</template>
