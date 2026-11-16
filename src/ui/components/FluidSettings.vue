<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Settings } from '../../shared/model'
const fluid = defineModel<Settings['fluid']>({ required: true })
const windows = /Windows/i.test(navigator.userAgent)
const drivers = computed(() => [...new Set([
  ...(windows ? ['wasapi', 'dsound'] : ['pipewire', 'jack', 'pulseaudio', 'alsa']),
  ...(fluid.value.driver ? [fluid.value.driver] : []),
])])
const busy = ref(false), status = ref(''), error = ref('')
async function test(detect = false): Promise<void> {
  busy.value = true
  status.value = error.value = ''
  try {
    const result = await window.xm.fluid.detect(detect ? '' : fluid.value.path)
    fluid.value.path = result.path
    status.value = `FluidSynth ${result.version}`
  } catch (reason) { error.value = String(reason) }
  finally { busy.value = false }
}
</script>
<template>
  <fieldset class="mt-3">
    <legend class="form-label">
      FluidSynth
    </legend>
    <label class="form-label w-100">Executable path<input
      v-model="fluid.path"
      class="form-control xm-mono"
      aria-label="FluidSynth executable path"
      placeholder="Detect or enter the executable path"
    ></label>
    <div class="xm-row">
      <button
        class="btn btn-xm"
        :disabled="busy"
        aria-label="Detect FluidSynth"
        @click="test(true)"
      >
        Detect
      </button>
      <button
        class="btn btn-xm"
        :disabled="busy"
        aria-label="Test FluidSynth"
        @click="test()"
      >
        Test
      </button>
      <span
        class="xm-faint"
        role="status"
      >{{ status }}</span>
    </div>
    <div class="xm-settings-fields">
      <label class="form-label">Audio driver<select
        v-model="fluid.driver"
        class="form-select"
        aria-label="FluidSynth audio driver"
      ><option value="">Default ({{ windows ? 'WASAPI' : 'PipeWire' }})</option><option
        v-for="driver in drivers"
        :key="driver"
        :value="driver"
      >{{ driver }}</option></select></label>
      <label class="form-label">Period size<input
        v-model.number="fluid.periodSize"
        class="form-control xm-mono"
        aria-label="FluidSynth period size"
        type="number"
        min="64"
        max="8192"
        step="64"
      ></label>
      <label class="form-label">Periods<input
        v-model.number="fluid.periods"
        class="form-control xm-mono"
        aria-label="FluidSynth periods"
        type="number"
        min="2"
        max="64"
        step="1"
      ></label>
      <label class="form-label">Gain<input
        v-model.number="fluid.gain"
        class="form-control xm-mono"
        aria-label="FluidSynth gain"
        type="number"
        min="0"
        max="5"
        step="0.05"
      ></label>
    </div>
    <p class="xm-faint mt-2">
      FluidSynth uses its own audio driver. Output, cue and limiter controls below apply to built-in synthesis and audio tracks. Use Built-in for aftertouch.
    </p>
    <div
      v-if="error"
      class="xm-banner mt-2"
      role="alert"
    >
      {{ error }}
    </div>
  </fieldset>
</template>
