<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
import { noteName } from '../../shared/schema'
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
const active = new Map<string, number>()
const color = (key: number): string => {
  const held = runtime.heldKeys.find((h) => h.key === key)
  if (!held) return isBlack(key) ? 'var(--xm-bg-0)' : 'var(--xm-staff-ink)'
  return (
    doc.project.base.zones.find((z) => key >= z.lo && key <= z.hi)?.color ??
    'var(--xm-accent)'
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
  doc.project.base.zones.filter(
    (z) => z.hi >= range.value[0] && z.lo <= range.value[1],
  ),
)
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
    <div class="xm-zones">
      <div
        v-for="zone in zones"
        :key="zone.id"
        class="xm-zone"
        :style="zoneStyle(zone.lo, zone.hi, zone.color)"
      >
        <span>{{
          zone.trackIds
            .map(
              (id) => doc.project.tracks.find((t) => t.id === id)?.name ?? id,
            )
            .join(' + ')
        }}</span><span class="xm-faint xm-mono">{{ noteName(zone.lo) }}–{{ noteName(zone.hi) }}</span>
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
      </svg>
    </div>
  </footer>
</template>
