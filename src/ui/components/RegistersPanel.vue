<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import type { RegisterDef } from '../../shared/model'
import { registerColor } from '../../shared/register-colors'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
import EditorPopover from './EditorPopover.vue'
const doc = useProjectStore(),
  runtime = useRuntimeStore()
const selected = ref<number | null>(null),
  anchor = ref({ right: 0, top: 0 })
const error = ref(''),
  held = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
const groups = computed(() => {
  const result: { start: number; span: number; label: string }[] = []
  doc.project.registers.forEach((reg, i) => {
    if (reg.mode !== 'exclusive' || !reg.group) return
    const previous = result.at(-1)
    if (previous?.label === reg.group && previous.start + previous.span === i)
      previous.span++
    else result.push({ start: i, span: 1, label: reg.group })
  })
  return result
})
function label(index:number) {
  const orchestra=doc.project.orchestras?.find(o=>Object.values(runtime.state.orchestras ?? {}).includes(o.id))
  return orchestra?.sections.find(s=>s.register===index)?.name ?? doc.project.registers[index].name
}
function edit(index: number, element: HTMLElement): void {
  anchor.value = element.getBoundingClientRect()
  selected.value = index
  error.value = ''
}
function down(event: PointerEvent, index: number): void {
  if (event.button !== 0) return
  held.value = false
  const el = event.currentTarget as HTMLElement
  el.setPointerCapture(event.pointerId)
  timer = setTimeout(() => {
    held.value = true
    edit(index, el)
  }, 500)
}
function stop(): void {
  clearTimeout(timer)
}
function toggle(index: number): void {
  stop()
  if (held.value) {
    held.value = false
    return
  }
  engineBus.value?.send('action:run', {
    action: { type: 'register', cmd: 'toggle', index },
  })
}
function update(patch: Partial<RegisterDef>): void {
  if (selected.value === null) return
  try {
    doc.update((d) => {
      Object.assign(d.registers[selected.value!], patch)
    })
    error.value = ''
  } catch (reason) {
    error.value = String(reason)
  }
}
onUnmounted(stop)
</script>
<template>
  <div class="xm-regs xm-performance-registers">
    <div
      v-for="(reg, index) in doc.project.registers"
      :key="index"
      class="xm-reg"
      :class="{ 'is-on': runtime.state.registers[index] }"
      :style="{ '--c': registerColor(doc.project, index) }"
    >
      <button
        :aria-label="`Register ${index + 1}: ${reg.name}`"
        :aria-pressed="runtime.state.registers[index]"
        title="Click to toggle; right-click, hold or press F2 to edit"
        @pointerdown="down($event, index)"
        @pointerup="stop"
        @pointercancel="stop"
        @lostpointercapture="stop"
        @click="toggle(index)"
        @contextmenu.prevent="edit(index, $event.currentTarget as HTMLElement)"
        @keydown.f2.prevent="edit(index, $event.currentTarget as HTMLElement)"
      >
        {{ index + 1 }}
      </button>
      <span :title="label(index)">{{ label(index) }}</span>
    </div>
    <div
      v-for="group in groups"
      :key="group.start"
      class="xm-reg-group"
      :style="{ gridColumn: `${group.start + 1} / span ${group.span}` }"
      :data-label="`exclusive · ${group.label}`"
      :title="`Exclusive group: ${group.label}`"
    />
  </div>
  <EditorPopover
    v-if="selected !== null"
    title="Register"
    :anchor="anchor"
    @close="selected = null"
  >
    <label class="form-label">Name<input
      class="form-control"
      aria-label="Register name"
      :value="doc.project.registers[selected].name"
      @change="update({ name: ($event.target as HTMLInputElement).value })"
    ></label>
    <div class="row g-2 mt-1">
      <label class="col form-label">Mode<select
        class="form-select"
        aria-label="Register mode"
        :value="doc.project.registers[selected].mode"
        @change="
          update({
            mode: ($event.target as HTMLSelectElement)
              .value as RegisterDef['mode'],
          })
        "
      >
        <option value="toggle">Toggle</option>
        <option value="exclusive">Exclusive</option>
      </select></label>
      <label class="col form-label">Group<input
        class="form-control"
        aria-label="Register group"
        :disabled="doc.project.registers[selected].mode !== 'exclusive'"
        :value="doc.project.registers[selected].group ?? ''"
        @change="
          update({
            group:
              ($event.target as HTMLInputElement).value.trim() || undefined,
          })
        "
      ></label>
    </div>
    <p class="xm-faint mb-0">
      Exclusive registers in the same group share one colour.
    </p>
    <p
      v-if="error"
      class="text-danger mb-0"
      role="alert"
    >
      {{ error }}
    </p>
  </EditorPopover>
</template>

<style scoped>
.xm-reg > span { white-space: normal; overflow-wrap:anywhere; text-align:center }
</style>
