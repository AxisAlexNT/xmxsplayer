<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { AudioPeaks } from '../../shared/audio'
import { PEAK_FRAMES } from '../../shared/audio'
const props = defineProps<{
  source: AudioPeaks
  start: number
  end: number
  color: string
}>()
const emit = defineEmits<{ change: [start: number, end: number]; commit: [] }>()
const root = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>(),
  left = ref(0),
  right = ref(props.source.durationSec)
const span = computed(() =>
  Math.max(1 / props.source.sampleRate, right.value - left.value),
)
const position = (time: number): number =>
  ((time - left.value) / span.value) * 100
const visible = (time: number): boolean =>
  time >= left.value && time <= right.value
const width = ref(0)
let observer: ResizeObserver | undefined
const drags = new Set<() => void>()
function handleStyle(time: number) {
  const line = (position(time) / 100) * width.value,
    left = Math.max(0, Math.min(width.value - 40, line - 20))
  return { left: `${left}px`, '--handle-line': `${line - left}px` }
}
function view(start: number, duration: number): void {
  const length = Math.min(
    props.source.durationSec,
    Math.max(Math.min(0.01, props.source.durationSec), duration),
  )
  left.value = Math.max(0, Math.min(props.source.durationSec - length, start))
  right.value = left.value + length
}
function fit(): void {
  view(0, props.source.durationSec)
}
function zoom(factor: number, fraction = 0.5): void {
  const anchor = left.value + span.value * fraction
  const next = span.value * factor
  view(anchor - next * fraction, next)
}
function wheel(event: WheelEvent): void {
  if (event.shiftKey)
    view(left.value + (event.deltaY / 800) * span.value, span.value)
  else
    zoom(
      Math.exp(Math.max(-2, Math.min(2, event.deltaY * 0.002))),
      Math.max(
        0,
        Math.min(
          1,
          (event.clientX - root.value!.getBoundingClientRect().left) /
            root.value!.clientWidth,
        ),
      ),
    )
}
function draw(): void {
  const el = canvas.value
  if (!el) return
  const w = el.clientWidth,
    h = el.clientHeight,
    dpr = devicePixelRatio || 1
  width.value = w
  el.width = Math.round(w * dpr)
  el.height = Math.round(h * dpr)
  const c = el.getContext('2d')!
  c.scale(dpr, dpr)
  c.clearRect(0, 0, w, h)
  c.strokeStyle = '#26303c'
  c.fillStyle = '#6b7890'
  c.font = '10px monospace'
  const step =
    10 ** Math.floor(Math.log10(span.value / 6)) *
    (span.value / 6 / 10 ** Math.floor(Math.log10(span.value / 6)) >= 5 ? 5 : 1)
  for (
    let time = Math.ceil(left.value / step) * step;
    time <= right.value;
    time += step
  ) {
    const x = ((time - left.value) / span.value) * w
    c.beginPath()
    c.moveTo(x, 0)
    c.lineTo(x, h)
    c.stroke()
    c.fillText(`${time.toFixed(step < 1 ? 2 : 0)} s`, x + 3, h - 4)
  }
  c.fillStyle = props.color
  c.globalAlpha = 0.65
  for (let x = 0; x < w; x++) {
    const from =
        ((left.value + (x / w) * span.value) * props.source.sampleRate) /
        PEAK_FRAMES,
      to =
        ((left.value + ((x + 1) / w) * span.value) * props.source.sampleRate) /
        PEAK_FRAMES
    let amplitude = 0
    for (
      let i = Math.max(0, Math.floor(from));
      i <= Math.min(props.source.peaks.length - 1, Math.ceil(to));
      i++
    )
      amplitude = Math.max(amplitude, props.source.peaks[i])
    c.fillRect(
      x,
      (h - 16) / 2 - (amplitude * (h - 24)) / 2,
      1,
      Math.max(1, amplitude * (h - 24)),
    )
  }
}
function range(edge: 'start' | 'end', value: number): void {
  const sample = 1 / props.source.sampleRate
  if (edge === 'start')
    emit('change', Math.max(0, Math.min(props.end - sample, value)), props.end)
  else
    emit(
      'change',
      props.start,
      Math.min(props.source.durationSec, Math.max(props.start + sample, value)),
    )
}
function handle(event: PointerEvent, edge: 'start' | 'end'): void {
  if (event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement,
    box = root.value!.getBoundingClientRect()
  target.setPointerCapture(event.pointerId)
  const original = [props.start, props.end] as const
  const move = (e: PointerEvent): void => {
    if (e.pointerId === event.pointerId)
      range(
        edge,
        left.value + ((e.clientX - box.left) / box.width) * span.value,
      )
  }
  const cleanup = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    drags.delete(cleanup)
  }
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    cleanup()
    emit('commit')
  }
  const cancel = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    cleanup()
    emit('change', ...original)
  }
  drags.add(cleanup)
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
}
function key(event: KeyboardEvent, edge: 'start' | 'end'): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  range(
    edge,
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.source.durationSec
        : (edge === 'start' ? props.start : props.end) +
          (event.key === 'ArrowRight' ? 1 : -1) *
            (event.shiftKey ? 0.01 : 0.001),
  )
  emit('commit')
}
const points = new Map<number, number>()
let gesture = { distance: 0, center: 0, start: 0, length: 0 }
function begin(event: PointerEvent): void {
  if (event.button !== 0) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  points.set(event.pointerId, event.clientX)
  const values = [...points.values()]
  gesture = {
    distance: values.length > 1 ? Math.abs(values[0] - values[1]) : 0,
    center: values.reduce((sum, x) => sum + x, 0) / values.length,
    start: left.value,
    length: span.value,
  }
}
function pan(event: PointerEvent): void {
  if (!points.has(event.pointerId)) return
  points.set(event.pointerId, event.clientX)
  const values = [...points.values()],
    center = values.reduce((sum, x) => sum + x, 0) / values.length,
    box = root.value!.getBoundingClientRect()
  const next =
    values.length > 1 && gesture.distance
      ? (gesture.length * gesture.distance) /
        Math.max(1, Math.abs(values[0] - values[1]))
      : gesture.length
  const fraction = (gesture.center - box.left) / box.width
  view(
    gesture.start +
      gesture.length * fraction -
      next * fraction -
      ((center - gesture.center) / box.width) * next,
    next,
  )
}
function endGesture(event: PointerEvent): void {
  points.delete(event.pointerId)
  if (points.size) {
    const x = [...points.values()][0]
    gesture = { distance: 0, center: x, start: left.value, length: span.value }
  }
}
watch(() => props.source, fit)
watch(() => [left.value, right.value, props.source, props.color], draw, {
  flush: 'post',
})
onMounted(() => {
  observer = new ResizeObserver(draw)
  observer.observe(canvas.value!)
  draw()
})
onUnmounted(() => {
  observer?.disconnect()
  for (const cleanup of [...drags]) cleanup()
})
</script>
<template>
  <div
    ref="root"
    class="clipwave xm-clip-wave"
    :style="{ '--c': color }"
    @wheel.prevent="wheel"
  >
    <canvas
      ref="canvas"
      :aria-label="t('clipWave.clipSourceWaveformDragToPanWheelOrPinchTo')"
      @pointerdown="begin"
      @pointermove="pan"
      @pointerup="endGesture"
      @pointercancel="endGesture"
    />
    <div
      class="xm-clip-selection"
      :style="{
        left: `${position(start)}%`,
        width: `${position(end) - position(start)}%`,
      }"
    />
    <button
      v-if="visible(start)"
      class="xm-clip-handle is-start"
      :style="handleStyle(start)"
      role="slider"
      :aria-label="t('clipWave.clipStartHandle')"
      :aria-valuenow="start"
      :aria-valuemin="0"
      :aria-valuemax="end"
      @pointerdown.stop="handle($event, 'start')"
      @keydown="key($event, 'start')"
    >
      <span />
    </button>
    <button
      v-if="visible(end)"
      class="xm-clip-handle is-end"
      :style="handleStyle(end)"
      role="slider"
      :aria-label="t('clipWave.clipEndHandle')"
      :aria-valuenow="end"
      :aria-valuemin="start"
      :aria-valuemax="source.durationSec"
      @pointerdown.stop="handle($event, 'end')"
      @keydown="key($event, 'end')"
    >
      <span />
    </button>
  </div>
  <div class="xm-row xm-clip-wave-tools">
    <small class="xm-faint flex-grow-1">{{ t('clipWave.dragEdgesScrollOrPinchToZoomDragBackgroundTo') }}</small><button
      class="btn btn-sm btn-ghost"
      :aria-label="t('clipWave.zoomWaveformOut')"
      @click="zoom(2)"
    >
      −
    </button><button
      class="btn btn-sm btn-ghost"
      :aria-label="t('clipWave.zoomWaveformIn')"
      @click="zoom(0.5)"
    >
      +
    </button><button
      class="btn btn-sm btn-ghost"
      @click="fit"
    >
      {{ t('clipWave.fit') }}
    </button>
  </div>
</template>
