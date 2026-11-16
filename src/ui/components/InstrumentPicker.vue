<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { engineBus } from '../bus'
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
const backendChoice = ref<'default' | 'web' | 'fluid'>(instrument.backend === 'fluid' ? 'fluid' : instrument.backend === 'web' ? 'web' : 'default')
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
watch([selected,backendChoice], ([value]) =>
  engineBus.value?.send(
    'audition:select',
    value
      ? {
          soundfontId: fontId.value,
          backend: backendChoice.value,
          bank: value.bank,
          program: value.program,
          isDrum: value.isDrum,
        }
      : null,
  ),
)
function audition(): void {
  if (!selected.value) return
  const payload = { ...selected.value, soundfontId: fontId.value, key: 60, backend:backendChoice.value }
  engineBus.value?.send('audition:preset', { ...payload, on: true })
  clearTimeout(releaseTimer)
  releaseTimer = setTimeout(
    () => engineBus.value?.send('audition:preset', { ...payload, on: false }),
    600,
  )
}
function usePreset(): void {
  const value = selected.value
  if (!value) return
  doc.update((p) => {
    const target = p.instruments.find((i) => i.id === props.instrumentId)!
    Object.assign(target, {
      backend: backendChoice.value,
      soundfontId: fontId.value,
      bank: value.bank,
      program: value.program,
      isDrum: value.isDrum,
      name: value.name,
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
              :class="{ 'is-selected': fontId === sf.id }"
              @click="fontId = sf.id"
            >
              {{ sf.file }}
            </button>
          </div>
        </div>
        <div>
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
      <label class="form-label mt-3">Engine</label><div class="xm-seg">
        <button
          :class="{'is-on':backendChoice==='default'}"
          :aria-pressed="backendChoice==='default'"
          @click="backendChoice='default'"
        >
          Default ({{ settings.value.audio.defaultSynth === 'fluid' ? 'FluidSynth' : 'Built-in' }})
        </button><button
          :class="{'is-on':backendChoice==='web'}"
          :aria-pressed="backendChoice==='web'"
          @click="backendChoice='web'"
        >
          Built-in
        </button><button
          :class="{'is-on':backendChoice==='fluid'}"
          :aria-pressed="backendChoice==='fluid'"
          @click="backendChoice='fluid'"
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
        :disabled="!selected"
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
        :disabled="!selected || !runtime.connected"
        @click="usePreset"
      >
        Use preset
      </button>
    </div>
  </dialog>
</template>
