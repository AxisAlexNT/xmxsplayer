<script setup lang="ts">
import { useI18n } from '../i18n'
const { t } = useI18n()
import {
  inject,
  onMounted,
  onUnmounted,
  ref,
  watch,
  computed,
  shallowRef,
} from 'vue'
import { useEditorStore } from '../stores/editor'
import {
  createNote,
  moveNotes,
  resizeNotes,
  velocityNotes,
  deleteNotes,
  marquee,
  snapOptions,
  type EditResult,
} from './roll-edit'
import type { MidiTrack, Note } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
const props = defineProps<{ track: MidiTrack; height: number }>(),
  context = inject(timelineKey)!,
  doc = useProjectStore(),
  runtime = useRuntimeStore(),
  editor = useEditorStore(),
  pitchView = ref<[number, number] | null>(null),
  preview = shallowRef<EditResult | null>(null)
const canvas = ref<HTMLCanvasElement>()
let observer: IntersectionObserver | undefined,
  visible = true
const autoRange = computed(() => {
  const keys = props.track.notes.map((n) => n[2])
  const live = runtime.liveTake?.tracks.find(t => t.trackId === props.track.id)
  if (live) {
    for (const note of live.closed) keys.push(note[2])
    for (const note of live.open) keys.push(note.key)
  }
  if (!keys.length) return [48, 72]
  const lo = Math.max(0, keys.reduce((a, b) => Math.min(a, b), 127) - 2),
    hi = Math.min(127, keys.reduce((a, b) => Math.max(a, b), 0) + 2)
  return hi - lo < 12 ? [Math.max(0, lo - 5), Math.min(127, hi + 5)] : [lo, hi]
})
const range = computed(() => pitchView.value ?? autoRange.value)
const displayNotes = computed(() => preview.value?.notes ?? props.track.notes)
const selectedNotes = computed(
  () =>
    preview.value?.selection ??
    (editor.selection.trackId === props.track.id ? editor.selected : []),
)
let backgrounds = new Map<number, HTMLCanvasElement>()
let previousAxis = context.axis.value,
  previousTrack = props.track,
  previousHeight = 0
