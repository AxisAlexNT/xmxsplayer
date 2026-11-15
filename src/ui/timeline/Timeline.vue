<script setup lang="ts">
defineOptions({name:'TrackTimeline'})
import { computed, onMounted, onUnmounted, provide, ref, shallowRef } from 'vue'
import type { Track } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { timelineKey } from './context'
import { LinearAxis } from './linear-axis'
import { transportTick, Viewport, type TimelineFrame } from './viewport'
import Ruler from '../lanes/Ruler.vue'
import PianoRollLane from '../lanes/PianoRollLane.vue'
import ConflictBanner from '../components/ConflictBanner.vue'
const emit = defineEmits<{
  instrument: [id: string]
  command: [cmd: string]
  error: [error: unknown]
}>()
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  root = ref<HTMLElement>(),
  list = ref<HTMLElement>(),
  width = ref(1296),
  overlayTop = ref(56),
  dragOrder = ref<string[] | null>(null),
  heights = ref<Record<string, number>>({})
const map = computed(() => new TimeMap(doc.project)),
  axis = computed(
    () => new LinearAxis(map.value, width.value, doc.project.view.pxPerQuarter),
  )
const frame = shallowRef<TimelineFrame>({
    tick: 0,
    offset: 0,
    headX: 96,
    pages: [0],
    edge: 0,
  }),
  viewport = new Viewport()
provide(timelineKey, { axis, frame })
const tracks = computed(() =>
  dragOrder.value
    ? dragOrder.value.flatMap((id) => {
        const track = doc.project.tracks.find((t) => t.id === id)
        return track ? [track] : []
      })
    : doc.project.tracks,
)
const loops = computed(() => {
  if (!doc.project.loop.enabled) return []
  const a = axis.value,
    l = doc.project.loop
  return frame.value.pages.flatMap((page) => {
    const [start, end] = a.pageRange(page),
      lo = Math.max(start, l.startTick),
      hi = Math.min(end, l.endTick)
    return hi > lo
      ? [
          {
            page,
            left: page * a.pageWidth + a.xInPage(lo, page) - frame.value.offset,
            width: a.xInPage(hi, page) - a.xInPage(lo, page),
          },
        ]
      : []
  })
})
let animation = 0,
  observer: ResizeObserver | undefined
