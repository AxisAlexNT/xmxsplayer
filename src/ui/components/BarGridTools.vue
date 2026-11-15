<script setup lang="ts">
import { computed, ref } from 'vue'
import { TimeMap } from '../../shared/time-map'
import { fitAudioLength, snapLoop } from '../../shared/beat-grid'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  unit = ref<'beat' | 'bar'>('beat')
const map = computed(() => new TimeMap(doc.project)),
  audio = computed(() => doc.project.tracks.filter((t) => t.kind === 'audio')),
  selected = computed({
    get: () =>
      runtime.selectedAudioId &&
      audio.value.some((t) => t.id === runtime.selectedAudioId)
        ? runtime.selectedAudioId
        : (audio.value[0]?.id ?? ''),
    set: (id: string) => {
      runtime.selectedAudioId = id
    },
  })
function tempo(value: number): void {
  if (doc.project.mapOwner !== null) return
  doc.update((d) => {
    d.tempos = [{ tick: 0, bpm: Math.max(20, Math.min(400, value)) }]
    d.beatAnchors = []
    d.lengthTicks = fitAudioLength(d)
  })
}
function scale(factor: number): void {
  doc.update((d) => {
    d.tempos = d.tempos.map((t) => ({ ...t, bpm: t.bpm * factor }))
    d.beatAnchors = d.beatAnchors.map((a) => ({ ...a, tick: a.tick * factor }))
    d.lengthTicks = fitAudioLength(d)
  })
}
function tapMap(active: boolean, discard = false): void {
  engineBus.value?.send('grid:tapMap', {
    active,
    trackId: selected.value,
    unit: unit.value,
    discard,
  })
}
function clear(): void {
  doc.update((d) => {
    d.tempos = [{ tick: 0, bpm: map.value.tempoAt(0) }]
    d.beatAnchors = []
    d.lengthTicks = fitAudioLength(d)
  })
}
</script>
<template>
  <details class="xm-grid-tools">
    <summary
      title="Bar grid"
      aria-label="Bar grid"
    >
      <i class="bi bi-rulers" /> Bars <i class="bi bi-chevron-down" />
    </summary>
    <div class="xm-grid-popover">
      <b>Bar grid</b><span
        v-if="doc.project.mapOwner !== null"
        class="xm-muted"
      >Tempo comes from the linked score.</span>
      <fieldset :disabled="doc.project.mapOwner !== null">
        <label>BPM<input
          type="number"
          min="20"
          max="400"
          step=".1"
          :value="map.tempoAt(runtime.transport.tick).toFixed(1)"
          :disabled="doc.project.beatAnchors.length > 1"
          aria-label="Grid BPM"
          @change="tempo(Number(($event.target as HTMLInputElement).value))"
        ></label>
        <div class="xm-row">
          <button
            class="btn btn-sm btn-xm"
            @click="scale(0.5)"
          >
            Halve
          </button><button
            class="btn btn-sm btn-xm"
            @click="scale(2)"
          >
            Double
          </button><button
            class="btn btn-sm btn-xm"
            @click="
              engineBus?.send('action:run', {
                action: { type: 'transport', cmd: 'tap' },
              })
            "
          >
            Tap tempo
          </button>
        </div>
        <label>Reference<select
          v-model="selected"
          :disabled="runtime.tapMap.active"
          aria-label="Grid reference"
        >
          <option
            v-for="track in audio"
            :key="track.id"
            :value="track.id"
          >
            {{ track.name }}
          </option>
          <option
            v-if="!audio.length"
            value=""
          >Import audio first</option>
        </select></label>
        <button
          class="btn btn-sm btn-xm"
          :disabled="!selected"
          @click="engineBus?.send('grid:barOne', { trackId: selected })"
        >
          Set bar 1 at playhead
        </button>
        <div class="xm-row">
          <select
            v-model="unit"
            :disabled="runtime.tapMap.active"
            aria-label="Tap map unit"
          >
            <option value="beat">
              Tap beats
            </option>
            <option value="bar">
              Tap bars
            </option>
          </select><button
            v-if="!runtime.tapMap.active"
            class="btn btn-sm btn-xm"
            :disabled="!selected || doc.project.loop.enabled"
            title="Turn looping off, start audio, then tap each beat or bar"
            @click="tapMap(true)"
          >
            Tap beat map
          </button><button
            v-else
            class="btn btn-sm btn-primary"
            :disabled="runtime.tapMap.anchors.length < 2"
            @click="tapMap(false)"
          >
            Use {{ runtime.tapMap.anchors.length }} taps
          </button>
        </div>
        <div
          v-if="runtime.tapMap.active"
          class="xm-row"
        >
          <button
            class="btn btn-primary"
            :disabled="
              !runtime.transport.playing || !!runtime.transport.countInBeat
            "
            @click="
              engineBus?.send('action:run', {
                action: { type: 'transport', cmd: 'tapBeat' },
              })
            "
          >
            Tap beat
          </button><button
            class="btn btn-sm btn-ghost"
            @click="tapMap(false, true)"
          >
            Cancel
          </button><small>{{ runtime.tapMap.anchors.length }} taps</small>
        </div>
        <small v-if="runtime.tapMap.active">Start audio, then tap. The first tap marks bar 1. Finish to apply the
          map.</small>
        <button
          v-if="doc.project.beatAnchors.length"
          class="btn btn-sm btn-ghost"
          @click="clear"
        >
          Clear beat map
        </button>
      </fieldset>
      <hr>
      <b>Metronome</b><label><input
        type="checkbox"
        :checked="doc.project.metronome.audible"
        @change="
          doc.update((d) => {
            d.metronome.audible = ($event.target as HTMLInputElement).checked
          })
        "
      >
        Audible click</label><label><input
        type="checkbox"
        :checked="doc.project.metronome.visualScreen"
        @change="
          doc.update((d) => {
            d.metronome.visualScreen = (
              $event.target as HTMLInputElement
            ).checked
          })
        "
      >
        Screen beats</label><label><input
        type="checkbox"
        :checked="doc.project.metronome.visualPads"
        @change="
          doc.update((d) => {
            d.metronome.visualPads = (
              $event.target as HTMLInputElement
            ).checked
          })
        "
      >
        Pad beats</label><label><input
        type="checkbox"
        :checked="doc.project.metronome.toCue"
        @change="
          doc.update((d) => {
            d.metronome.toCue = ($event.target as HTMLInputElement).checked
          })
        "
      >
        Click to cue</label><label>Count-in<select
        :value="doc.project.metronome.countInBars"
        aria-label="Count-in bars"
        @change="
          doc.update((d) => {
            d.metronome.countInBars = Number(
              ($event.target as HTMLSelectElement).value,
            )
          })
        "
      >
        <option
          v-for="bars in [0, 1, 2, 4]"
          :key="bars"
          :value="bars"
        >
          {{ bars ? `${bars} bar${bars === 1 ? '' : 's'}` : 'Off' }}
        </option>
      </select></label>
      <hr>
      <button
        class="btn btn-sm btn-xm"
        @click="
          doc.update((d) => {
            d.loop = snapLoop(map, d.loop)
          })
        "
      >
        Snap loop to bars
      </button>
    </div>
  </details>
</template>
