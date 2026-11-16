<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { engineBus } from '../bus'
import type { Instrument } from '../../shared/model'
import type { CommandMap } from '../../shared/protocol'
import type { Preset } from '../../engine/synth/backend'
const props = defineProps<{ instrumentId: string }>()
const emit = defineEmits<{ close: [] }>()
const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
const instrument = doc.project.instruments.find(
  (i) => i.id === props.instrumentId,
)!
const fontId = ref(
  instrument.soundfontId ?? doc.project.soundfonts[0]?.id ?? '',
)
const presets = ref<Preset[]>([])
const selected = ref<Preset | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref('')
const backendChoice = ref<Instrument['backend']>(instrument.backend)
const portName = ref(instrument.midiOut?.portName ?? '')
const channel = ref(instrument.midiOut?.channel ?? 0)
const bank = ref(instrument.bank)
const program = ref(instrument.program)
const name = ref(instrument.name)
const external = computed(() => backendChoice.value === 'midi')
const portNames = computed(() => [
  ...new Set(runtime.midi.outputs.map((port) => port.name)),
])
const externalValid = computed(
  () =>
    !!portName.value &&
    Number.isInteger(channel.value) &&
    channel.value >= 0 &&
    channel.value <= 15 &&
    Number.isInteger(bank.value) &&
    bank.value >= 0 &&
    bank.value <= 16383 &&
    Number.isInteger(program.value) &&
    program.value >= 0 &&
    program.value <= 127,
)
const choice = computed<CommandMap['audition:select']>(() =>
  external.value
    ? externalValid.value
      ? {
          backend: 'midi',
          midiOut: { portName: portName.value, channel: channel.value },
          soundfontId: '',
          bank: bank.value,
          program: program.value,
          isDrum: channel.value === 9,
        }
      : null
    : selected.value
      ? {
          backend: backendChoice.value,
          soundfontId: fontId.value,
          bank: selected.value.bank,
          program: selected.value.program,
          isDrum: selected.value.isDrum,
        }
      : null,
)

