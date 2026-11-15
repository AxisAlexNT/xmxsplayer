<script setup lang="ts">
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
    <label class="form-label w-100">MuseScore executable<input
      v-model="path"
      class="form-control"
      aria-label="MuseScore executable"
      placeholder="Detect automatically"
    ></label>
    <div class="d-flex gap-2 mt-2">
      <button
        class="btn btn-xm"
        :disabled="busy"
        @click="test(true)"
      >
        Detect
      </button><button
        class="btn btn-xm"
        :disabled="busy"
        @click="test()"
      >
        Test
      </button>
    </div>
    <p class="xm-faint mt-3">
      Choose the MuseScore executable on this computer. Linked scores are copied
      into the project folder.
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
</template>
