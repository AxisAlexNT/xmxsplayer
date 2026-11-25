<script setup lang="ts">
import EffectsDialog from "../components/EffectsDialog.vue"
import { useI18n } from '../i18n'
const { t } = useI18n()
defineOptions({ name: 'TrackTimeline' })
import StaffControls from '../notation/StaffControls.vue'
import { staffSettings } from '../notation/voicing'
import StaffLane from '../lanes/StaffLane.vue'
import { NotationService, notationKey } from '../notation/notation-service'
import { useSourcesStore } from '../stores/sources'
import TrackSourceMenu from '../components/TrackSourceMenu.vue'
import {
  computed,
  onMounted,
  onUnmounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { usePerformanceStore } from '../stores/performance'
import { liveProject } from '../../shared/template'
import { uniqueId } from '../../shared/ids'
import type { Track } from '../../shared/model'
import { useDisplayProject } from '../stores/display'
import { TimeMap } from '../../shared/time-map'
import { useProjectStore } from '../stores/project'
import { useEditorStore } from '../stores/editor'
import { useRuntimeStore } from '../stores/runtime'
import { timelineKey } from './context'
import type { TimeAxis } from './time-axis'
import { LinearAxis } from './linear-axis'
import { transportTick, Viewport, type TimelineFrame } from './viewport'
import Ruler from '../lanes/Ruler.vue'
import CueLane from '../lanes/CueLane.vue'
import PianoRollLane from '../lanes/PianoRollLane.vue'
import AudioLane from '../lanes/AudioLane.vue'
import AudioTrackControls from '../components/tracks/AudioTrackControls.vue'
import ConflictBanner from '../components/ConflictBanner.vue'
const emit = defineEmits<{
  instrument: [id: string]
  patch: [connectionId: string, anchor: { right: number; top: number }]
  command: [cmd: string]
  error: [error: unknown]
}>()
const rig = usePerformanceStore()
const notation = new NotationService(),
  sources = useSourcesStore()
provide(notationKey, notation)
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  editor = useEditorStore(),
  timePreview = ref<number | null>(null),
  manualOffset = ref<number | null>(null),
  root = ref<HTMLElement>(),
  list = ref<HTMLElement>(),
  width = ref(1296),
  overlayTop = ref(56),
  dragOrder = ref<string[] | null>(null),
  heights = ref<Record<string, number>>({}),
  loopPreview = ref<import('../../shared/model').Project['loop'] | null>(null)
function addMidiTrack(){
  doc.update(p=>{
    const track=liveProject('MIDI').tracks[0]
    if(track.kind!=='midi')return
    track.id=uniqueId('midi',p.tracks.map(t=>t.id))
    track.name='MIDI '+(p.tracks.filter(t=>t.kind==='midi').length+1)
    track.mode='auto'
    p.tracks.push(track)
    const instrument=p.instruments[0]
    if(instrument)p.base.patch.push({id:uniqueId(track.id,p.base.patch.map(c=>c.id)),trackId:track.id,instrumentId:instrument.id})
  })
}
const reportedNotationWarnings = new Set<string>()
watch(() => doc.loadRevision, () => reportedNotationWarnings.clear())
watch(() => notation.merged.value?.warnings, warnings => {
  for (const message of warnings ?? []) {
    if (reportedNotationWarnings.has(message)) continue
    reportedNotationWarnings.add(message)
    runtime.log({level:'warn', source:'notation', message})
  }
})
let recordingId: string | undefined
let lastStaffBar = -Infinity
const recentStaffNotes = new Map<string, number>()
let barsPerRebuild = 1
notation.onRebuilt = duration => {
  if (!runtime.liveTake) return
  const slow = duration > 200 && barsPerRebuild === 1
  if (slow) barsPerRebuild = 2
  runtime.log({ level: 'info', source: 'notation', message:
    `Recording layout took ${Math.round(duration)} ms.${slow ? ' Updating every two bars.' : ''}` })
}
const display = useDisplayProject()
const map = computed(() => new TimeMap(display.value)),
  axis = computed<TimeAxis>(() =>
    hasStaves.value && notation.axis.value
      ? notation.axis.value
      : new LinearAxis(
          editor.activeTrackId
            ? new TimeMap({
                ...doc.project,
                lengthTicks: map.value.nextBar(display.value.lengthTicks),
              })
            : map.value,
          width.value,
          timePreview.value ?? doc.project.view.pxPerQuarter,
        ),
  )
function wantsStaff(track: Track): boolean {
  return (
    track.kind === 'midi' &&
    (doc.project.view.lanes === 'staff' ||
      (doc.project.view.lanes === 'per-track' && track.view === 'staff'))
  )
}
const hasStaves = computed(() =>
  doc.project.tracks.some(
    (t) => wantsStaff(t) && notation.merged.value?.staffTrackIds.includes(t.id),
  ),
)
function isStaff(track: Track): boolean {
  return (
    wantsStaff(track) &&
    !!notation.info.value &&
    !!notation.merged.value?.staffTrackIds.includes(track.id)
  )
}
watch(
  () =>
    JSON.stringify([
      width.value,
      doc.loadRevision,
      doc.project.view.staffScale,
      doc.project.view.lanes,
      doc.project.mapOwner,
      doc.project.sources.map((s) => [s.id, s.durationTicks]),
      doc.project.tempos,
      doc.project.timeSigs,
      doc.project.keySigs,
      display.value.lengthTicks,
      sources.musicxml[doc.project.mapOwner ?? ''],
      display.value.tracks
        .filter((t) => t.kind === 'midi')
        .map((t) => [
          t.id,
          t.name,
          t.notes,
          t.link,
          t.clef,
          t.staff,
          t.events.filter(e=>e.type==="cc" && e.num===64),
          t.quantGrid,
          t.view,
        ]),
      doc.project.base.patch.map((p) => [p.trackId, p.instrumentId]),
      doc.project.instruments.map((i) => [i.id, i.isDrum, i.program]),
    ]),
  () => {
    const take = runtime.liveTake
    if (take?.takeId !== recordingId) {
      recentStaffNotes.clear()
      recordingId = take?.takeId
      lastStaffBar = -Infinity
      barsPerRebuild = 1
    }
    if (take) {
      const bar = map.value.tickToBarBeat(take.barEnd).bar
      if (bar >= lastStaffBar && bar < lastStaffBar + barsPerRebuild) return
      const since = map.value.barToTick(Math.max(1, bar - barsPerRebuild))
      const until = performance.now() + 2000
      for (const track of take.tracks)
        for (const [tick, , key] of track.closed)
          if (tick >= since && tick < take.barEnd)
            recentStaffNotes.set(`${track.trackId}:${tick}:${key}`, until)
      lastStaffBar = bar
    }
    if (doc.project.tracks.some(wantsStaff))
      notation.schedule(
        display.value,
        sources.musicxml[doc.project.mapOwner ?? ''],
        { pageWidth: width.value, scale: doc.project.view.staffScale },
      )
  },
  { immediate: true },
)
const frame = shallowRef<TimelineFrame>({
    tick: 0,
    offset: 0,
    headX: 96,
    pages: [0],
    edge: 0,
  }),
  viewport = new Viewport()
provide(timelineKey, {
  axis,
  frame,
  navigation: {
    freeze: () => {
      manualOffset.value = frame.value.offset
    },
    pan: (delta) => {
      manualOffset.value = Math.max(
        -axis.value.pageWidth / 2,
        Math.min(
          (axis.value.pageCount - 1) * axis.value.pageWidth,
          (manualOffset.value ?? frame.value.offset) + delta,
        ),
      )
    },
    previewZoom: (px, tick, x) => {
      timePreview.value = Math.max(15, Math.min(600, px))
      const a = axis.value
      manualOffset.value = Math.max(
        -a.pageWidth / 2,
        Math.min(
          (a.pageCount - 1) * a.pageWidth,
          a.pageOfTick(tick) * a.pageWidth + a.xInPage(tick) - x,
        ),
      )
    },
    commitZoom: () => {
      const px = timePreview.value
      if (px !== null)
        doc.update((d) => {
          d.view.pxPerQuarter = px
        })
      timePreview.value = null
    },
    cancelZoom: () => {
      timePreview.value = null
    },
  },
})
watch(
  () => runtime.transport.playing,
  (playing, was) => {
    if (playing && !was) manualOffset.value = null
  },
)
watch(
  () => doc.project.view.follow,
  () => {
    manualOffset.value = null
  },
)
watch(
  () => editor.followRevision,
  () => {
    manualOffset.value = null
  },
)
const tracks = computed(() =>
  dragOrder.value
    ? dragOrder.value.flatMap((id) => {
        const track = doc.project.tracks.find((t) => t.id === id)
        return track ? [track] : []
      })
    : doc.project.tracks,
)
const loops = computed(() => {
  if (!(loopPreview.value ?? doc.project.loop).enabled) return []
  const a = axis.value,
    l = loopPreview.value ?? doc.project.loop
  return frame.value.pages.flatMap((page) => {
    const [start, end] = a.pageRange(page),
      lo = Math.max(start, l.startTick),
      hi = Math.min(end, l.endTick)
    return hi > lo
      ? [
          {
            page,
            left:
              page * a.pageWidth +
              (a.measureX?.(lo, page) ?? a.xInPage(lo, page)) -
              frame.value.offset,
            width:
              (a.measureX?.(hi, page) ?? a.xInPage(hi, page)) -
              (a.measureX?.(lo, page) ?? a.xInPage(lo, page)),
          },
        ]
      : []
  })
})
let requestedInfo: unknown,
  requestedPage = -1
let animation = 0,
  observer: ResizeObserver | undefined
function update(): void {
  const tick = transportTick(
    runtime.transport,
    map.value,
    doc.project.loop,
    performance.timeOrigin + performance.now(),
  )
  if (hasStaves.value && notation.info.value) {
    const page = axis.value.pageOfTick(tick)
    if (requestedPage !== page || requestedInfo !== notation.info.value) {
      requestedPage = page
      requestedInfo = notation.info.value
      void notation.ensure(page)
    }
    notation.highlight(
      doc.project,
      tick,
      runtime.transport.playing,
      runtime.heldKeys,
      runtime.state.expectedNext?.notes ?? [],
      displayedMode,
      recentStaffNotes,
      runtime.transport.covered,
    )
  }
  frame.value = viewport.frame(
    axis.value,
    tick,
    doc.project.view.follow,
    performance.now(),
    runtime.transport.playing,
  )
  if (manualOffset.value !== null) {
    const a = axis.value,
      offset = manualOffset.value,
      first = Math.max(0, Math.floor(offset / a.pageWidth)),
      last = Math.min(
        a.pageCount - 1,
        Math.floor((offset + a.pageWidth) / a.pageWidth),
      )
    frame.value = {
      ...frame.value,
      offset,
      headX: a.pageOfTick(tick) * a.pageWidth + a.xInPage(tick) - offset,
      pages: Array.from(
        { length: Math.max(0, last - first + 1) },
        (_, i) => first + i,
      ),
      edge: 0,
    }
  }
  animation = requestAnimationFrame(update)
}
function edit(id: string, change: (track: Track) => void): void {
  doc.update((d) => {
    const t = d.tracks.find((t) => t.id === id)
    if (t) change(t)
  })
}
function displayedMode(track: Track): Track['mode'] {
  return (
    runtime.state.trackModes?.[track.id] ??
    rig.setup.trackModes[track.id] ??
    track.mode
  )
}
function mode(track: Track): void {
  const current = displayedMode(track)
  rig.mode(
    track.id,
    track.kind === 'audio'
      ? current === 'auto'
        ? 'mute'
        : 'auto'
      : ({ auto: 'live', live: 'mute', mute: 'auto' } as const)[current],
  )
}
function height(track: Track): number {
  return Math.max(
    track.kind === 'midi' && track.link ? 196 : 0,
    heights.value[track.id] ?? ((track.kind === 'midi' && wantsStaff(track) && track.height === 196 &&
      staffSettings(track, doc.project).mode === 'grand') ? 260 : track.height) * doc.project.view.laneZoom,
  )
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
      const from = order.indexOf(id),
        to = order.indexOf(over)
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
const expanded = new Map<string, number>()
function expand(track: Track): void {
  if (track.kind !== 'midi') return
  const old = expanded.get(track.id)
  doc.update((d) => {
    const t = d.tracks.find((t) => t.id === track.id)!
    if (old !== undefined) {
      t.height = old
      expanded.delete(track.id)
    } else {
      expanded.set(track.id, t.height)
      t.height = Math.min(
        900 / doc.project.view.laneZoom,
        Math.max(360 / doc.project.view.laneZoom, t.height * 2),
      )
    }
  })
  editor.activate(track.id)
}
function selectLoop(event: PointerEvent): void {
  if (
    !event.shiftKey ||
    event.button !== 0 ||
    !(event.target as HTMLElement).closest('.xm-lane')
  )
    return
  event.preventDefault()
  const target = root.value!,
    a = axis.value
  target.setPointerCapture(event.pointerId)
  const tick = (e: PointerEvent): number => {
    const x =
        e.clientX -
        target.getBoundingClientRect().left -
        parseFloat(getComputedStyle(target).getPropertyValue('--xm-w-header')) +
        frame.value.offset,
      page = Math.max(0, Math.min(a.pageCount - 1, Math.floor(x / a.pageWidth)))
    return Math.round(a.tickAt(page, x - page * a.pageWidth))
  }
  const start = tick(event)
  const move = (e: PointerEvent): void => {
    const end = tick(e)
    loopPreview.value = {
      enabled: true,
      startTick: Math.min(start, end),
      endTick: Math.max(start, end) + (start === end ? 1 : 0),
    }
  }
  const cleanup = (): void => {
    loopPreview.value = null
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    target.removeEventListener('pointercancel', cancel)
  }
  const up = (): void => {
    if (loopPreview.value) {
      const loop = { ...loopPreview.value }
      doc.update((d) => {
        d.loop = loop
      })
    }
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
      d.view.staffScale = Math.max(
        20,
        Math.min(100, d.view.staffScale * factor),
      )
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
  notation.destroy()
  cancelAnimationFrame(animation)
  observer?.disconnect()
})
</script>
<template>
  <main
    ref="root"
    data-tour="timeline"
    class="xm-main"
    @wheel="zoom"
    @pointerdown="selectLoop"
  >
    <div class="xm-timeline-banners">
      <ConflictBanner @error="emit('error', $event)" />
      <div
        v-if="notation.error.value || notation.merged.value?.warnings.length"
        class="xm-notation-warning"
        role="alert"
      >
        {{
          notation.error.value || notation.merged.value?.warnings.join(' · ')
        }}
      </div>
    </div>
    <Ruler />
    <CueLane @error="emit('error', $event)" />
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
          'is-muted': displayedMode(track) === 'mute',
          'is-dragging': !!dragOrder,
        }"
        :style="{
          '--h': `${height(track)}px`,
          '--c': track.color,
          height: `${height(track)}px`,
        }"
      >
        <div
          class="xm-th"
          :title="t('timeline.doubleClickToExpandOrRestoreLane')"
          @dblclick="
            !($event.target as HTMLElement).closest(
              'button,select,input[type=range]',
            ) && expand(track)
          "
          @pointerdown="
            track.kind === 'audio'
              ? (runtime.selectedAudioId = track.id)
              : editor.activate(track.id)
          "
        >
          <div class="xm-th-top">
            <button
              class="xm-grip xm-grip-button"
              :aria-label="`Reorder ${track.name}`"
              :title="t('timeline.dragToReorderAlt')"
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
            >
            <TrackSourceMenu
              v-if="track.kind === 'midi'"
              :track="track"
              @error="emit('error', $event)"
            />
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
          <StaffControls
            v-if="track.kind === 'midi' && !track.link && wantsStaff(track)"
            :track="track"
          />
          <span
            v-if="track.kind === 'midi' && track.link"
            class="xm-badge"
            :class="
              track.link.orphaned
                ? 'is-orphan'
                : track.link.state === 'synced'
                  ? 'is-synced'
                  : 'is-ahead'
            "
          >{{
            track.link.orphaned
              ? 'not in score'
              : track.link.state === 'synced'
                ? 'synced'
                : 'modified here'
          }}</span>
          <div class="xm-th-top">
            <button
              class="xm-mode"
              :class="`is-${displayedMode(track)}`"
              :aria-label="`${track.name} mode`"
              @click="mode(track)"
            >
              <i
                :class="`bi bi-${displayedMode(track) === 'live' ? 'person-fill' : displayedMode(track) === 'auto' ? 'cpu' : 'volume-mute'}`"
              />{{ displayedMode(track).toUpperCase() }}
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
              {{ t('timeline.s') }}
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
            <button
              v-if="track.kind === 'midi' && displayedMode(track) === 'live'"
              class="xm-sq xm-follow-lead"
              :class="{ 'is-on': track.leads }"
              :aria-label="`${track.name} leads follow`"
              :aria-pressed="track.leads"
              :title="t('timeline.leadTheFollowMode')"
              @click="
                edit(track.id, (t) => {
                  if (t.kind === 'midi') t.leads = !t.leads
                })
              "
            >
              <i class="bi bi-magnet" />
            </button>
            <div class="flex-grow-1" />
          </div>
          <AudioTrackControls
            v-if="track.kind === 'audio'"
            :track="track"
          />
          <div
            v-else
            class="xm-wrap"
          >
            <template
              v-for="conn in rig.setup.patch.filter(
                (c) => c.trackId === track.id,
              )"
              :key="conn.id"
            >
              <button
                class="xm-chip is-sm"
                @click="
                  emit(
                    'patch',
                    conn.id,
                    (
                      $event.currentTarget as HTMLElement
                    ).getBoundingClientRect(),
                  )
                "
              >
                <i class="bi bi-music-note" />{{
                  doc.project.instruments.find(
                    (i) => i.id === conn.instrumentId,
                  )?.name ?? 'Missing instrument'
                }}
              </button>
              <EffectsDialog :instrument-id="conn.instrumentId" />
            </template>
          </div>
          <div class="xm-th-top xm-track-mixer">
            <i class="bi bi-volume-up xm-faint" /><input
              v-mappable="{label:track.name+' volume',action:{type:'param',target:'track.volume',id:track.id,min:0,max:1}}"
              type="range"
              class="form-range xm-track-volume"
              :style="{ '--v': track.volume }"
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
              v-mappable="{label:track.name+' pan',action:{type:'param',target:'track.pan',id:track.id,min:-1,max:1}}"
              type="range"
              class="form-range xm-track-pan"
              min="-1"
              max="1"
              step=".01"
              :value="track.pan"
              :aria-label="`${track.name} pan`"
              :title="t('timeline.pan')"
              @change="
                edit(track.id, (t) => {
                  t.pan = Number(($event.target as HTMLInputElement).value)
                })
              "
            >
          </div>
        </div>
        <StaffLane
          v-if="track.kind === 'midi' && isStaff(track)"
          :track="track"
          :height="height(track)"
        />
        <PianoRollLane
          v-else-if="track.kind === 'midi'"
          :track="track"
          :height="height(track)"
        />
        <AudioLane
          v-else
          :track="track"
          :height="height(track)"
        />
        <div
          class="xm-lane-resize"
          :title="t('timeline.dragToResizeLane')"
          @pointerdown="resize($event, track)"
        />
      </div>
      <div
        v-if="hasStaves"
        class="xm-staff-tools"
      >
        <label>{{ t('timeline.staffScale') }}
          <input
            type="range"
            min="20"
            max="100"
            step="1"
            :value="doc.project.view.staffScale"
            :aria-label="t('timeline.staffScale')"
            @input="
              doc.update((d) => {
                d.view.staffScale = Number(
                  ($event.target as HTMLInputElement).value,
                )
              })
            "
          ></label>
        <div class="xm-seg">
          <button
            v-for="theme in ['dark', 'paper'] as const"
            :key="theme"
            :class="{ 'is-on': doc.project.view.staffTheme === theme }"
            @click="
              doc.update((d) => {
                d.view.staffTheme = theme
              })
            "
          >
            {{ theme === 'dark' ? 'Dark' : 'Paper' }}
          </button>
        </div>
      </div>
      <div
        v-if="tracks.length"
        class="xm-add-track"
      >
        <button
          class="btn btn-sm btn-ghost"
          @click="addMidiTrack"
        >
          <i class="bi bi-plus-lg" /> {{ t('timeline.midiTrack') }}
        </button>
        <button
          class="btn btn-sm btn-ghost"
          @click="emit('command', 'import:audio')"
        >
          <i class="bi bi-plus-lg" /> {{ t('timeline.audioTrack') }}
        </button>
        <button
          class="btn btn-sm btn-ghost"
          @click="emit('command', 'appendBar')"
        >
          <i class="bi bi-plus-lg" /> {{ t('timeline.bars') }}
        </button>
      </div>
      <div
        v-if="!tracks.length"
        class="xm-empty"
      >
        <h1 class="h5 mb-0">
          {{ t('timeline.startAProject') }}
        </h1>
        <span>{{ t('timeline.openAProjectFolderOrCreateOneToBegin') }}</span>
        <div class="xm-row">
          <button
            class="btn btn-primary"
            @click="emit('command', 'new')"
          >
            {{ t('timeline.newProject') }}
          </button><button
            class="btn btn-xm"
            @click="emit('command', 'open')"
          >
            {{ t('timeline.openProject') }}
          </button>
        </div>
      </div>
    </div>
    <div
      v-if="tracks.length"
      class="xm-overlay xm-timeline-overlay"
      :style="{ top: `${overlayTop}px` }"
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