const volume = ref(instrument.volume)
const pan = ref(instrument.pan)
const reverb = ref(instrument.reverb)
const chorus = ref(instrument.chorus)
const dialog = ref<HTMLDialogElement>()
const filtered = computed(() =>
  presets.value.filter((p) =>
    `${p.name} ${p.bank}:${p.program}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
)
let generation = 0
let releaseTimer: ReturnType<typeof setTimeout>
async function load(): Promise<void> {
  const current = ++generation
  if (external.value) {
    loading.value = false
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  selected.value = null
  presets.value = []
  try {
    const values = await engineBus.value!.request(
      'soundfont:presets',
      { soundfontId: fontId.value },
      30000,
    )
    if (current !== generation) return
    presets.value = values
    selected.value =
      values.find(
        (p) =>
          p.bank === instrument.bank &&
          p.program === instrument.program &&
          p.isDrum === instrument.isDrum,
      ) ??
      values[0] ??
      null
  } catch (reason) {
    if (current === generation) error.value = String(reason)
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(fontId, () => {
  void load()
})
watch(backendChoice, (value, previous) => {
  if (value === 'midi') {
    generation++
    loading.value = false
    error.value = ''
  } else if (previous === 'midi') void load()
})
watch(choice, (value) => engineBus.value?.send('audition:select', value), { immediate: true })

function selectFont(id: string): void {
  if (external.value) backendChoice.value = 'default'
  fontId.value = id
}
function audition(): void {
  if (!choice.value) return
  const payload = { ...choice.value, key: 60 }
  engineBus.value?.send('audition:preset', { ...payload, on: true })
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(
    () => engineBus.value?.send('audition:preset', { ...payload, on: false }),
    600,
  )
}
function usePreset(): void {
  const value = choice.value
  if (!value) return
  doc.update((p) => {
    const target = p.instruments.find((i) => i.id === props.instrumentId)!
    Object.assign(target, {
      backend: backendChoice.value,
      soundfontId: external.value ? undefined : fontId.value,
      bank: value.bank,
      program: value.program,
      isDrum: value.isDrum,
      name: external.value
        ? name.value.trim() || 'External MIDI'
        : selected.value!.name,
      midiOut: value.midiOut,
      volume: volume.value,
      pan: pan.value,
      reverb: reverb.value,
      chorus: chorus.value,
    })
  })
  emit('close')
}
onMounted(() => {
  dialog.value!.showModal()
  void load()
})
onUnmounted(() => {
  generation++
  clearTimeout(releaseTimer)
  engineBus.value?.send('audition:preset', {
    soundfontId: fontId.value,
    bank: 0,
    program: 0,
    isDrum: false,
    key: 60,
    on: false,
  })
  engineBus.value?.send('audition:select', null)
  dialog.value?.close()
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-instrument-dialog"
    aria-labelledby="instrument-title"
    @cancel.prevent="emit('close')"
  >
    <div class="xm-dialog-h">
      <h5 id="instrument-title">
        Instrument — {{ instrument.name }}
      </h5>
      <button
        class="btn btn-sm btn-ghost"
        aria-label="Close instrument picker"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-dialog-b">
      <div class="xm-picker-columns">
        <div>
          <label class="form-label">Soundfont</label>
          <div class="xm-list">
            <button
              v-for="sf in doc.project.soundfonts"
              :key="sf.id"
              class="xm-list-button"
              :class="{ 'is-selected': !external && fontId === sf.id }"
              @click="selectFont(sf.id)"
            >
              {{ sf.file }}
            </button>
            <button
              class="xm-list-button"
              :class="{ 'is-selected': external }"
              @click="backendChoice = 'midi'"
            >
              <i class="bi bi-box-arrow-up-right" /> External MIDI port…
            </button>
          </div>
        </div>
        <div
          v-if="external"
          class="xm-external-fields"
        >
          <label class="form-label">Name<input
            v-model="name"
            class="form-control"
            aria-label="External MIDI instrument name"
          ></label>
          <label class="form-label">MIDI output<select
            v-model="portName"
            class="form-select"
            aria-label="External MIDI output"
          >
            <option
              value=""
              disabled
            >Select a MIDI output</option>
            <option
              v-if="portName && !portNames.includes(portName)"
              :value="portName"
            >
              {{ portName }} · disconnected
            </option>
            <option
              v-for="port in portNames"
              :key="port"
              :value="port"
            >
              {{ port }}
            </option>
          </select></label>
          <label class="form-label">Channel<select
            v-model.number="channel"
            class="form-select"
            aria-label="External MIDI channel"
          >
            <option
              v-for="n in 16"
              :key="n"
              :value="n - 1"
            >{{ n }}</option>
          </select></label>
          <div class="xm-row">
            <label class="form-label">Bank (0–16383)<input
              v-model.number="bank"
              class="form-control"
              type="number"
              min="0"
              max="16383"
              step="1"
              aria-label="External MIDI bank"
            ></label>
            <label class="form-label">Program (0–127)<input
              v-model.number="program"
              class="form-control"
              type="number"
              min="0"
              max="127"
              step="1"
              aria-label="External MIDI program"
            ></label>
          </div>
          <p class="xm-faint">
            Use separate channels for overlapping sounds. Volume, pan, effects
            and expression are shared by each physical channel.
          </p>
          <p
            v-if="!runtime.midi.outputs.length"
            class="xm-faint"
            role="status"
          >
            No MIDI outputs connected.
          </p>
        </div>
        <div v-else>
          <label
            class="form-label"
            for="preset-search"
          >Preset</label><input
            id="preset-search"
            v-model="query"
            type="search"
            class="form-control mb-2"
            placeholder="Search presets"
            autofocus
          >
          <div
            v-if="error"
            class="xm-banner"
            role="alert"
          >
            {{ error }}
            <button
              class="btn btn-sm btn-xm"
              @click="load"
            >
              Retry
            </button>
          </div>
          <p
            v-else-if="loading"
            role="status"
          >
            Loading presets…
          </p>
          <div
            v-else
            class="xm-list xm-presets"
          >
            <button
              v-for="preset in filtered"
              :key="`${preset.bank}:${preset.program}:${preset.isDrum}`"
              class="xm-list-button"
              :class="{ 'is-selected': selected === preset }"
              @click="selected = preset"
            >
              <span class="xm-mono xm-faint">{{ String(preset.bank).padStart(3, '0') }}:{{
                String(preset.program).padStart(3, '0')
              }}</span>
              {{ preset.name }} <i
                v-if="preset.isDrum"
                class="bi bi-grid"
              />
            </button>
            <p
              v-if="!filtered.length"
              class="xm-faint p-2 mb-0"
            >
              No matching presets
            </p>
          </div>
        </div>
      </div>
      <label
        v-if="!external"
        class="form-label mt-3"
      >Engine</label>
      <div
        v-if="!external"
        class="xm-seg"
      >
        <button
          :class="{ 'is-on': backendChoice === 'default' }"
          :aria-pressed="backendChoice === 'default'"
          @click="backendChoice = 'default'"
        >
          Default ({{
            settings.value.audio.defaultSynth === 'fluid'
              ? 'FluidSynth'
              : 'Built-in'
          }})
        </button><button
          :class="{ 'is-on': backendChoice === 'web' }"
          :aria-pressed="backendChoice === 'web'"
          @click="backendChoice = 'web'"
        >
          Built-in
        </button><button
          :class="{ 'is-on': backendChoice === 'fluid' }"
          :aria-pressed="backendChoice === 'fluid'"
          @click="backendChoice = 'fluid'"
        >
          FluidSynth
        </button>
      </div>
      <div class="xm-picker-controls mt-3">
        <label
          v-for="field in ['Volume', 'Pan', 'Reverb', 'Chorus']"
          :key="field"
          class="form-label"
        >{{ field
        }}<input
          v-if="field === 'Volume'"
          v-model.number="volume"
          class="form-range"
          type="range"
          min="0"
          max="1"
          step="0.01"
        ><input
          v-else-if="field === 'Pan'"
          v-model.number="pan"
          class="form-range"
          type="range"
          min="-1"
          max="1"
          step="0.01"
        ><input
          v-else-if="field === 'Reverb'"
          v-model.number="reverb"
          class="form-range"
          type="range"
          min="0"
          max="1"
          step="0.01"
        ><input
          v-else
          v-model.number="chorus"
          class="form-range"
          type="range"
          min="0"
          max="1"
          step="0.01"
        ></label>
      </div>
      <button
        class="btn btn-sm btn-xm"
        :disabled="!choice"
        @click="audition"
      >
        <i class="bi bi-volume-up" /> Audition
      </button>
    </div>
    <div class="xm-dialog-f">
      <span class="xm-faint me-auto">Play your keyboard to audition</span><button
        class="btn btn-xm"
        @click="emit('close')"
      >
        Cancel
      </button><button
        class="btn btn-primary"
        :disabled="!choice || !runtime.connected"
        @click="usePreset"
      >
        Use preset
      </button>
    </div>
  </dialog>
</template>
