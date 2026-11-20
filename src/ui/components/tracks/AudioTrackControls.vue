<script setup lang="ts">
import type { AudioTrack } from '../../../shared/model'
import { useProjectStore } from '../../stores/project'
const props = defineProps<{ track: AudioTrack }>(),
  doc = useProjectStore()
function edit(change: (track: AudioTrack) => void): void {
  doc.update((d) => {
    const t = d.tracks.find((t) => t.id === props.track.id)
    if (t?.kind === 'audio') change(t)
  })
}
function spectrum(change: Partial<NonNullable<AudioTrack['spectrum']>>) {
  edit((t) => {
    t.spectrum = {
      floorDb: -90,
      gain: 0,
      palette: 'magma',
      pitchAligned: false,
      ...t.spectrum,
      ...change,
    }
  })
}
</script>
<template>
  <div class="xm-audio-controls">
    <label>View
      <select
        :value="track.display ?? 'wave'"
        @change="
          edit(
            (t) =>
              (t.display = ($event.target as HTMLSelectElement)
                .value as AudioTrack['display']),
          )
        "
      >
        <option value="wave">Wave</option>
        <option value="spectrum">Spectrum</option>
        <option value="both">Both</option>
      </select></label>
    <template v-if="track.display && track.display !== 'wave'">
      <label>Floor
        <input
          type="range"
          min="-90"
          max="-1"
          :value="track.spectrum?.floorDb ?? -90"
          @input="
            spectrum({
              floorDb: Number(($event.target as HTMLInputElement).value),
            })
          "
        ></label>
      <label>Gain
        <input
          type="range"
          min="-48"
          max="48"
          :value="track.spectrum?.gain ?? 0"
          @input="
            spectrum({
              gain: Number(($event.target as HTMLInputElement).value),
            })
          "
        ></label>
      <label>Palette
        <select
          :value="track.spectrum?.palette ?? 'magma'"
          @change="
            spectrum({
              palette: ($event.target as HTMLSelectElement).value as
                'magma' | 'gray',
            })
          "
        >
          <option>magma</option>
          <option>gray</option>
        </select></label>
      <label>Overlay
        <select
          :value="track.spectrum?.overlayTrackId ?? ''"
          @change="
            spectrum({
              overlayTrackId:
                ($event.target as HTMLSelectElement).value || undefined,
            })
          "
        >
          <option value="">None</option>
          <option
            v-for="t in doc.project.tracks.filter((t) => t.kind === 'midi')"
            :key="t.id"
            :value="t.id"
          >
            {{ t.name }}
          </option>
        </select></label>
      <label><input
        type="checkbox"
        :checked="track.spectrum?.pitchAligned"
        @change="
          spectrum({
            pitchAligned: ($event.target as HTMLInputElement).checked,
          })
        "
      >
        Match pitch range</label>
    </template>
    <label title="Pitch in semitones"><input
      type="number"
      min="-12"
      max="12"
      step="1"
      :value="track.semitones"
      :aria-label="`${track.name} semitones`"
      @change="
        edit((t) => {
          t.semitones = Math.max(
            -12,
            Math.min(12, Number(($event.target as HTMLInputElement).value)),
          )
        })
      "
    >st</label>
    <label title="Fine pitch in cents"><input
      type="number"
      min="-50"
      max="50"
      step="1"
      :value="track.cents"
      :aria-label="`${track.name} cents`"
      @change="
        edit((t) => {
          t.cents = Math.max(
            -50,
            Math.min(50, Number(($event.target as HTMLInputElement).value)),
          )
        })
      "
    >ct</label>
    <select
      :value="track.channelMode"
      :aria-label="`${track.name} channel mode`"
      @change="
        edit((t) => {
          t.channelMode = ($event.target as HTMLSelectElement)
            .value as AudioTrack['channelMode']
        })
      "
    >
      <option value="stereo">
        L+R
      </option>
      <option value="left">
        Left
      </option>
      <option value="right">
        Right
      </option>
      <option value="mid">
        Mid
      </option>
      <option value="side">
        Side
      </option>
    </select>
    <button
      class="xm-sq"
      :class="{ 'is-on': track.toCue }"
      :aria-label="`${track.name} to cue`"
      :aria-pressed="track.toCue"
      title="To cue output"
      @click="
        edit((t) => {
          t.toCue = !t.toCue
        })
      "
    >
      <i class="bi bi-headphones" />
    </button>
    <details class="xm-audio-filter">
      <summary
        class="xm-sq"
        :class="{ 'is-on': track.filter.enabled }"
        :aria-label="`${track.name} filter`"
        title="Filter"
      >
        <i class="bi bi-funnel" />
      </summary>
      <div class="xm-filter-popover">
        <label><input
          type="checkbox"
          :checked="track.filter.enabled"
          @change="
            edit((t) => {
              t.filter.enabled = ($event.target as HTMLInputElement).checked
            })
          "
        >
          Filter</label>
        <label>Type<select
          :value="track.filter.type"
          @change="
            edit((t) => {
              t.filter.type = ($event.target as HTMLSelectElement)
                .value as AudioTrack['filter']['type']
            })
          "
        >
          <option value="lowpass">Low-pass</option>
          <option value="highpass">High-pass</option>
          <option value="bandpass">Band-pass</option>
        </select></label>
        <label>Frequency {{ Math.round(track.filter.freq) }} Hz<input
          type="range"
          min="1.30103"
          max="4.30103"
          step=".01"
          :value="Math.log10(track.filter.freq)"
          @input="
            edit((t) => {
              t.filter.freq =
                10 ** Number(($event.target as HTMLInputElement).value)
            })
          "
        ></label>
        <label>Q {{ track.filter.q.toFixed(1)
        }}<input
          type="range"
          min=".1"
          max="20"
          step=".1"
          :value="track.filter.q"
          @input="
            edit((t) => {
              t.filter.q = Number(($event.target as HTMLInputElement).value)
            })
          "
        ></label>
      </div>
    </details>
  </div>
</template>
