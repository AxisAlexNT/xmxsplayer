<script setup lang="ts">
import { t } from '../i18n'
import { computed, ref, watch } from 'vue'
import type { Zone } from '../../shared/model'
import { keySchema, noteName } from '../../shared/schema'
import { usePerformanceStore } from '../stores/performance'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { palette } from '../bindings/labels'
import EditorPopover from './EditorPopover.vue'
const props = defineProps<{
    zoneId: string
    anchor: { right: number; top: number }
  }>(),
  emit = defineEmits<{ close: [] }>()
const performance = usePerformanceStore(),
  doc = useProjectStore(),
  runtime = useRuntimeStore()
const zone = computed(() =>
  performance.setup.zones.find((z) => z.id === props.zoneId),
)
const error = ref(''),
  learning = ref(false),
  learned = ref<[number, number] | null>(null)
function toggleLearn(): void {
  learning.value = !learning.value
  learned.value = null
}
function apply(patch: Partial<Zone>): void {
  try {
    performance.zones((zones) => {
      const zone = zones.find((z) => z.id === props.zoneId)
      if (zone) Object.assign(zone, patch)
    })
    error.value = ''
  } catch {
    error.value =
      'Use MIDI keys 0–127 or note names such as C4, with From no higher than To. Transpose must be an integer and velocity power must be positive.'
  }
}
function range(field: 'lo' | 'hi', event: Event): void {
  const key = keySchema.safeParse((event.target as HTMLInputElement).value)
  if (key.success) apply({ [field]: key.data })
  else error.value = 'Use a note name such as C4 or a MIDI key from 0 to 127.'
}
function track(id: string, checked: boolean): void {
  if (!zone.value) return
  apply({
    trackIds: checked
      ? [...new Set([...zone.value.trackIds, id])]
      : zone.value.trackIds.filter((t) => t !== id),
  })
}
function remove(): void {
  performance.zones((zones) => {
    const i = zones.findIndex((z) => z.id === props.zoneId)
    if (i >= 0) zones.splice(i, 1)
  })
  emit('close')
}
watch(
  () => runtime.heldKeys,
  (keys) => {
    if (!learning.value || !keys.length) return
    const values = keys.map((k) => k.key)
    if (learned.value) values.push(...learned.value)
    learned.value = [Math.min(...values), Math.max(...values)]
    apply({ lo: learned.value[0], hi: learned.value[1] })
  },
  { deep: true },
)
</script>
<template>
  <EditorPopover
    v-if="zone"
    :title="t('zoneEditor.zone')"
    :anchor="anchor"
    @close="emit('close')"
  >
    <div class="row g-2 mb-2">
      <label class="col form-label">{{ t('zoneEditor.from') }}<input
        class="form-control xm-mono"
        :aria-label="t('zoneEditor.zoneFrom')"
        :value="noteName(zone.lo)"
        @change="range('lo', $event)"
      ></label>
      <label class="col form-label">{{ t('zoneEditor.to') }}<input
        class="form-control xm-mono"
        :aria-label="t('zoneEditor.zoneTo')"
        :value="noteName(zone.hi)"
        @change="range('hi', $event)"
      ></label>
    </div>
    <label class="form-label">{{ t('zoneEditor.playsTracks') }}</label>
    <div class="xm-zone-tracks mb-3">
      <label
        v-for="midiTrack in doc.project.tracks.filter((midiTrack) => midiTrack.kind === 'midi')"
        :key="midiTrack.id"
        class="xm-row"
      ><input
        class="form-check-input"
        type="checkbox"
        :checked="zone.trackIds.includes(midiTrack.id)"
        @change="track(midiTrack.id, ($event.target as HTMLInputElement).checked)"
      ><span
        class="xm-chip is-sm"
        :style="{ '--c': midiTrack.color }"
      ><i class="xm-sw" />{{ midiTrack.name }}</span></label>
      <p
        v-if="!doc.project.tracks.some((t) => t.kind === 'midi')"
        class="xm-faint p-2 mb-0"
      >
        {{ t('zoneEditor.addAMIDITrackFirst') }}
      </p>
    </div>
    <div class="row g-2 mb-2">
      <label class="col form-label">{{ t('patchPanel.transpose') }}<input
        class="form-control xm-mono"
        type="number"
        step="1"
        :aria-label="t('zoneEditor.zoneTranspose')"
        :value="zone.transpose"
        @change="
          apply({
            transpose: Number(($event.target as HTMLInputElement).value),
          })
        "
      ></label>
      <label class="col form-label">{{ t('actionPicker.velocity') }}<select
        class="form-select"
        :aria-label="t('zoneEditor.zoneVelocity')"
        :value="typeof zone.velocity === 'number' ? 'custom' : zone.velocity"
        @change="
          apply({
            velocity:
              ($event.target as HTMLSelectElement).value === 'custom'
                ? 1
                : (($event.target as HTMLSelectElement)
                  .value as Zone['velocity']),
          })
        "
      >
        <option value="linear">{{ t('zoneEditor.linear') }}</option>
        <option value="soft">{{ t('zoneEditor.soft') }}</option>
        <option value="hard">{{ t('zoneEditor.hard') }}</option>
        <option value="custom">{{ t('zoneEditor.customPower') }}</option>
      </select></label>
    </div>
    <label
      v-if="typeof zone.velocity === 'number'"
      class="form-label"
    >{{ t('zoneEditor.velocityPower') }}<input
      class="form-control"
      type="number"
      min="0.01"
      step="0.1"
      :value="zone.velocity"
      @change="
        apply({ velocity: Number(($event.target as HTMLInputElement).value) })
      "
    ></label>
    <label class="form-label">{{ t('scenesPanel.colour') }}</label>
    <div class="xm-wrap mb-3">
      <button
        v-for="color in palette"
        :key="color"
        class="xm-color-choice"
        :style="{ background: color }"
        :aria-label="`Zone colour ${color}`"
        :aria-pressed="zone.color === color"
        @click="apply({ color })"
      />
    </div>
    <p
      v-if="error"
      class="text-danger"
      role="alert"
    >
      {{ error }}
    </p>
    <p class="xm-faint">
      {{ t('patchPanel.editing') }} {{ performance.label }}
    </p>
    <div class="xm-row justify-content-between">
      <button
        class="btn btn-sm btn-ghost text-danger"
        @click="remove"
      >
        <i class="bi bi-trash" /> {{ t('zoneEditor.deleteZone') }}
      </button><button
        class="btn btn-sm btn-ghost"
        :aria-pressed="learning"
        @click="toggleLearn"
      >
        {{ learning ? 'Finish range learn' : 'Learn range from keys' }}
      </button>
    </div>
    <p
      v-if="learning"
      class="xm-faint mt-2 mb-0"
      role="status"
    >
      {{ t('zoneEditor.playTheLowestAndHighestKeysOfTheRange') }}
    </p>
  </EditorPopover>
</template>