function update(): void {
  const tick = transportTick(
    runtime.transport,
    map.value,
    doc.project.loop,
    performance.timeOrigin + performance.now(),
  )
  frame.value = viewport.frame(
    axis.value,
    tick,
    doc.project.view.follow,
    performance.now(),
    runtime.transport.playing,
  )
  animation = requestAnimationFrame(update)
}
function edit(id: string, change: (track: Track) => void): void {
  doc.update((d) => {
    const t = d.tracks.find((t) => t.id === id)
    if (t) change(t)
  })
}
function mode(track: Track): void {
  edit(track.id, (t) => {
    t.mode = ({ auto: 'live', live: 'mute', mute: 'auto' } as const)[t.mode]
  })
}
function height(track: Track): number {
  return heights.value[track.id] ?? track.height * doc.project.view.laneZoom
}
function reorder(event: PointerEvent, id: string): void {
  if (event.button !== 0) return
  event.preventDefault()
  const target = list.value!
  target.setPointerCapture(event.pointerId)
  dragOrder.value = doc.project.tracks.map((t) => t.id)
  const move = (e: PointerEvent): void => {
    const over = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId
    if (over && over !== id) {
      const order = [...dragOrder.value!]
      const from = order.indexOf(id), to = order.indexOf(over)
      order.splice(from, 1)
      order.splice(to, 0, id)
      dragOrder.value = order
    }
    const rect = list.value!.getBoundingClientRect()
    if (e.clientY < rect.top + 40) list.value!.scrollBy(0, -24)
    else if (e.clientY > rect.bottom - 40) list.value!.scrollBy(0, 24)
  }
  const cleanup = (): void => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', cancel)
    dragOrder.value = null
  }
  const up = (): void => {
    const ids = dragOrder.value!
    doc.update((d) => {
      d.tracks = ids.map((id) => d.tracks.find((t) => t.id === id)!)
    })
    cleanup()
  }
  const cancel = (): void => cleanup()
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', cancel)
}
function reorderKey(event: KeyboardEvent, id: string): void {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  doc.update((d) => {
    const from = d.tracks.findIndex((t) => t.id === id),
      to = Math.max(
        0,
        Math.min(
          d.tracks.length - 1,
          from + (event.key === 'ArrowUp' ? -1 : 1),
        ),
      )
    const [t] = d.tracks.splice(from, 1)
    d.tracks.splice(to, 0, t)
  })
}
function resize(event: PointerEvent, track: Track): void {
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const start = event.clientY,
    initial = height(track)
  const move = (e: PointerEvent): void => {
    heights.value = {
      ...heights.value,
      [track.id]: Math.min(900, Math.max(112, initial + e.clientY - start)),
    }
  }
  const cleanup = (): void => {
    heights.value = {}
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', cancel)
  }
  const up = (): void => {
    edit(track.id, (t) => {
      t.height = height(track) / doc.project.view.laneZoom
    })
    cleanup()
  }
  const cancel = (): void => cleanup()
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', cancel)
}
function zoom(event: WheelEvent): void {
  if (!event.ctrlKey) return
  event.preventDefault()
  const factor = Math.exp(-event.deltaY * 0.002)
  doc.update((d) => {
    if (event.shiftKey)
      d.view.staffScale = Math.max(20, Math.min(100, d.view.staffScale * factor))
    else d.view.laneZoom = Math.max(0.5, Math.min(3, d.view.laneZoom * factor))
  })
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    overlayTop.value = list.value!.offsetTop
    const rect = root.value!.getBoundingClientRect()
    width.value = Math.max(
      200,
      rect.width -
        parseFloat(
          getComputedStyle(root.value!).getPropertyValue('--xm-w-header'),
        ) -
        (list.value!.offsetWidth - list.value!.clientWidth),
    )
  })
  observer.observe(root.value!)
  observer.observe(list.value!)
  animation = requestAnimationFrame(update)
})
onUnmounted(() => {
  cancelAnimationFrame(animation)
  observer?.disconnect()
})
</script>
<template>
  <main
    ref="root"
    class="xm-main"
    @wheel="zoom"
  >
    <ConflictBanner @error="emit('error', $event)" />
    <Ruler />
    <div class="xm-rowgrid xm-cues">
      <div class="xm-corner">
        Cues
      </div>
      <div class="xm-lanearea" />
    </div>
    <div
      ref="list"
      class="xm-tracks"
    >
      <div
        v-for="track in tracks"
        :key="track.id"
        :data-track-id="track.id"
        class="xm-rowgrid xm-track"
        :class="{
          'is-muted': track.mode === 'mute',
          'is-dragging': !!dragOrder,
        }"
        :style="{
          '--h': `${height(track)}px`,
          '--c': track.color,
          height: `${height(track)}px`,
        }"
      >
        <div class="xm-th">
          <div class="xm-th-top">
            <button
              class="xm-grip xm-grip-button"
              :aria-label="`Reorder ${track.name}`"
              title="Drag to reorder · Alt+↑/↓"
              @pointerdown="reorder($event, track.id)"
              @keydown="reorderKey($event, track.id)"
            >
              <i class="bi bi-grip-vertical" />
            </button><input
              class="xm-th-name xm-track-name"
              :aria-label="`${track.name} name`"
              :value="track.name"
              @change="
                edit(track.id, (t) => {
                  t.name = ($event.target as HTMLInputElement).value
                })
              "
            ><span
              v-if="track.kind === 'midi' && track.link"
              class="xm-badge"
              :class="track.link.state === 'synced' ? 'is-synced' : 'is-ahead'"
            >{{
              track.link.state === 'synced' ? 'synced' : 'modified here'
            }}</span>
          </div>
          <div class="xm-th-top">
            <button
              class="xm-mode"
              :class="`is-${track.mode}`"
              :aria-label="`${track.name} mode`"
              @click="mode(track)"
            >
              <i
                :class="`bi bi-${track.mode === 'live' ? 'person-fill' : track.mode === 'auto' ? 'cpu' : 'volume-mute'}`"
              />{{ track.mode.toUpperCase() }}
            </button><button
              class="xm-sq"
              :class="{ 'is-solo': track.solo }"
              :aria-pressed="track.solo"
              :aria-label="`${track.name} solo`"
              @click="
                edit(track.id, (t) => {
                  t.solo = !t.solo
                })
              "
            >
              S
            </button><button
              v-if="track.kind === 'midi'"
              class="xm-sq"
              :class="{ 'is-arm': track.armed }"
              :aria-label="`${track.name} record arm`"
              :aria-pressed="track.armed"
              @click="
                edit(track.id, (t) => {
                  if (t.kind === 'midi') t.armed = !t.armed
                })
              "
            >
              <i class="bi bi-record-fill" />
            </button>
            <div class="flex-grow-1" />
            <div
              v-if="track.kind === 'midi'"
              class="xm-seg"
            >
              <button
                v-for="view in ['staff', 'roll'] as const"
                :key="view"
                :class="{ 'is-on': track.view === view }"
                :title="view === 'staff' ? 'Staff' : 'Piano roll'"
                @click="
                  edit(track.id, (t) => {
                    if (t.kind === 'midi') t.view = view
                  })
                "
              >
                <i
                  :class="`bi bi-${view === 'staff' ? 'music-note-beamed' : 'bar-chart-steps'}`"
                />
              </button>
            </div>
          </div>
          <div class="xm-wrap">
            <template
              v-for="conn in doc.project.base.patch.filter(
                (c) => c.trackId === track.id,
              )"
              :key="conn.id"
            >
              <button
                class="xm-chip is-sm"
                @click="emit('instrument', conn.instrumentId)"
              >
                <i class="bi bi-music-note" />{{
                  doc.project.instruments.find(
                    (i) => i.id === conn.instrumentId,
                  )?.name ?? 'Missing instrument'
                }}
              </button>
            </template>
          </div>
          <div class="xm-th-top xm-track-mixer">
            <i class="bi bi-volume-up xm-faint" /><input
              type="range"
              class="form-range xm-track-volume"
              :style="{'--v':track.volume}"
              min="0"
              max="1"
              step=".01"
              :value="track.volume"
              :aria-label="`${track.name} volume`"
              @change="
                edit(track.id, (t) => {
                  t.volume = Number(($event.target as HTMLInputElement).value)
                })
              "
            ><input
              type="range"
              class="form-range xm-track-pan"
              min="-1"
              max="1"
              step=".01"
              :value="track.pan"
              :aria-label="`${track.name} pan`"
              title="Pan"
              @change="
                edit(track.id, (t) => {
                  t.pan = Number(($event.target as HTMLInputElement).value)
                })
              "
            >
          </div>
        </div>
        <PianoRollLane
          v-if="track.kind === 'midi'"
          :track="track"
          :height="height(track)"
        />
        <div
          v-else
          class="xm-lane"
        />
        <div
          class="xm-lane-resize"
          title="Drag to resize lane"
          @pointerdown="resize($event, track)"
        />
      </div>
      <div
        v-if="!tracks.length"
        class="xm-empty"
      >
        <h1 class="h5 mb-0">
          Start a project
        </h1>
        <span>Open a project folder or create one to begin.</span>
        <div class="xm-row">
          <button
            class="btn btn-primary"
            @click="emit('command', 'new')"
          >
            New project
          </button><button
            class="btn btn-xm"
            @click="emit('command', 'open')"
          >
            Open project
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="tracks.length"
      class="xm-overlay xm-timeline-overlay"
      :style="{top:`${overlayTop}px`}"
    >
      <div
        v-for="loop in loops"
        :key="loop.page"
        class="xm-loop"
        :style="{ left: `${loop.left}px`, width: `${loop.width}px` }"
      />
      <div
        class="xm-page-edge"
        :style="{ opacity: frame.edge }"
      />
      <div
        class="xm-playhead"
        :class="{ 'is-holding': runtime.transport.holding }"
        :style="{ left: `${frame.headX}px` }"
      />
    </div>
  </main>
</template>
