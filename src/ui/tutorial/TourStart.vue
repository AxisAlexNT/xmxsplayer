<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../i18n'

defineProps<{ hasProject: boolean }>()
const emit = defineEmits<{ start: [practice: boolean]; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const practice = ref(true)
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="tutorial-start-title"
    @cancel.prevent="emit('cancel')"
  >
    <form @submit.prevent="emit('start', practice)">
      <h2 id="tutorial-start-title">
        {{ t('tutorial.startWhere') }}
      </h2>
      <label>
        <input
          v-model="practice"
          name="tutorial-location"
          type="radio"
          :value="true"
          autofocus
        >
        <span><strong>{{ t('tutorial.copy') }}</strong><small>{{ t('tutorial.copyHint') }}</small></span>
      </label>
      <label v-if="hasProject">
        <input
          v-model="practice"
          name="tutorial-location"
          type="radio"
          :value="false"
        >
        <span><strong>{{ t('tutorial.current') }}</strong><small>{{ t('tutorial.currentHint') }}</small></span>
      </label>
      <footer>
        <button
          type="button"
          @click="emit('cancel')"
        >
          {{ t('tutorial.cancel') }}
        </button>
        <button type="submit">
          {{ t('tutorial.start') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
dialog { max-width: min(26rem, 90vw); color: inherit; background: var(--panel, #23252b); border: 1px solid var(--line, #565a65); border-radius: 8px; }
dialog::backdrop { background: #0009; }
label { display: flex; align-items: baseline; gap: .6rem; margin: 1rem 0; cursor: pointer; }
small { display: block; margin-top: .25rem; }
footer { display: flex; justify-content: flex-end; gap: .5rem; }
</style>
