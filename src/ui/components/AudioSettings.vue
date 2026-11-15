<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useRuntimeStore } from '../stores/runtime'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import type { Settings } from '../../shared/model'
const emit = defineEmits<{ close: [] }>()
const settings = useSettingsStore()
const runtime = useRuntimeStore()
const project = useProjectStore()
const audio = ref<Settings['audio']>(
  JSON.parse(JSON.stringify(settings.value.audio)),
)
const outputs = ref<{ id: string; label: string }[]>([])
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
    await settings.save({ ...settings.value, audio: audio.value })
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
        Settings
      </h5>
      <button
        class="btn btn-sm btn-ghost"
        aria-label="Close settings"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-settings-body">
      <nav
        class="xm-settings-nav"
        aria-label="Settings pages"
      >
        <span class="is-selected"><i class="bi bi-volume-up" /> Audio</span><span class="xm-faint">Devices</span><span class="xm-faint">Files</span><span class="xm-faint">View</span>
      </nav>
      <div class="xm-dialog-b">
        <label class="form-label">Synth engine</label><div class="xm-seg">
          <button
            class="is-on"
            disabled
          >
            Built-in
          </button><button disabled>
            FluidSynth (native)
          </button>
        </div>
        <div class="xm-status mt-2">
          <span class="xm-dot" /><span
            v-if="runtime.latency"
            class="xm-mono"
          >{{
            (runtime.latency.baseMs + runtime.latency.outputMs).toFixed(1)
          }}
            ms</span><span v-else>Measuring…</span>
        </div>
        <p
          v-if="runtime.latency"
          class="xm-faint mt-1"
        >
          Buffer {{ runtime.latency.baseMs.toFixed(1) }} + output
          {{ runtime.latency.outputMs.toFixed(1) }} ms
        </p>
        <div class="xm-settings-fields">
          <label class="form-label">Main output<select
            v-model="audio.mainDeviceId"
            class="form-select"
          >
            <option value="">Default</option>
            <option
              v-for="output in outputs"
              :key="output.id"
              :value="output.id"
            >
              {{ output.label }}
            </option>
          </select></label><label class="form-label">Cue output<select
            v-model="audio.cue.mode"
            class="form-select"
          >
            <option value="off">Off — mix into main</option>
            <option value="channels34">Channels 3–4</option>
            <option
              value="device"
              disabled
            >
              Separate device · not available yet
            </option>
          </select></label>
          <label class="form-label">Buffer size<select
            v-model.number="audio.bufferSize"
            class="form-select"
          >
            <option :value="0">Automatic (0)</option>
            <option
              v-for="size in [128, 256, 512, 1024]"
              :key="size"
              :value="size"
            >
              {{ size }}
            </option>
          </select></label><label class="form-label">Sample rate<select
            v-model.number="audio.sampleRate"
            class="form-select"
          >
            <option :value="44100">44100</option>
            <option :value="48000">48000</option>
          </select></label>
        </div>
        <label class="form-label mt-3">Input latency<div class="input-group"><input
          v-model.number="audio.inputLatencyMs"
          type="number"
          class="form-control xm-mono"
          min="0"
          step="0.1"
        ><span class="input-group-text">ms</span></div></label>
        <div
          v-if="restartNeeded"
          class="xm-banner mt-3"
        >
          Buffer size and sample rate changes take effect after a
          restart.<button
            class="btn btn-primary"
            :disabled="busy"
            @click="restart"
          >
            Restart now
          </button>
        </div>
        <label class="form-check form-switch mt-3"><input
          v-model="audio.limiter"
          type="checkbox"
          class="form-check-input"
        ><span class="form-check-label">Limiter on the main output</span></label>
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
        Cancel
      </button><button
        class="btn btn-primary"
        :disabled="busy"
        @click="save()"
      >
        Apply
      </button>
    </div>
  </dialog>
</template>
