<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
import { noteName } from '../../shared/schema'
import { usePerformanceStore } from '../stores/performance'
import { uniqueId } from '../../shared/ids'
import {pickLayers} from '../../shared/orchestra'
import ZoneEditor from './ZoneEditor.vue'
const emit = defineEmits<{ script: [] }>()
const performance = usePerformanceStore()
const scripted = computed(
  () => performance.editScene && !!runtime.state.scriptZones,
)
const selectedZone = ref<string | null>(null),
  zoneAnchor = ref({ right: 0, top: 0 })
const preview = ref<{ id: string; lo: number; hi: number } | null>(null)
const doc = useProjectStore()
const runtime = useRuntimeStore()
const count = ref(Number(localStorage.getItem('keyCount')) || 61)
const range = computed(() =>
  count.value === 88
    ? [21, 108]
    : count.value === 76
      ? [28, 103]
      : count.value === 49
        ? [48, 96]
        : [36, 96],
)
const allKeys = computed(() =>
  Array.from(
    { length: range.value[1] - range.value[0] + 1 },
    (_, i) => i + range.value[0],
  ),
)
const isBlack = (key: number): boolean => [1, 3, 6, 8, 10].includes(key % 12)
const white = computed(() => allKeys.value.filter((k) => !isBlack(k)))
const black = computed(() => allKeys.value.filter(isBlack))
const layerMarks = computed(()=>{
  const track=doc.project.tracks.find(t=>t.kind==='midi' && t.orchestraId)
  if(track?.kind!=='midi') return []
  const o=doc.project.orchestras?.find(o=>o.id===(runtime.state.orchestras?.[track.id] ?? track.orchestraId))
  if(!o)return []
  return allKeys.value.flatMap(key=>pickLayers(o,key,runtime.state.registers).map((layer,i)=>({key,i,color:doc.project.instruments.find(v=>v.id===layer.instrumentId)?.color ?? o.color})))
})
const active = new Map<string, number>()
const color = (key: number): string => {
  const held = runtime.heldKeys.find((h) => h.key === key)
  if (!held) return isBlack(key) ? 'var(--xm-bg-0)' : 'var(--xm-staff-ink)'
  return (
    runtime.state.effective.zones.find((z) => key >= z.lo && key <= z.hi)
      ?.color ?? 'var(--xm-accent)'
  )
}
function expected(key: number): boolean {
  const next = runtime.state.expectedNext
  if (!next) return false
  if (!next.notes) return next.keys.includes(key)
  return next.notes.some((note) =>
    runtime.state.effective.zones.some(
      (zone) =>
        key >= zone.lo &&
        key <= zone.hi &&
        zone.trackIds.includes(note.trackId) &&
        key + zone.transpose === note.key,
    ),
  )
}
function x(key: number): number {
  return white.value.filter((k) => k < key).length - (isBlack(key) ? 0.32 : 0)
}
function zoneStyle(lo: number, hi: number, color: string) {
  const start = Math.max(0, x(Math.max(lo, range.value[0])))
  const end = Math.min(
    white.value.length,
    x(Math.min(hi, range.value[1])) + (isBlack(hi) ? 0.64 : 1),
  )
  return {
    left: `${(start / white.value.length) * 100}%`,
    width: `${(Math.max(0, end - start) / white.value.length) * 100}%`,
    '--c': color,
  }
}
const zones = computed(() =>
  (scripted.value ? runtime.state.effective.zones : performance.setup.zones)
    .map((z) =>
      preview.value?.id === z.id
        ? { ...z, lo: preview.value.lo, hi: preview.value.hi }
        : z,
    )
    .filter((z) => z.hi >= range.value[0] && z.lo <= range.value[1]),
)
watch(
  () => [performance.sceneId, scripted.value],
  () => {
    selectedZone.value = null
    preview.value = null
  },
)
function editZone(id: string, element: HTMLElement): void {
  if (scripted.value) {
    emit('script')
    return
  }
  selectedZone.value = id
  zoneAnchor.value = element.getBoundingClientRect()
}
function openZone(id: string, anchor: { right: number; top: number }): void {
  if (scripted.value) {
    emit('script')
    return
  }
  selectedZone.value = id
  zoneAnchor.value = anchor
}
defineExpose({ openZone })
function keyAt(clientX: number, element: HTMLElement): number {
  const r = element.getBoundingClientRect(),
    position = ((clientX - r.left) / r.width) * white.value.length
  return allKeys.value.reduce(
    (best, key) =>
      Math.abs(x(key) - position) < Math.abs(x(best) - position) ? key : best,
    allKeys.value[0],
  )
}
async function addZone(event: MouseEvent): Promise<void> {
  if (scripted.value) {
    emit('script')
    return
  }
  if ((event.target as HTMLElement).closest('.xm-zone,select,button')) return
  const el = event.currentTarget as HTMLElement,
    lo = keyAt(event.clientX, el)
  const id = uniqueId(
    'zone',
    performance.setup.zones.map((z) => z.id),
  )
  performance.zones((zones) => {
    zones.push({
      id,
      lo,
      hi: Math.min(127, lo + 11),
      trackIds: doc.project.tracks
        .filter((t) => t.kind === 'midi')
        .slice(0, 1)
        .map((t) => t.id),
      transpose: 0,
      velocity: 'linear',
      color: '#4cc2ff',
    })
  })
  await nextTick()
  editZone(id, el)
}
function dragEdge(event: PointerEvent, id: string, edge: 'lo' | 'hi'): void {
  if (event.button !== 0) return
  const zone = performance.setup.zones.find((z) => z.id === id)
  if (!zone) return
  const handle = event.currentTarget as HTMLElement,
    strip = handle.closest('.xm-zones') as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const scope = performance.sceneId
  const startKey = keyAt(event.clientX, strip)
  preview.value = { id, lo: zone.lo, hi: zone.hi }
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId || !preview.value) return
    const key = Math.max(
      0,
      Math.min(127, zone[edge] + keyAt(e.clientX, strip) - startKey),
    )
    preview.value[edge] =
      edge === 'lo'
        ? Math.min(key, preview.value.hi)
        : Math.max(key, preview.value.lo)
  }
  const finish = (e: PointerEvent): void => {
    if (e.pointerId !== event.pointerId) return
    const value = preview.value
    preview.value = null
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', finish)
    handle.removeEventListener('pointercancel', cancel)
    handle.removeEventListener('lostpointercapture', cancel)
    if (value && scope === performance.sceneId)
      performance.zones((zones) => {
        const z = zones.find((z) => z.id === id)
        if (z) {
          z.lo = value.lo
          z.hi = value.hi
        }
      })
  }
  const cancel = (): void => {
    preview.value = null
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', finish)
    handle.removeEventListener('pointercancel', cancel)
    handle.removeEventListener('lostpointercapture', cancel)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', cancel)
  handle.addEventListener('lostpointercapture', cancel)
}
function release(source: string): void {
  const key = active.get(source)
  if (key !== undefined) {
    engineBus.value?.send('live:note', { key, vel: 0, on: false, source })
    active.delete(source)
  }
}
function play(source: string, key: number, velocity: number): void {
  if (active.get(source) === key) return
  release(source)
  active.set(source, key)
  engineBus.value?.send('live:note', { key, vel: velocity, on: true, source })
}
function pointerDown(event: PointerEvent): void {
  const attribute = (event.target as Element)
    .closest('[data-key]')
    ?.getAttribute('data-key')
  if (attribute == null) return
  const key = Number(attribute)
  if (!Number.isFinite(key)) return
  const svg = event.currentTarget as SVGSVGElement
  svg.setPointerCapture(event.pointerId)
  play(
    `pointer-${event.pointerId}`,
    key,
    event.pointerType === 'pen' && event.pressure > 0
      ? Math.max(1, Math.round(event.pressure * 127))
      : 100,
  )
}
function pointerMove(event: PointerEvent): void {
  const source = `pointer-${event.pointerId}`
  if (!active.has(source)) return
  const element = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest('[data-key]')
  if (element) play(source, Number(element.getAttribute('data-key')), 100)
}
function releaseAll(): void {
  for (const source of [...active.keys()]) release(source)
}
function keyCount(): void {
  releaseAll()
  localStorage.setItem('keyCount', String(count.value))
}
onMounted(() => window.addEventListener('blur', releaseAll))
onUnmounted(() => {
  releaseAll()
  window.removeEventListener('blur', releaseAll)
})
</script>
<template>
  <footer class="xm-keys">
    <div
      class="xm-zones"
      @dblclick="addZone"
    >
      <div
        v-for="zone in zones"
        :key="zone.id"
        class="xm-zone"
        :style="zoneStyle(zone.lo, zone.hi, zone.color)"
      >
        <button
          v-if="!scripted"
          class="xm-zone-edge is-left"
          :aria-label="`Resize ${zone.id} lower edge`"
          @pointerdown.stop.prevent="dragEdge($event, zone.id, 'lo')"
          @click.stop.prevent
        />
        <button
          class="xm-zone-label"
          :aria-label="
            scripted
              ? `Edit script for zone ${zone.id}`
              : `Edit zone ${zone.id}`
          "
          :title="scripted ? 'Script zone — edit in Script' : undefined"
          @click="editZone(zone.id, $event.currentTarget as HTMLElement)"
        >
          <span>{{
            zone.trackIds
              .map(
                (id) => doc.project.tracks.find((t) => t.id === id)?.name ?? id,
              )
              .join(' + ') || 'Unassigned'
          }}</span><span class="xm-faint xm-mono">{{ noteName(zone.lo) }}–{{ noteName(zone.hi) }}</span>
        </button>
        <button
          v-if="!scripted"
          class="xm-zone-edge is-right"
          :aria-label="`Resize ${zone.id} upper edge`"
          @pointerdown.stop.prevent="dragEdge($event, zone.id, 'hi')"
          @click.stop.prevent
        />
      </div>
      <span
        v-if="!zones.length"
        class="xm-faint"
      >No zones</span><select
        v-model.number="count"
        class="xm-key-count"
        aria-label="Keyboard range"
        @change="keyCount"
      >
        <option
          v-for="size in [49, 61, 76, 88]"
          :key="size"
          :value="size"
        >
          {{ size }} keys
        </option>
      </select>
    </div>
    <div class="xm-keybed">
      <svg
        :viewBox="`0 0 ${white.length * 50} 100`"
        preserveAspectRatio="none"
        role="group"
        aria-label="Playable keyboard"
        @pointerdown.prevent="pointerDown"
        @pointermove.prevent="pointerMove"
        @pointerup="release(`pointer-${$event.pointerId}`)"
        @pointercancel="release(`pointer-${$event.pointerId}`)"
        @lostpointercapture="release(`pointer-${$event.pointerId}`)"
      >
        <g
          v-for="key in white"
          :key="key"
        >
          <rect
            :x="x(key) * 50"
            y="0"
            width="50"
            height="100"
            rx="2"
            :fill="color(key)"
            :data-key="key"
            :class="{ 'is-expected': expected(key) }"
            :aria-description="expected(key) ? 'Next expected note' : undefined"
            role="button"
            :aria-label="noteName(key)"
            :aria-pressed="runtime.heldKeys.some((h) => h.key === key)"
            tabindex="0"
            @keydown.space.prevent.stop="play(`key-${key}`, key, 100)"
            @keyup.space.prevent.stop="release(`key-${key}`)"
            @keydown.enter.prevent.stop="play(`key-${key}`, key, 100)"
            @keyup.enter.prevent.stop="release(`key-${key}`)"
            @blur="release(`key-${key}`)"
          />
          <text
            v-if="key % 12 === 0 || key === range[0]"
            :x="x(key) * 50 + 25"
            y="94"
            class="xm-key-label"
          >
            {{ noteName(key) }}
          </text>
        </g>
        <rect
          v-for="key in black"
          :key="key"
          :x="x(key) * 50"
          y="0"
          width="32"
          height="62"
          rx="2"
          :fill="color(key)"
          :data-key="key"
          :class="{ 'is-expected': expected(key) }"
          :aria-description="expected(key) ? 'Next expected note' : undefined"
          role="button"
          :aria-label="noteName(key)"
          :aria-pressed="runtime.heldKeys.some((h) => h.key === key)"
          tabindex="0"
          @keydown.space.prevent.stop="play(`key-${key}`, key, 100)"
          @keyup.space.prevent.stop="release(`key-${key}`)"
          @keydown.enter.prevent.stop="play(`key-${key}`, key, 100)"
          @keyup.enter.prevent.stop="release(`key-${key}`)"
          @blur="release(`key-${key}`)"
        />
        <rect
          v-for="mark in layerMarks"
          :key="mark.key+'-'+mark.i"
          :x="x(mark.key)*50+3"
          :y="(isBlack(mark.key)?55:77)-mark.i*3"
          :width="isBlack(mark.key)?26:44"
          height="2"
          :fill="mark.color"
          pointer-events="none"
        />
      </svg>
    </div>
    <ZoneEditor
      v-if="selectedZone"
      :zone-id="selectedZone"
      :anchor="zoneAnchor"
      @close="selectedZone = null"
    />
  </footer>
</template>
