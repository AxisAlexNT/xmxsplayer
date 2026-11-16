<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '../../shared/model'
import { noteName } from '../../shared/schema'
import { engineBus } from '../bus'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import EditorPopover from './EditorPopover.vue'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  open = ref(false),
  anchor = ref({ right: 0, top: 60 }),
  error = ref('')
const mode = computed(() => runtime.state.followMode ?? doc.project.follow.mode)
const liveTracks = computed(() =>
  doc.project.tracks.filter(
    (t) =>
      t.kind === 'midi' &&
      (runtime.state.trackModes?.[t.id] ?? t.mode) === 'live',
  ),
)
const label = computed(() =>
  mode.value === 'written'
    ? 'Written'
    : mode.value === 'waitNotes'
      ? `Wait for notes · ${doc.project.follow.strictness}`
      : 'Track my tempo',
)
const expected = computed(
  () => runtime.state.expectedNext?.keys.map(noteName).join(' + ') ?? '',
)
const choices = [
  {
    mode: 'written',
    title: 'Written tempo',
    description: 'Computer leads; nudge with speed or tap',
  },
  {
    mode: 'waitNotes',
    title: 'Wait for my notes',
    description: 'Holds at each expected note',
  },
  {
    mode: 'tempoTrack',
    title: 'Track my tempo',
    description: 'Follows your speed, ignores wrong notes',
  },
] as const
function toggle(event: MouseEvent): void {
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  anchor.value = { right: r.left - 8, top: r.bottom + 8 }
  open.value = !open.value
}
function apply(patch: Partial<Project['follow']>): void {
  try {
    doc.update((project) => {
      if (patch.range && patch.range[0] > patch.range[1])
        throw Error('Tempo limits must be ordered')
      Object.assign(project.follow, patch)
    })
    error.value = ''
  } catch {
    error.value =
      'Use nonnegative timing, positive ordered tempo limits, smoothing from 0 to 1 and nonnegative phase gain.'
  }
}
function select(value: Project['follow']['mode']): void {
  apply({ mode: value })
  engineBus.value?.send('action:run', {
    action: { type: 'follow', mode: value },
  })
}
function numeric(
  key: 'chordWindowMs' | 'earlyMs' | 'smoothing' | 'phaseGain',
  event: Event,
): void {
  apply({ [key]: Number((event.target as HTMLInputElement).value) })
}
function range(index: 0 | 1, event: Event): void {
  const range: [number, number] = [...doc.project.follow.range]
  range[index] = Number((event.target as HTMLInputElement).value) / 100
  apply({ range })
}
function lead(id: string): void {
  doc.update((project) => {
    const track = project.tracks.find((t) => t.id === id)
    if (track?.kind === 'midi') track.leads = !track.leads
  })
}
</script>
<template>
  <div class="xm-field xm-follow-control">
    <span>Follow
      <span
        v-if="runtime.transport.holding"
        class="xm-hold"
      >HOLDING</span></span>
    <div class="xm-row">
      <button
        class="btn btn-sm btn-xm dropdown-toggle"
        aria-label="Follow mode"
        :aria-expanded="open"
        :disabled="!runtime.connected"
        @click="toggle"
      >
        <span>{{ label }}</span>
        <small
          v-if="runtime.transport.holding"
          class="xm-follow-hint"
          role="status"
        >{{
          runtime.state.followHolding && expected
            ? `Waiting for ${expected}`
            : runtime.state.armedCueId
              ? 'Waiting for cue'
              : 'Waiting for release'
        }}</small>
        <small
          v-else-if="runtime.transport.countInBeat"
          class="xm-follow-hint"
        >Count-in {{ runtime.transport.countInBeat }}</small>
      </button>
    </div>
  </div>
  <EditorPopover
    v-if="open"
    title="Follow mode"
    :anchor="anchor"
    @close="open = false"
  >
    <div class="xm-follow-pop">
      <div
        class="xm-list mb-3"
        role="radiogroup"
        aria-label="Follow behaviour"
      >
        <label
          v-for="choice in choices"
          :key="choice.mode"
          class="xm-follow-choice"
          :class="{ 'is-sel': mode === choice.mode }"
        >
          <input
            type="radio"
            name="follow-mode"
            class="form-check-input"
            :checked="mode === choice.mode"
            :value="choice.mode"
            @change="select(choice.mode)"
          >
          <span><b>{{ choice.title }}</b><small class="xm-faint">{{ choice.description }}</small></span>
        </label>
      </div>
      <template v-if="mode === 'waitNotes'">
        <label class="form-label">Advance when I play</label>
        <div class="xm-seg mb-3">
          <button
            v-for="strictness in ['any', 'all'] as const"
            :key="strictness"
            :class="{ 'is-on': doc.project.follow.strictness === strictness }"
            :aria-pressed="doc.project.follow.strictness === strictness"
            @click="apply({ strictness })"
          >
            {{
              strictness === 'any'
                ? 'Any expected note'
                : 'All notes of the chord'
            }}
          </button>
        </div>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <label
              for="follow-window"
              class="form-label"
            >Chord window</label>
            <div class="input-group">
              <input
                id="follow-window"
                type="number"
                min="0"
                step="10"
                class="form-control xm-mono"
                :value="doc.project.follow.chordWindowMs"
                aria-label="Follow chord window milliseconds"
                @change="numeric('chordWindowMs', $event)"
              ><span class="input-group-text">ms</span>
            </div>
          </div>
          <div class="col-6">
            <label
              for="follow-early"
              class="form-label"
            >Early notes count</label>
            <div class="input-group">
              <input
                id="follow-early"
                type="number"
                min="0"
                step="10"
                class="form-control xm-mono"
                :value="doc.project.follow.earlyMs"
                aria-label="Follow early notes milliseconds"
                @change="numeric('earlyMs', $event)"
              ><span class="input-group-text">ms</span>
            </div>
          </div>
        </div>
      </template>
      <template v-if="mode === 'tempoTrack'">
        <label class="form-label">Tempo range</label>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <div class="input-group">
              <input
                type="number"
                class="form-control xm-mono"
                min="1"
                step="5"
                :value="doc.project.follow.range[0] * 100"
                aria-label="Follow minimum tempo percent"
                @change="range(0, $event)"
              ><span class="input-group-text">%</span>
            </div>
          </div>
          <div class="col-6">
            <div class="input-group">
              <input
                type="number"
                class="form-control xm-mono"
                min="1"
                step="5"
                :value="doc.project.follow.range[1] * 100"
                aria-label="Follow maximum tempo percent"
                @change="range(1, $event)"
              ><span class="input-group-text">%</span>
            </div>
          </div>
        </div>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <label
              for="follow-smoothing"
              class="form-label"
            >Smoothing</label><input
              id="follow-smoothing"
              type="number"
              class="form-control xm-mono"
              min="0"
              max="1"
              step=".05"
              :value="doc.project.follow.smoothing"
              aria-label="Follow smoothing"
              @change="numeric('smoothing', $event)"
            >
          </div>
          <div class="col-6">
            <label
              for="follow-phase"
              class="form-label"
            >Phase gain</label><input
              id="follow-phase"
              type="number"
              class="form-control xm-mono"
              min="0"
              step=".05"
              :value="doc.project.follow.phaseGain"
              aria-label="Follow phase gain"
              @change="numeric('phaseGain', $event)"
            >
          </div>
        </div>
        <small class="xm-faint d-block mb-3">Lower smoothing changes tempo more gently. Phase gain controls how
          quickly accompaniment catches up.</small>
      </template>
      <template v-if="mode !== 'written'">
        <label class="form-label">Lead tracks</label>
        <div class="xm-wrap">
          <button
            v-for="track in liveTracks"
            :key="track.id"
            class="xm-chip"
            :style="{ '--c': track.color }"
            :class="{ 'is-active': track.kind === 'midi' && track.leads }"
            :aria-pressed="track.kind === 'midi' && track.leads"
            @click="lead(track.id)"
          >
            <i
              class="xm-dot"
              :style="{ background: track.color }"
            />{{
              track.name
            }}
          </button>
        </div>
        <small
          v-if="!liveTracks.some((t) => t.kind === 'midi' && t.leads)"
          class="xm-faint d-block mt-2"
        >Choose a live MIDI track with guide notes to lead playback.</small>
      </template>
      <button
        v-if="runtime.transport.holding"
        class="btn btn-xm mt-3"
        @click="
          engineBus?.send('action:run', {
            action: { type: 'transport', cmd: 'skipHold' },
          })
        "
      >
        Skip hold
      </button>
      <p
        v-if="error"
        class="text-danger mt-2 mb-0"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
  </EditorPopover>
</template>
