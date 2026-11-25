<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { engineBus } from '../bus'
import { addFont } from '../../shared/soundfont-ops'
import { uniqueId } from '../../shared/ids'
import {
  gmFamilies,
  favouriteKey,
  searchPresets,
} from '../../shared/preset-search'
import type { SoundFontIndexEntry } from '../../shared/api'
import { useI18n } from '../i18n'
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
const { t } = useI18n()
const index = shallowRef<SoundFontIndexEntry[]>([])
const scope = ref('')
const selectedFile = ref(
  doc.project.soundfonts.find((f) => f.id === instrument.soundfontId)?.file ??
    '',
)
const includeLibrary = ref(false),
  family = ref(''),
  onlyFavourites = ref(false),
  saving = ref(false)
const favourites = computed(
  () => new Set(settings.value.soundfontFavourites ?? []),
)
const fontId = computed(
  () =>
    doc.project.soundfonts.find((f) => f.file === selectedFile.value)?.id ??
    uniqueId(
      selectedFile.value.replace(/\.sf[23]$/i, ''),
      doc.project.soundfonts.map((f) => f.id),
    ),
)
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
          soundfontFile: selectedFile.value,
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
const groups = computed(() =>
  searchPresets(
    index.value,
    new Set(doc.project.soundfonts.map((f) => f.file)),
    {
      file: scope.value,
      library: includeLibrary.value,
      query: query.value,
      family: family.value,
      onlyFavourites: onlyFavourites.value,
      favourites: favourites.value,
    },
  ),
)
let releaseTimer: ReturnType<typeof setTimeout>
async function load() {
  loading.value = true
  try {
    index.value = await window.xm.soundfonts.index()
    const presets =
      index.value.find((e) => e.file === selectedFile.value)?.presets ?? []
    selected.value =
      presets.find(
        (p) => p.bank === instrument.bank && p.program === instrument.program,
      ) ?? null
    error.value = ''
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}
function selectFont(file: string) {
  if (external.value) backendChoice.value = 'default'
  scope.value = file
  if(file && file !== selectedFile.value){
    selectedFile.value=file
    selected.value=index.value.find(entry=>entry.file===file)?.presets[0]??null
  }
}
function selectPreset(file: string, preset: Preset) {
  selectedFile.value = file
  selected.value = preset
}
async function favourite(file: string, preset: Preset) {
  const keys = new Set(favourites.value),
    key = favouriteKey(file, preset)
  if (keys.has(key)) keys.delete(key)
  else keys.add(key)
  try {
    await settings.save({ ...settings.value, soundfontFavourites: [...keys] })
  } catch (e) {
    error.value = String(e)
  }
}
watch(choice, (value) => engineBus.value?.send('audition:select', value), {
  immediate: true,
})
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
async function usePreset(): Promise<void> {
  const value = choice.value
  if (!value || saving.value) return
  saving.value = true
  try {
    const folder=doc.folder
    let file = selectedFile.value
    if (
      !external.value &&
      settings.value.soundfontCopyIntoProject &&
      !doc.project.soundfonts.some((f) => f.file === file)
    )
      file = await window.xm.soundfonts.copy(file)
    if(doc.folder!==folder)return
    const project = external.value ? doc.project : addFont(doc.project, file)
    doc.update((p) => {
      p.soundfonts = project.soundfonts

      const target = p.instruments.find((i) => i.id === props.instrumentId)!
      Object.assign(target, {
        backend: backendChoice.value,
        soundfontId: external.value
          ? undefined
          : project.soundfonts.find((f) => f.file === file)!.id,
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
  } catch (e) {
    error.value = String(e)
  } finally {
    saving.value = false
  }
}
onMounted(() => {
  dialog.value!.showModal()
  void load()
})
onUnmounted(() => {
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
        {{ t('picker.instrument') }} {{ instrument.name }}
      </h5>
      <button
        class="btn btn-sm btn-ghost"
        :aria-label="t('picker.closeInstrumentPicker')"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-dialog-b">
      <div class="xm-picker-columns">
        <div>
          <label class="form-label">{{ t('picker.soundfont') }}</label>
          <div class="xm-list">
            <button
              class="xm-list-button"
              :class="{'is-selected':!scope && !external}"
              @click="selectFont('')"
            >
              {{ t('picker.allFonts') }}
            </button>
            <button
              v-for="sf in doc.project.soundfonts"
              :key="sf.id"
              class="xm-list-button"
              :class="{ 'is-selected': !external && scope === sf.file }"
              @click="selectFont(sf.file)"
            >
              {{ sf.file }}
            </button>
            <button
              class="xm-list-button"
              :class="{ 'is-selected': external }"
              @click="backendChoice = 'midi'"
            >
              <i class="bi bi-box-arrow-up-right" /> {{ t('picker.externalMidiPort') }}
            </button>
          </div>
        </div>
        <div
          v-if="external"
          class="xm-external-fields"
        >
          <label class="form-label">{{ t('picker.name') }}<input
            v-model="name"
            class="form-control"
            :aria-label="t('picker.externalMidiInstrumentName')"
          ></label>
          <label class="form-label">{{ t('picker.midiOutput') }}<select
            v-model="portName"
            class="form-select"
            :aria-label="t('picker.externalMidiOutput')"
          >
            <option
              value=""
              disabled
            >{{ t('picker.selectAMidiOutput') }}</option>
            <option
              v-if="portName && !portNames.includes(portName)"
              :value="portName"
            >
              {{ portName }} {{ t('picker.disconnected') }}
            </option>
            <option
              v-for="port in portNames"
              :key="port"
              :value="port"
            >
              {{ port }}
            </option>
          </select></label>
          <label class="form-label">{{ t('picker.channel') }}<select
            v-model.number="channel"
            class="form-select"
            :aria-label="t('picker.externalMidiChannel')"
          >
            <option
              v-for="n in 16"
              :key="n"
              :value="n - 1"
            >{{ n }}</option>
          </select></label>
          <div class="xm-row">
            <label class="form-label">{{ t('picker.bank016383') }}<input
              v-model.number="bank"
              class="form-control"
              type="number"
              min="0"
              max="16383"
              step="1"
              :aria-label="t('picker.externalMidiBank')"
            ></label>
            <label class="form-label">{{ t('picker.program0127') }}<input
              v-model.number="program"
              class="form-control"
              type="number"
              min="0"
              max="127"
              step="1"
              :aria-label="t('picker.externalMidiProgram')"
            ></label>
          </div>
          <p class="xm-faint">
            {{ t('picker.useSeparateChannelsForOverlappingSoundsVolumePanEffectsAndExpressionAreSharedByEachPhysicalChannel') }}
          </p>
          <p
            v-if="!runtime.midi.outputs.length"
            class="xm-faint"
            role="status"
          >
            {{ t('picker.noMidiOutputsConnected') }}
          </p>
        </div>
        <div v-else>
          <label
            class="form-label"
            for="preset-search"
          >{{ t('picker.preset') }}</label><input
            id="preset-search"
            v-model="query"
            type="search"
            class="form-control mb-2"
            :placeholder="t('picker.searchPresets')"
            autofocus
          >
          <div class="xm-preset-filters">
            <button
              v-for="item in [...gmFamilies,'Drums']"
              :key="item"
              class="xm-chip is-sm"
              :aria-pressed="family===item"
              @click="family=family===item?'':item"
            >
              {{ item }}
            </button>
            <button
              class="xm-chip is-sm"
              :aria-pressed="onlyFavourites"
              @click="onlyFavourites=!onlyFavourites"
            >
              {{ t('picker.favourites') }}
            </button>
            <label><input
              v-model="includeLibrary"
              type="checkbox"
            > {{ t('picker.includeLibrary') }}</label>
          </div>
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
              {{ t('picker.retry') }}
            </button>
          </div>
          <p
            v-else-if="loading"
            role="status"
          >
            {{ t('picker.loadingPresets') }}
          </p>
          <div
            v-else
            class="xm-list xm-presets"
          >
            <template
              v-for="group in groups"
              :key="group.file"
            >
              <b class="xm-fontgroup">{{ group.file }}</b>
              <div
                v-for="preset in group.presets"
                :key="favouriteKey(group.file,preset)"
                class="xm-row"
              >
                <button
                  class="xm-list-button"
                  :class="{'is-selected': selectedFile===group.file && selected?.bank===preset.bank && selected?.program===preset.program}"
                  @click="selectPreset(group.file,preset)"
                >
                  <span class="xm-mono xm-faint">{{ preset.bank }}:{{ preset.program }}</span> {{ preset.name }}
                </button>
                <button
                  class="btn btn-ghost"
                  :aria-label="t('picker.favourite')"
                  :aria-pressed="favourites.has(favouriteKey(group.file,preset))"
                  @click="favourite(group.file,preset)"
                >
                  <i :class="favourites.has(favouriteKey(group.file,preset))?'bi bi-star-fill':'bi bi-star'" />
                </button>
              </div>
            </template>
            <p
              v-if="!groups.length"
              class="xm-faint p-2 mb-0"
            >
              {{ t('picker.noMatchingPresets') }}
            </p>
          </div>
        </div>
      </div>
      <label
        v-if="!external"
        class="form-label mt-3"
      >{{ t('picker.engine') }}</label>
      <div
        v-if="!external"
        class="xm-seg"
      >
        <button
          :class="{ 'is-on': backendChoice === 'default' }"
          :aria-pressed="backendChoice === 'default'"
          @click="backendChoice = 'default'"
        >
          {{ t('picker.default') }}{{
            settings.value.audio.defaultSynth === 'fluid'
              ? 'FluidSynth'
              : 'Built-in'
          }})
        </button><button
          :class="{ 'is-on': backendChoice === 'web' }"
          :aria-pressed="backendChoice === 'web'"
          @click="backendChoice = 'web'"
        >
          {{ t('picker.builtIn') }}
        </button><button
          :class="{ 'is-on': backendChoice === 'fluid' }"
          :aria-pressed="backendChoice === 'fluid'"
          @click="backendChoice = 'fluid'"
        >
          {{ t('picker.fluidsynth') }}
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
        <i class="bi bi-volume-up" /> {{ t('picker.audition') }}
      </button>
    </div>
    <div class="xm-dialog-f">
      <span class="xm-faint me-auto">{{ t('picker.playYourKeyboardToAudition') }}</span><button
        class="btn btn-xm"
        @click="emit('close')"
      >
        {{ t('picker.cancel') }}
      </button><button
        class="btn btn-primary"
        :disabled="saving || !choice || !runtime.connected"
        @click="usePreset"
      >
        {{ t('picker.usePreset') }}
      </button>
    </div>
  </dialog>
</template>