let previousNotes: readonly Note[] | undefined,
  previousRange: readonly number[] | undefined
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
    (props.track.armed && !!runtime.transport.covered) ||
    previousAxis !== axis ||
    previousTrack !== props.track ||
    previousHeight !== h ||
    previousNotes !== displayNotes.value ||
    previousRange !== range.value
  ) {
    backgrounds.clear()
    previousAxis = axis
    previousTrack = props.track
    previousHeight = h
    previousNotes = displayNotes.value
    previousRange = range.value
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
      for (const measure of (axis.measures?.(page)??map.measures(start, end)))
        for (let i = 0; i < measure.beats.length; i++) {
          const x = (i===0 ? axis.measureX?.(measure.start,page)??axis.xInPage(measure.start,page) : axis.xInPage(measure.beats[i],page))
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
      for (const note of displayNotes.value) {
        if (note[0] >= end || note[0] + note[1] <= start) continue
        const x = axis.xInPage(Math.max(start, note[0]), page),
          right = axis.xInPage(Math.min(end, note[0] + note[1]), page),
          y = (hi - note[2]) * row + 1
        c.globalAlpha = props.track.armed && runtime.transport.covered?.some(([start,end]) => note[0]>=start && note[0]<end) ? 0.25 : 0.75
        c.fillStyle = props.track.color
        c.strokeStyle = props.track.color
        if (props.track.mode === 'live')
          c.strokeRect(x, y, Math.max(2, right - x - 1), Math.max(2, row - 2))
        else c.fillRect(x, y, Math.max(2, right - x - 1), Math.max(2, row - 2))
      }
      c.restore()
      if (!(props.track.armed && runtime.transport.covered)) backgrounds.set(page, image)
      for (const cached of backgrounds.keys())
        if (!frame.pages.includes(cached)) backgrounds.delete(cached)
    }
    ctx.drawImage(image, origin, 0, w, h)
    if (
      props.track.mode !== 'mute' &&
      (runtime.transport.playing || props.track.mode === 'live')
    ) {
      const [start, end] = axis.pageRange(page)
      ctx.save()
      ctx.beginPath()
      ctx.rect(origin + 96, 0, w - 96, h)
      ctx.clip()
      for (const note of displayNotes.value) {
        if (
          (props.track.mode === 'live'
            ? !runtime.heldKeys.some(
                (held) =>
                  held.key === note[2] &&
                  held.trackIds.includes(props.track.id),
              )
            : note[0] > frame.tick || note[0] + note[1] <= frame.tick) ||
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
    const expected = runtime.state.expectedNext
    if (expected?.notes) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(origin + 96, 0, w - 96, h)
      ctx.clip()
      ctx.strokeStyle = '#ffb020'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      for (const target of expected.notes.filter(
        (n) => n.trackId === props.track.id,
      )) {
        const note = displayNotes.value.find(
          (n) => n[0] === target.tick && n[2] === target.key,
        )
        if (!note) continue
        const r = rectangle(note, page)
        if (r) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4)
      }
      ctx.restore()
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(origin + 96, 0, w - 96, h)
    ctx.clip()
    const live = runtime.liveTake?.tracks.find(t => t.trackId === props.track.id)
    if (live) {
      ctx.fillStyle = props.track.color
      for (const note of live.closed) {
        const r = rectangle(note, page)
        if (r) ctx.fillRect(r.x, r.y, r.w, r.h)
      }
      for (const note of live.open) {
        const r = rectangle([note.tick, Math.max(1, frame.tick - note.tick), note.key, note.vel], page)
        if (!r) continue
        ctx.strokeStyle = props.track.color
        ctx.strokeRect(r.x, r.y, r.w, r.h)
        ctx.fillStyle = '#ff5268'
        ctx.fillRect(r.x + r.w - 2, r.y, 2, r.h)
      }
    }
    for (const note of selectedNotes.value) {
      const r = rectangle(note, page)
      if (!r) continue
      ctx.strokeStyle = '#eef9ff'
      ctx.lineWidth = 1.5
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.fillStyle = '#eef9ff'
      ctx.fillRect(r.x, r.y + r.h / 2 - 6, 12, 12)
      ctx.fillRect(r.x + r.w - 12, r.y + r.h / 2 - 6, 12, 12)
    }
    ctx.restore()
  }
  if (stroke?.kind === 'marquee') {
    const a = stroke.first,
      b = stroke.last
    ctx.fillStyle = '#4cc2ff22'
    ctx.strokeStyle = '#4cc2ff'
    ctx.fillRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
    )
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
    )
  }
}
interface Point {
  x: number
  y: number
  tick: number
  key: number
}
interface Stroke {
  kind: 'draw' | 'move' | 'start' | 'end' | 'velocity' | 'marquee' | 'erase'
  first: Point
  last: Point
  base: Note[]
  chosen: Note[]
  erased: Set<Note>
  velocity: number
  moved: boolean
}
let stroke: Stroke | undefined,
  pointers = new Map<number, { x: number; y: number; kind: string }>(),
  gesture:
    | {
        distance: number
        range: number[]
        pitch: number
        tick: number
        px: number
      }
    | undefined,
  gesturing = false,
  lastKey = -1
