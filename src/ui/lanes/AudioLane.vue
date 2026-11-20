<script setup lang="ts">
import {
  computed,
  shallowRef,
  inject,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue'
import type { AudioTrack } from '../../shared/model'
import { readSpectrum, spectrumFrame } from '../../shared/spectrum'
import { noteName } from '../../shared/schema'
import { engineBus } from '../bus'
import { PEAK_FRAMES } from '../../shared/audio'
import { TimeMap } from '../../shared/time-map'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
const props = defineProps<{ track: AudioTrack; height: number }>(),
  doc = useProjectStore(),
  runtime = useRuntimeStore(),
  timeline = inject(timelineKey)!,
  canvas = ref<HTMLCanvasElement>(),
  previewOffset = ref<number | null>(null)
const offset = computed(() => previewOffset.value ?? props.track.offsetSec),
  error = computed(() => runtime.audioStates[props.track.id]?.error)
let previousAxis: unknown
let visible = true,
  observer: IntersectionObserver | undefined,
  cache = new Map<number, HTMLCanvasElement>(),
  key = ''
const spectrum = shallowRef<ReturnType<typeof readSpectrum>>()
const status = ref(''),
  hover = ref('')
const overlay = computed(() =>
  doc.project.tracks.find(
    (t) => t.kind === 'midi' && t.id === props.track.spectrum?.overlayTrackId,
  ),
)
const limits = computed(() => {
  const t = overlay.value
  if (!props.track.spectrum?.pitchAligned || t?.kind !== 'midi')
    return [21, 108]
  if (!t.notes.length) return [48, 72]
  let lo = 127,
    hi = 0
  for (const n of t.notes) {
    lo = Math.min(lo, n[2])
    hi = Math.max(hi, n[2])
  }
  lo = Math.max(0, lo - 2)
  hi = Math.min(127, hi + 2)
  return hi - lo < 12 ? [Math.max(0, lo - 5), Math.min(127, hi + 5)] : [lo, hi]
})
watch(
  [
    () => props.track.display !== 'wave' && !!props.track.display,
    () => props.track.file,
    () => props.track.channelMode,
    () => runtime.audioPeaks[props.track.id]?.key,
    engineBus,
    () => doc.folder,
  ] as const,
  async ([enabled, file, mode, key, bus], _, onCleanup) => {
    let live = true
    const off = bus?.on('audio:spectrumProgress', (e) => {
      if (live && e.trackId === props.track.id)
        status.value = 'Spectrum ' + Math.round(e.fraction * 100) + '%'
    })
    onCleanup(() => {
      live = false
      off?.()
    })
    spectrum.value = undefined
    status.value = ''
    if (!enabled || !key || !bus) return
    const rate = runtime.audioPeaks[props.track.id].sampleRate
    try {
      status.value = 'Loading spectrum…'
      let buffer = await window.xm.project.spectrumCache(file, key, rate, mode)
      if (!live) return
      if (!buffer) {
        buffer = await bus.request(
          'audio:spectrum',
          { trackId: props.track.id },
          180000,
        )
        if (!live) return
        await window.xm.project.spectrumCache(file, key, rate, mode, buffer)
      }
      if (live) {
        spectrum.value = readSpectrum(buffer)
        status.value = ''
        cache.clear()
        draw()
      }
    } catch (e) {
      if (live) status.value = String(e)
    }
  },
  { immediate: true },
)
const palette = (value: number, gray: boolean) => {
  if (gray) return [value, value, value]
  const stops = [
    [0, 0, 4],
    [43, 16, 83],
    [114, 31, 129],
    [190, 56, 97],
    [249, 123, 61],
    [252, 253, 191],
  ]
  const pos = (value / 255) * 5,
    i = Math.min(4, Math.floor(pos)),
    f = pos - i
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f))
}
function spectralPage(
  c: CanvasRenderingContext2D,
  page: number,
  w: number,
  h: number,
  map: TimeMap,
) {
  const data = spectrum.value
  if (!data || w <= 96) return
  const axis = timeline.axis.value,
    opts = props.track.spectrum,
    floor = opts?.floorDb ?? -90,
    gain = opts?.gain ?? 0
  const top = props.track.display === 'both' ? Math.round(h / 4) : 0,
    height = h - top
  const [lo, hi] = limits.value
  const colors = Array.from({ length: 256 }, (_, i) =>
    palette(
      Math.round(
        255 *
          Math.min(
            1,
            Math.max(0, ((i / 255) * 90 - 90 + gain - floor) / -floor),
          ),
      ),
      opts?.palette === 'gray',
    ),
  )
  const img = document.createElement('canvas')
  img.width = Math.ceil(w - 96)
  img.height = height
  const dc = img.getContext('2d')!,
    pix = dc.createImageData(img.width, height)
  const rows = Array.from({ length: height }, (_, y) =>
    Math.round((hi + 0.5 - ((y + 0.5) / height) * (hi - lo + 1) - 21) * 3),
  )
  for (let x = 0; x < img.width; x++) {
    const f=spectrumFrame(map.tickToSec(axis.tickAt(page,x+96)),offset.value,data.sampleRate,data.hop)
    if (f < 0 || f >= data.frames) continue
    for (let y = 0; y < height; y++) {
      const bin = rows[y]
      if (bin < 0 || bin >= data.bins) continue
      const rgb = colors[data.data[f * data.bins + bin]],
        at = 4 * (y * img.width + x)
      pix.data[at] = rgb[0]
      pix.data[at + 1] = rgb[1]
      pix.data[at + 2] = rgb[2]
      pix.data[at + 3] = 255
    }
  }
  dc.putImageData(pix, 0, 0)
  c.drawImage(img, 96, top)
  const row = height / (hi - lo + 1)
  for (let k = lo; k <= hi; k++) {
    const y = top + (hi - k) * row,
      black = [1, 3, 6, 8, 10].includes(k % 12)
    c.fillStyle = black ? '#23303b' : '#b3bfcb'
    c.fillRect(66, y, black ? 18 : 29, Math.max(1, row - 0.4))
    if (k % 12 === 0) {
      c.fillStyle = '#c6d1dc'
      c.font = '10px sans-serif'
      c.fillText(noteName(k), 40, y + 5)
    }
  }
  const [pageStart,pageEnd]=axis.pageRange(page)
  c.strokeStyle='rgba(169,194,216,0.28)'
  for(const measure of axis.measures?.(page) ?? map.measures(pageStart,pageEnd)){
    const x=axis.measureX?.(measure.start,page) ?? axis.xInPage(measure.start,page)
    c.beginPath();c.moveTo(x,top);c.lineTo(x,h);c.stroke()
  }
  const track = overlay.value
  if (track?.kind === 'midi') {
    const [a, b] = axis.pageRange(page)
    c.strokeStyle = track.color
    for (const [tick, dur, k] of track.notes) {
      if (tick >= b || tick + dur <= a || k < lo || k > hi) continue
      const x = axis.xInPage(Math.max(a, tick), page),
        end = axis.xInPage(Math.min(b, tick + dur), page)
      c.strokeRect(
        x,
        top + (hi - k) * row,
        Math.max(1, end - x),
        Math.max(1, row),
      )
    }
  }
}
function pitchAt(e: PointerEvent) {
  if (!props.track.display || props.track.display === 'wave') {
    hover.value = ''
    return
  }
  const rect = canvas.value!.getBoundingClientRect(),
    top = props.track.display === 'both' ? rect.height / 4 : 0
  const y = e.clientY - rect.top - top,
    [lo, hi] = limits.value
  if (y < 0 || y > rect.height - top) {
    hover.value = ''
    return
  }
  const pitch = Math.max(
    lo,
    Math.min(
      hi,
      Math.floor(hi + 1 - (y / (rect.height - top)) * (hi - lo + 1)),
    ),
  )
  hover.value =
    noteName(pitch) +
    ' · ' +
    (440 * 2 ** ((pitch - 69) / 12)).toFixed(1) +
    ' Hz'
}
watch(
  [overlay, () => props.track.display, () => props.track.spectrum],
  () => {
    cache.clear()
    draw()
  },
  { flush: 'post' },
)
function draw(): void {
  if (!visible || !canvas.value) return
  const axis = timeline.axis.value,
    frame = timeline.frame.value,
    w = axis.pageWidth,
    h = props.height,
    dpr = devicePixelRatio || 1,
    el = canvas.value,
    data = runtime.audioPeaks[props.track.id],
    map = new TimeMap(doc.project)
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
  }
  const nextKey = JSON.stringify([
    data?.key,
    w,
    h,
    offset.value,
    doc.project.tempos,
    doc.project.beatAnchors,
    doc.project.timeSigs,
    doc.project.view.pxPerQuarter,
  ])
  if (key !== nextKey || previousAxis !== axis) {
    key = nextKey
    previousAxis = axis
    cache.clear()
  }
  const ctx = el.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  for (const page of frame.pages) {
    let image = cache.get(page)
    if (!image) {
      image = document.createElement('canvas')
      image.width = Math.round(w * dpr)
      image.height = Math.round(h * dpr)
      const c = image.getContext('2d')!
      c.scale(dpr, dpr)
      c.fillStyle = '#13212c'
      c.fillRect(0, 0, w, h)
      const [start, end] = axis.pageRange(page)
      for (const measure of axis.measures?.(page) ?? map.measures(start, end)) {
        const x =
          axis.measureX?.(measure.start, page) ??
          axis.xInPage(measure.start, page)
        c.strokeStyle = '#34434f'
        c.beginPath()
        c.moveTo(x, 0)
        c.lineTo(x, h)
        c.stroke()
      }
      if (props.track.display && props.track.display !== 'wave')
        spectralPage(c, page, w, h, map)
      const waveHeight = props.track.display === 'both' ? h / 4 : h
      if (data && props.track.display !== 'spectrum') {
        c.fillStyle = props.track.color
        c.globalAlpha = 0.55
        for (let x = 96; x < w; x++) {
          const from =
              ((map.tickToSec(axis.tickAt(page, x)) - offset.value) *
                data.sampleRate) /
              PEAK_FRAMES,
            to =
              ((map.tickToSec(axis.tickAt(page, x + 1)) - offset.value) *
                data.sampleRate) /
              PEAK_FRAMES
          if (to < 0 || from >= data.peaks.length) continue
          let amplitude = 0
          for (
            let i = Math.max(0, Math.floor(from));
            i <= Math.min(data.peaks.length - 1, Math.ceil(to));
            i++
          )
            amplitude = Math.max(amplitude, data.peaks[i])
          const a = Math.max(0.5, amplitude * (waveHeight / 2 - 6))
          c.fillRect(x, waveHeight / 2 - a, 1, a * 2)
        }
      }
      cache.set(page, image)
      for (const old of cache.keys())
        if (!frame.pages.includes(old)) cache.delete(old)
    }
    ctx.drawImage(image, page * w - frame.offset, 0, w, h)
  }
}
function tickAt(event: PointerEvent): number {
  const a = timeline.axis.value,
    x =
      event.clientX -
      canvas.value!.getBoundingClientRect().left +
      timeline.frame.value.offset,
    page = Math.max(0, Math.min(a.pageCount - 1, Math.floor(x / a.pageWidth)))
  return a.tickAt(page, x - page * a.pageWidth)
}
function drag(event: PointerEvent): void {
  pitchAt(event)
  if (event.button !== 0 || event.shiftKey) return
  event.preventDefault()
  const target = canvas.value!,
    map = new TimeMap(doc.project),
    start = map.tickToSec(tickAt(event)),
    initial = props.track.offsetSec
  target.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent): void => {
    previewOffset.value = initial + map.tickToSec(tickAt(e)) - start
  }
  const cleanup = (): void => {
    previewOffset.value = null
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', cancel)
  }
  const up = (): void => {
    if (previewOffset.value !== null) {
      const value = previewOffset.value
      doc.update((d) => {
        const t = d.tracks.find((t) => t.id === props.track.id)
        if (t?.kind === 'audio') {
          t.offsetSec = value
          d.lengthTicks = Math.max(
            d.lengthTicks,
            Math.ceil(map.secToTick(value + t.durationSec)),
          )
        }
      })
    }
    cleanup()
  }
  const cancel = (): void => cleanup()
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', cancel)
}
watch(() => timeline.frame.value, draw, { flush: 'post' })
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
  <div class="xm-lane xm-audio-lane">
    <canvas
      ref="canvas"
      class="xm-roll-canvas"
      :aria-label="`${track.name} waveform`"
      title="Drag to move audio · Shift-drag to set loop"
      @pointermove="pitchAt"
      @pointerleave="hover = ''"
      @pointerdown="drag"
    /><span
      v-if="status || hover"
      class="xm-roll-label"
    >{{
      status || hover
    }}</span><span
      v-if="error"
      class="xm-audio-error"
      role="alert"
    >{{ error }}</span><span
      v-else-if="runtime.audioStates[track.id]?.loading"
      class="xm-roll-label"
    >Loading audio…</span><span
      v-if="previewOffset !== null"
      class="xm-roll-label"
    >{{ offset.toFixed(3) }} s</span>
  </div>
</template>
