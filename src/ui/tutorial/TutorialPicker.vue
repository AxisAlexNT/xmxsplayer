<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../i18n'
import { useSettingsStore } from '../stores/settings'
import { tours, type Tour } from './tours'

const props = defineProps<{ topic?: string }>()
const emit = defineEmits<{ close: []; choose: [tour: Tour] }>()
const settings = useSettingsStore()
const dialog = ref<HTMLDialogElement>()
const selected = ref(tours.find(tour => tour.id === props.topic) ?? tours[0])
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog
    ref="dialog"
    class="xm-dialog tutorial-picker"
    aria-labelledby="tutorials-title"
    @cancel.prevent="emit('close')"
  >
    <header class="xm-dialog-h">
      <h2 id="tutorials-title">
        {{ t('tutorial.pickerTitle') }}
      </h2>
    </header>
    <div class="xm-dialog-b">
      <label for="tutorial-choice">{{ t('tutorial.choose') }}</label>
      <select
        id="tutorial-choice"
        v-model="selected"
        class="form-select"
      >
        <option
          v-for="tour in tours"
          :key="tour.id"
          :value="tour"
        >
          {{ t(tour.titleKey) }}{{ settings.value.tutorials?.done.includes(tour.id) ? ' ✓' : '' }}
        </option>
      </select>
      <ol>
        <li
          v-for="step in selected.steps"
          :key="step.id"
        >
          {{ t(step.titleKey) }}
        </li>
      </ol>
    </div>
    <footer class="xm-dialog-f">
      <button
        class="btn btn-ghost"
        @click="emit('close')"
      >
        {{ t('tutorial.cancel') }}
      </button>
      <button
        class="btn btn-primary"
        @click="emit('choose', selected)"
      >
        {{ t('tutorial.continue') }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.tutorial-picker { width: min(28rem, 94vw); max-height: 90vh; overflow: auto; }
h2 { font-size: 1.2rem; margin: 0; }
ol { margin: 1rem 0 0; padding-inline-start: 1.6rem; line-height: 1.6; }
</style>
