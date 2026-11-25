<script setup lang="ts">
import SoundLibrary from './SoundLibrary.vue'
import { useI18n } from '../i18n'
const {t}=useI18n()
const managing=ref(false)
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
const settings = useSettingsStore()
const path = ref(settings.value.musescorePath),
  status = ref(''),
  busy = ref(false),
  error = ref('')
async function test(detect = false): Promise<void> {
  busy.value = true
  error.value = ''
  status.value = ''
  try {
    const result = await window.xm.scores.detect(detect ? '' : path.value)
    path.value = result.path
    status.value = result.version
  } catch (reason) {
    error.value = String(reason)
  } finally {
    busy.value = false
  }
}
defineExpose({ path })
</script>
<template>
  <div>
    <label class="form-label w-100">{{ t('library.musescoreExecutable') }}<input
      v-model="path"
      class="form-control"
      :aria-label="t('library.musescoreExecutable')"
      :placeholder="t('library.detectAutomatically')"
    ></label>
    <div class="d-flex gap-2 mt-2">
      <button
        class="btn btn-xm"
        :disabled="busy"
        @click="test(true)"
      >
        {{ t('library.detect') }}
      </button><button
        class="btn btn-xm"
        :disabled="busy"
        @click="test()"
      >
        {{ t('library.test') }}
      </button>
    </div>
    <p class="xm-faint mt-3">
      {{ t('library.chooseTheMusescoreExecutableOnThisComputerLinkedScoresAreCopiedIntoTheProjectFolder') }}
    </p>
    <p
      v-if="status"
      class="xm-status mt-2"
      role="status"
    >
      <span class="xm-dot" />{{ status }}
    </p>
    <p
      v-if="error"
      class="xm-banner mt-2"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
  <button
    class="btn btn-sm btn-xm"
    @click="managing=true"
  >
    {{ t('library.manage') }}
  </button>
  <SoundLibrary
    v-if="managing"
    @close="managing=false"
  />
</template>
