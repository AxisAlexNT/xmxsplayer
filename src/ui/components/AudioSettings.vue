<script setup lang="ts">
import { t } from '../i18n'
import FilesSettings from './FilesSettings.vue'
import FluidSettings from './FluidSettings.vue'
import { fluidArgs } from '../../shared/fluid'
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useRuntimeStore } from '../stores/runtime'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import type { Settings } from '../../shared/model'
const page = ref('audio'),
  files = ref<InstanceType<typeof FilesSettings>>()
const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const runtime = useRuntimeStore()
const project = useProjectStore()
const audio = ref<Settings['audio']>(
  JSON.parse(JSON.stringify(settings.value.audio)),
)
const outputs = ref<{ id: string; label: string }[]>([])
const fluid = ref<Settings['fluid']>(JSON.parse(JSON.stringify(settings.value.fluid)))
const configuredMs = computed(()=>fluid.value.periodSize*fluid.value.periods/audio.value.sampleRate*1000)
const error = ref('')
const busy = ref(false)
const dialog = ref<HTMLDialogElement>()
const restartNeeded = computed(
  () =>
    audio.value.bufferSize !==
      (runtime.latency?.bufferSize ?? settings.value.audio.bufferSize) ||
    audio.value.sampleRate !==
      (runtime.latency?.sampleRate ?? settings.value.audio.sampleRate),
)
async function save(close = true): Promise<boolean> {
  busy.value = true
  error.value = ''
  try {
    fluidArgs({...fluid.value,sampleRate:audio.value.sampleRate},/Windows/i.test(navigator.userAgent)?'win32':'linux')
    if (audio.value.defaultSynth === 'fluid')
      fluid.value.path = (await window.xm.fluid.detect(fluid.value.path)).path
    await settings.save({
      ...settings.value,
      audio: audio.value,
      fluid: fluid.value,
      musescorePath: files.value?.path ?? settings.value.musescorePath,
    })
    if (close) emit('close')
    return true
  } catch (reason) {
    error.value = String(reason)
    return false
  } finally {
    busy.value = false
  }
}
async function restart(): Promise<void> {
  if (!(await save(false))) return
  if (
    project.dirtyFiles.length &&
    !window.confirm('Restart and discard unsaved project changes?')
  )
    return
  await window.xm.app.relaunch()
}
onMounted(() => {
  dialog.value!.showModal()
  void engineBus.value
    ?.request('audio:devices', undefined)
    .then((value) => {
      outputs.value = value
    })
    .catch((reason) => {
      error.value = String(reason)
    })
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-settings-dialog"
    aria-labelledby="settings-title"
    @cancel.prevent="emit('close')"
  >
    <div class="xm-dialog-h">
      <h5 id="settings-title">
        {{ t('menu.settings') }}
      </h5>
      <button
        class="btn btn-sm btn-ghost"
        :aria-label="t('audioSettings.closeSettings')"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-settings-body">
      <nav
        class="xm-settings-nav"
        :aria-label="t('audioSettings.settingsPages')"
      >
        <button
          :class="{ 'is-selected': page === 'audio' }"
          @click="page = 'audio'"
        >
          <i class="bi bi-volume-up" /> {{ t('audioSettings.audio') }}
        </button><span class="xm-faint">{{ t('audioSettings.devices') }}</span><button
          :class="{ 'is-selected': page === 'files' }"
          @click="page = 'files'"
        >
          {{ t('audioSettings.files') }}
        </button><span class="xm-faint">{{ t('menu.view') }}</span>
      </nav>
      <div class="xm-dialog-b">
        <FilesSettings
          v-show="page === 'files'"
          ref="files"
        />
        <div v-show="page === 'audio'">
          <label class="form-label">{{ t('audioSettings.synthEngine') }}</label>
          <div class="xm-seg">
            <button
              :class="{'is-on':audio.defaultSynth==='web'}"
              :aria-pressed="audio.defaultSynth==='web'"
              @click="audio.defaultSynth='web'"
            >
              {{ t('picker.builtIn') }}
            </button><button
              :class="{'is-on':audio.defaultSynth==='fluid'}"
              :aria-pressed="audio.defaultSynth==='fluid'"
              @click="audio.defaultSynth='fluid'"
            >
              {{ t('audioSettings.fluidSynthNative') }}
            </button>
          </div>
          <div class="mt-2">
            <div class="xm-status">
              <span class="xm-dot" /><span
                v-if="audio.defaultSynth==='fluid'"
                class="xm-mono"
              >{{ t('audioSettings.fluidSynthConfigured') }} {{ configuredMs.toFixed(1) }} {{ t('control.ms') }}</span><span
                v-else-if="runtime.latency"
                class="xm-mono"
              >{{ t('audioSettings.builtInMeasured') }} {{
                (runtime.latency.baseMs + runtime.latency.outputMs).toFixed(1)
              }}
                {{ t('control.ms') }}</span><span v-else>{{ t('audioSettings.measuring') }}</span>
            </div>
          </div>
          <p
            v-if="runtime.latency && audio.defaultSynth==='web'"
            class="xm-faint mt-1"
          >
            {{ t('audioSettings.buffer') }} {{ runtime.latency.baseMs.toFixed(1) }} {{ t('audioSettings.output') }}
            {{ runtime.latency.outputMs.toFixed(1) }} {{ t('control.ms') }}
          </p>
          <FluidSettings
            v-if="audio.defaultSynth==='fluid'"
            v-model="fluid"
          />
          <div class="xm-settings-fields">
            <label class="form-label">{{ t('audioSettings.mainOutput') }}<select
              v-model="audio.mainDeviceId"
              class="form-select"
            >
              <option value="">{{ t('audioSettings.default') }}</option>
              <option
                v-for="output in outputs"
                :key="output.id"
                :value="output.id"
              >
                {{ output.label }}
              </option>
            </select></label><label class="form-label">{{ t('audioSettings.cueOutput') }}<select
              v-model="audio.cue.mode"
              class="form-select"
            >
              <option value="off">{{ t('audioSettings.offMixIntoMain') }}</option>
              <option value="channels34">{{ t('audioSettings.channels34') }}</option>
              <option value="device">
                {{ t('audioSettings.separateDeviceApproximateSync') }}
              </option>
            </select></label>
            <label
              v-if="audio.cue.mode === 'device'"
              class="form-label"
            >{{ t('audioSettings.cueDevice') }}<select
              v-model="audio.cue.deviceId"
              class="form-select"
            >
              <option value="">{{ t('audioSettings.defaultOutput') }}</option>
              <option
                v-for="output in outputs"
                :key="output.id"
                :value="output.id"
              >
                {{ output.label }}
              </option></select><small class="text-body-secondary">{{ t('audioSettings.approximateSyncAudioReAlignsEvery5Seconds') }}</small></label>
            <label class="form-label">{{ t('audioSettings.bufferSize') }}<select
              v-model.number="audio.bufferSize"
              class="form-select"
            >
              <option :value="0">{{ t('audioSettings.automatic0') }}</option>
              <option
                v-for="size in [128, 256, 512, 1024]"
                :key="size"
                :value="size"
              >
                {{ size }}
              </option>
            </select></label><label class="form-label">{{ t('audioSettings.sampleRate') }}<select
              v-model.number="audio.sampleRate"
              class="form-select"
            >
              <option :value="44100">{{ t('audioSettings.44100') }}</option>
              <option :value="48000">{{ t('audioSettings.48000') }}</option>
            </select></label>
          </div>
          <label class="form-label mt-3">{{ t('audioSettings.inputLatency') }}
            <div class="input-group">
              <input
                v-model.number="audio.inputLatencyMs"
                type="number"
                class="form-control xm-mono"
                min="0"
                step="0.1"
              ><span class="input-group-text">{{ t('control.ms') }}</span>
            </div></label>
          <div
            v-if="restartNeeded"
            class="xm-banner mt-3"
          >
            {{ t('audioSettings.bufferSizeAndSampleRateChangesTakeEffectAfterA') }}<button
              class="btn btn-primary"
              :disabled="busy"
              @click="restart"
            >
              {{ t('audioSettings.restartNow') }}
            </button>
          </div>
          <label class="form-check form-switch mt-3"><input
            v-model="audio.limiter"
            type="checkbox"
            class="form-check-input"
          ><span class="form-check-label">{{ t('audioSettings.limiterOnTheMainOutput') }}</span></label>
        </div>
        <div
          v-if="error"
          class="xm-banner mt-3"
          role="alert"
        >
          {{ error }}
        </div>
      </div>
    </div>
    <div class="xm-dialog-f">
      <button
        class="btn btn-xm"
        @click="emit('close')"
      >
        {{ t('picker.cancel') }}
      </button><button
        class="btn btn-primary"
        :disabled="busy"
        @click="save()"
      >
        {{ t('timeline.apply') }}
      </button>
    </div>
  </dialog>
</template>