function point(event: PointerEvent): Point {
  const rect = canvas.value!.getBoundingClientRect(),
    x = event.clientX - rect.left,
    y = event.clientY - rect.top,
    a = context.axis.value,
    global = x + context.frame.value.offset,
    page = Math.max(
      0,
      Math.min(a.pageCount - 1, Math.floor(global / a.pageWidth)),
    ),
    [lo, hi] = range.value
  return {
    x,
    y,
    tick: a.tickAt(page, global - page * a.pageWidth),
    key: Math.max(
      0,
      Math.min(127, hi - Math.floor((y / props.height) * (hi - lo + 1))),
    ),
  }
}
function rectangle(
  note: Note,
  page: number,
): { x: number; y: number; w: number; h: number } | null {
  const a = context.axis.value,
    [start, end] = a.pageRange(page)
  if (note[0] >= end || note[0] + note[1] <= start) return null
  const [lo, hi] = range.value,
    row = props.height / (hi - lo + 1),
    x =
      page * a.pageWidth +
      a.xInPage(Math.max(start, note[0]), page) -
      context.frame.value.offset,
    right =
      page * a.pageWidth +
      a.xInPage(Math.min(end, note[0] + note[1]), page) -
      context.frame.value.offset
  return {
    x,
    y: (hi - note[2]) * row + 1,
    w: Math.max(2, right - x - 1),
    h: Math.max(2, row - 2),
  }
}
function hit(
  p: Point,
  notes: readonly Note[] = displayNotes.value,
): { note: Note; edge?: 'start' | 'end' } | undefined {
  for (const n of [...selectedNotes.value].reverse())
    for (const page of context.frame.value.pages) {
      const r = rectangle(n, page)
      if (!r || Math.abs(p.y - r.y - r.h / 2) > 6) continue
      const left = p.x >= r.x && p.x <= r.x + 12,
        right = p.x >= r.x + r.w - 12 && p.x <= r.x + r.w
      if (left || right)
        return {
          note: n,
          edge:
            left && (!right || Math.abs(p.x - r.x) < Math.abs(p.x - r.x - r.w))
              ? 'start'
              : 'end',
        }
    }
  for (let i = notes.length - 1; i >= 0; i--)
    for (const page of context.frame.value.pages) {
      const n = notes[i],
        r = rectangle(n, page)
      if (
        r &&
        p.x >= r.x &&
        p.x <= r.x + r.w &&
        p.y >= r.y - 2 &&
        p.y <= r.y + r.h + 2
      )
        return { note: n }
    }
}
function audition(note: Note): void {
  if (lastKey !== note[2]) {
    lastKey = note[2]
    editor.audition(props.track.id, note[2], note[3])
  }
}
function down(event: PointerEvent): void {
  if (event.shiftKey) return
  if (
    event.pointerType === 'touch' &&
    [...pointers.values()].some((p) => p.kind === 'pen')
  )
    return
  if (
    event.button !== 0 &&
    !(event.pointerType === 'pen' && (event.button === 5 || event.buttons & 32))
  )
    return
  event.preventDefault()
  canvas.value!.focus({ preventScroll: true })
  canvas.value!.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    kind: event.pointerType,
  })
  editor.activate(props.track.id)
  context.navigation.freeze()
  if (pointers.size === 2) {
    preview.value = null
    stroke = undefined
    editor.stopAudition()
    const [a, b] = [...pointers.values()],
      rect = canvas.value!.getBoundingClientRect(),
      cx = (a.x + b.x) / 2 - rect.left,
      cy = (a.y + b.y) / 2 - rect.top,
      axis = context.axis.value,
      global = cx + context.frame.value.offset,
      page = Math.max(
        0,
        Math.min(axis.pageCount - 1, Math.floor(global / axis.pageWidth)),
      ),
      [lo, hi] = range.value
    gesture = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      range: [lo, hi],
      pitch: hi - (cy / props.height) * (hi - lo + 1),
      tick: axis.tickAt(page, global - page * axis.pageWidth),
      px: doc.project.view.pxPerQuarter,
    }
    gesturing = true
    return
  }
  if (gesturing || pointers.size > 1) return
  const first = point(event)
  if (first.x < 96) return
  pitchView.value = [...range.value] as [number, number]
  const found = hit(first),
    base = props.track.notes,
    lastSelected =
      editor.selection.trackId === props.track.id ? editor.selected : [],
    erase =
      editor.tool === 'erase' ||
      (event.pointerType === 'pen' &&
        (event.button === 5 || !!(event.buttons & 32)))
  lastKey = -1
  let kind: Stroke['kind'] = 'marquee',
    chosen = [...lastSelected]
  if (erase) kind = 'erase'
  else if (found) {
    if (event.ctrlKey || event.metaKey) {
      chosen = lastSelected.includes(found.note)
        ? lastSelected.filter((n) => n !== found.note)
        : [...lastSelected, found.note]
      editor.select(props.track.id, chosen)
      return
    }
    if (!lastSelected.includes(found.note)) chosen = [found.note]
    editor.select(props.track.id, chosen)
    kind = event.altKey ? 'velocity' : (found.edge ?? 'move')
    audition(found.note)
  } else if (editor.tool === 'draw') {
    kind = 'draw'
    chosen = []
    editor.select(props.track.id, [])
  } else if (!event.ctrlKey && !event.metaKey) {
    chosen = []
    editor.select(props.track.id, [])
  }
  stroke = {
    kind,
    first,
    last: first,
    base,
    chosen,
    erased: new Set(found && erase ? [found.note] : []),
    velocity:
      event.pointerType === 'pen'
        ? Math.max(1, Math.round((event.pressure || 0.5) * 127))
        : 100,
    moved: false,
  }
  if (kind === 'draw') {
    const end = editor.snap
      ? Math.floor(first.tick / editor.snap) * editor.snap + editor.snap
      : first.tick + 120
    preview.value = createNote(
      base,
      first.tick,
      end,
      first.key,
      stroke.velocity,
      editor.snap,
    )
    audition(preview.value.selection[0])
  } else if (kind === 'erase')
    preview.value = deleteNotes(base, [...stroke.erased])
}
function move(event: PointerEvent): void {
  const pointer = pointers.get(event.pointerId)
  if (!pointer) return
  pointer.x = event.clientX
  pointer.y = event.clientY
  if (gesturing && gesture && pointers.size >= 2) {
    const [a, b] = [...pointers.values()],
      rect = canvas.value!.getBoundingClientRect(),
      ratio = Math.max(
        0.25,
        Math.min(
          4,
          Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesture.distance),
        ),
      ),
      cx = (a.x + b.x) / 2 - rect.left,
      cy = (a.y + b.y) / 2 - rect.top,
      span = Math.max(
        8,
        Math.min(
          128,
          Math.round((gesture.range[1] - gesture.range[0] + 1) / ratio),
        ),
      ),
      high = gesture.pitch + (cy / props.height) * span,
      low = Math.max(0, Math.min(128 - span, Math.round(high - span + 1)))
    pitchView.value = [low, low + span - 1]
    context.navigation.previewZoom(gesture.px * ratio, gesture.tick, cx)
    return
  }
  if (!stroke) return
  const p = point(event),
    s = stroke
  s.last = p
  s.moved ||= Math.hypot(p.x - s.first.x, p.y - s.first.y) > 2
  if (s.kind === 'draw' && s.moved) {
    if (event.pointerType === 'pen')
      s.velocity = Math.max(s.velocity, Math.round(event.pressure * 127))
    preview.value = createNote(
      s.base,
      s.first.tick,
      p.tick,
      p.key,
      s.velocity,
      editor.snap,
    )
    audition(preview.value.selection[0])
  } else if (s.kind === 'move') {
    preview.value = moveNotes(
      s.base,
      s.chosen,
      p.tick - s.first.tick,
      p.key - s.first.key,
      editor.snap,
    )
    if (preview.value.selection[0]) audition(preview.value.selection[0])
  } else if (s.kind === 'start' || s.kind === 'end')
    preview.value = resizeNotes(
      s.base,
      s.chosen,
      p.tick - s.first.tick,
      s.kind,
      editor.snap,
    )
  else if (s.kind === 'velocity')
    preview.value = velocityNotes(s.base, s.chosen, s.first.y - p.y)
  else if (s.kind === 'erase') {
    const found = hit(p, preview.value?.notes ?? s.base)
    if (found) s.erased.add(found.note)
    preview.value = deleteNotes(s.base, [...s.erased])
  } else if (s.kind === 'marquee')
    editor.select(props.track.id, [
      ...new Set([
        ...s.chosen,
        ...marquee(s.base, s.first.tick, p.tick, s.first.key, p.key),
      ]),
    ])
}
function up(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return
  move(event)
  pointers.delete(event.pointerId)
  if (gesturing) {
    if (pointers.size < 2 && gesture) {
      context.navigation.commitZoom()
      gesture = undefined
    }
    if (!pointers.size) gesturing = false
    return
  }
  if (preview.value) editor.commit(props.track.id, preview.value)
  preview.value = null
  stroke = undefined
}
function cancel(): void {
  pointers.clear()
  preview.value = null
  stroke = undefined
  gesturing = false
  gesture = undefined
  context.navigation.cancelZoom()
  editor.stopAudition()
}
function wheel(event: WheelEvent): void {
  if (event.shiftKey && !event.ctrlKey) {
    event.preventDefault()
    event.stopPropagation()
    context.navigation.pan(event.deltaY || event.deltaX)
  }
}
watch(
  () => props.track.notes,
  (notes) => {
    if (stroke && notes !== stroke.base) {
      cancel()
      editor.notice = {
        text: 'Notes changed during the edit; gesture cancelled',
      }
    }
  },
)
watch(() => context.frame.value, draw, { flush: 'post' })
watch(() => runtime.state.expectedNext, draw, { flush: 'post' })
onMounted(() => {
  window.addEventListener('blur', cancel)
  observer = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting
    if (visible) draw()
  })
  observer.observe(canvas.value!)
  draw()
})
onUnmounted(() => {
  window.removeEventListener('blur', cancel)
  observer?.disconnect()
  if (editor.activeTrackId === props.track.id) cancel()
})
</script>
<template>
  <div
    class="xm-lane"
    :class="{ 'is-muted': track.mode === 'mute' }"
  >
    <canvas
      ref="canvas"
      class="xm-roll-canvas xm-roll-editor"
      tabindex="0"
      :aria-label="`${track.name} piano roll`"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up"
      @pointercancel="cancel"
      @lostpointercapture="stroke && cancel()"
      @wheel="wheel"
    />
    <div
      v-if="editor.activeTrackId === track.id"
      class="xm-lane-tools xm-roll-tools"
      role="toolbar"
      :aria-label="`${track.name} editing tools`"
      @pointerdown.stop
    >
      <button
        v-for="mode in ['select', 'draw', 'erase'] as const"
        :key="mode"
        :class="{ 'is-on': editor.tool === mode }"
        :aria-pressed="editor.tool === mode"
        :aria-label="`${mode[0].toUpperCase() + mode.slice(1)} notes`"
        :title="`${mode[0].toUpperCase() + mode.slice(1)} notes`"
        @click="editor.tool = mode"
      >
        <i
          :class="`bi bi-${{ select: 'cursor', draw: 'pencil', erase: 'eraser' }[mode]}`"
        />
      </button>
      <select
        v-model.number="editor.snap"
        :aria-label="`${track.name} snap grid`"
        :title="t('timeline.snapGrid')"
      >
        <option
          v-for="[label, ticks] in snapOptions"
          :key="ticks"
          :value="ticks"
        >
          {{ label }}
        </option>
      </select>
      <button
        :aria-label="t('timeline.quantizeNotes')"
        :title="t('timeline.quantizeSelectionOrLastTake')"
        @click="editor.quantize()"
      >
        <i class="bi bi-grid-3x2" />
      </button>
      <output
        v-if="selectedNotes.length"
        class="xm-editor-count"
      >{{
        selectedNotes.length === 1
          ? `v${selectedNotes[0][3]}`
          : `${selectedNotes.length} selected`
      }}</output>
    </div>
    <span
      v-if="
        doc.project.view.lanes === 'staff' ||
          (doc.project.view.lanes === 'per-track' && track.view === 'staff')
      "
      class="xm-roll-label"
      :style="
        editor.activeTrackId === track.id ? { top: 'auto', bottom: '6px' } : {}
      "
    >{{ t('timeline.pianoRollStaffViewComingLater') }}</span>
  </div>
</template>
