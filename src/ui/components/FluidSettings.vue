<script setup lang="ts">
import { t } from '../i18n'
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
      {{ t('picker.fluidsynth') }}
    </legend>
    <label class="form-label w-100">{{ t('fluidSettings.executablePath') }}<input
      v-model="fluid.path"
      class="form-control xm-mono"
      :aria-label="t('fluidSettings.fluidSynthExecutablePath')"
      :placeholder="t('fluidSettings.detectOrEnterTheExecutablePath')"
    ></label>
    <div class="xm-row">
      <button
        class="btn btn-xm"
        :disabled="busy"
        :aria-label="t('fluidSettings.detectFluidSynth')"
        @click="test(true)"
      >
        {{ t('library.detect') }}
      </button>
      <button
        class="btn btn-xm"
        :disabled="busy"
        :aria-label="t('fluidSettings.testFluidSynth')"
        @click="test()"
      >
        {{ t('library.test') }}
      </button>
      <span
        class="xm-faint"
        role="status"
      >{{ status }}</span>
    </div>
    <div class="xm-settings-fields">
      <label class="form-label">{{ t('fluidSettings.audioDriver') }}<select
        v-model="fluid.driver"
        class="form-select"
        :aria-label="t('fluidSettings.fluidSynthAudioDriver')"
      ><option value="">{{ t('picker.default') }}{{ windows ? 'WASAPI' : 'PipeWire' }})</option><option
        v-for="driver in drivers"
        :key="driver"
        :value="driver"
      >{{ driver }}</option></select></label>
      <label class="form-label">{{ t('fluidSettings.periodSize') }}<input
        v-model.number="fluid.periodSize"
        class="form-control xm-mono"
        :aria-label="t('fluidSettings.fluidSynthPeriodSize')"
        type="number"
        min="64"
        max="8192"
        step="64"
      ></label>
      <label class="form-label">{{ t('fluidSettings.periods') }}<input
        v-model.number="fluid.periods"
        class="form-control xm-mono"
        :aria-label="t('fluidSettings.fluidSynthPeriods')"
        type="number"
        min="2"
        max="64"
        step="1"
      ></label>
      <label class="form-label">{{ t('fluidSettings.gain') }}<input
        v-model.number="fluid.gain"
        class="form-control xm-mono"
        :aria-label="t('fluidSettings.fluidSynthGain')"
        type="number"
        min="0"
        max="5"
        step="0.05"
      ></label>
    </div>
    <p class="xm-faint mt-2">
      {{ t('fluidSettings.fluidSynthUsesItsOwnAudioDriverOutputCueAndLimiter') }}
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
