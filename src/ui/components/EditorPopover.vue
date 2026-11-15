<script setup lang="ts">
import { onBeforeUnmount, onMounted, onUnmounted, ref } from 'vue'
const props = defineProps<{
  title: string
  anchor: { right: number; top: number }
}>()
const emit = defineEmits<{ close: [] }>()
const pop = ref<HTMLElement>()
const returnFocus = document.activeElement as HTMLElement | null
let restore = false
let observer: ResizeObserver | undefined
function position(): void {
  const el = pop.value
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.left = `${Math.max(12, Math.min(window.innerWidth - r.width - 12, props.anchor.right + 8))}px`
  el.style.top = `${Math.max(12, Math.min(window.innerHeight - r.height - 12, props.anchor.top))}px`
}
onMounted(() => {
  pop.value!.showPopover()
  pop
    .value!.querySelector<HTMLElement>('input,select,textarea')
    ?.focus({ preventScroll: true })
  observer = new ResizeObserver(position)
  observer.observe(pop.value!)
  window.addEventListener('resize', position)
})
onBeforeUnmount(() => {
  restore =
    document.activeElement === document.body ||
    !!pop.value?.contains(document.activeElement)
})
onUnmounted(() => {
  observer?.disconnect()
  window.removeEventListener('resize', position)
  if (restore && returnFocus?.isConnected)
    returnFocus.focus({ preventScroll: true })
})
</script>
<template>
  <Teleport to="body">
    <div
      ref="pop"
      class="xm-pop xm-editor-pop"
      popover="auto"
      role="dialog"
      :aria-label="title"
      @toggle="($event as ToggleEvent).newState === 'closed' && emit('close')"
    >
      <div class="xm-row mb-3">
        <b class="flex-grow-1">{{ title }}</b>
        <button
          class="btn btn-sm btn-ghost"
          :aria-label="`Close ${title.toLowerCase()}`"
          @click="emit('close')"
        >
          <i class="bi bi-x-lg" />
        </button>
      </div>
      <slot />
    </div>
  </Teleport>
</template>
