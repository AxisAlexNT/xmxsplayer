<script setup lang="ts">
import { useProjectStore } from '../stores/project'
const store = useProjectStore()
const emit = defineEmits<{ error: [message: string] }>()
function resolve(path: string, keep: boolean): void {
  try {
    store.resolve(path, keep)
  } catch (error) {
    emit('error', String(error))
  }
}
</script>
<template>
  <div class="xm-conflicts">
    <div
      v-for="(_, path) in store.conflicts"
      :key="path"
      class="xm-file-banner"
      role="alert"
    >
      <i class="bi bi-file-earmark-exclamation" />
      <span><b>{{ path }}</b> changed on disk, and you have unsaved changes in
        it.</span>
      <button
        class="btn btn-sm btn-xm"
        @click="resolve(String(path), true)"
      >
        Keep mine
      </button>
      <button
        class="btn btn-sm btn-primary"
        @click="resolve(String(path), false)"
      >
        Take file
      </button>
    </div>
  </div>
</template>
