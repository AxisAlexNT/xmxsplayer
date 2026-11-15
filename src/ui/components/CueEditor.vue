<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Action, Cue } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import { uniqueId } from '../../shared/ids'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import { actionLabel } from '../bindings/labels'
import ActionPicker from './ActionPicker.vue'
const props = defineProps<{ cue?: Cue; tick: number }>(),
  emit = defineEmits<{ close: [] }>()
const doc = useProjectStore(),
  dialog = ref<HTMLDialogElement>(),
  error = ref(''),
  learning = ref(false),
  capturing = ref(false),
  editing = ref<number | null>(null)
const draft = ref<Cue>(
  props.cue
    ? JSON.parse(JSON.stringify(props.cue))
    : {
        id: uniqueId(
          'cue',
          doc.project.cues.map((c) => c.id),
        ),
        tick: props.tick,
        name: 'New cue',
        trigger: 'auto',
        at: 'now',
        actions: [],
      },
)
const map = computed(() => new TimeMap(doc.project)),
  position = map.value.tickToBarBeat(draft.value.tick)
const bar = ref(position.bar),
  beat = ref(position.beat + position.tickInBeat / ((480 * 4) / position.den))
const beatCount = computed(
  () => map.value.signatureAt(map.value.barToTick(bar.value || 1)).num,
)
let stopControl: (() => void) | undefined
const returnFocus = document.activeElement as HTMLElement | null
let captureRevision = 0,
  captureRequested = false,
  disposed = false
async function startLearn(bus = engineBus.value): Promise<void> {
  captureRequested = true
  const revision = ++captureRevision
  learning.value = false
  capturing.value = true
  try {
    if (!bus) throw Error('Connect the engine before learning a control.')
    await bus.request('control:capture', { active: true })
    if (!disposed && revision === captureRevision) learning.value = true
  } catch (reason) {
    if (!disposed && revision === captureRevision) {
      error.value = String(reason)
      captureRequested = false
    }
  } finally {
    if (revision === captureRevision) capturing.value = false
  }
}
function learn(): void {
  if (learning.value || capturing.value) stopLearn()
  else void startLearn()
}
function stopLearn(): void {
  captureRevision++
  captureRequested = false
  learning.value = false
  capturing.value = false
  engineBus.value?.send('control:capture', { active: false })
}
function add(): void {
  const scene = doc.project.scenes[0]
  draft.value.actions.push(
    scene
      ? { type: 'scene', cmd: 'activate', sceneId: scene.id }
      : { type: 'register', cmd: 'set', index: 0, on: true },
  )
  editing.value = draft.value.actions.length - 1
}
function update(value: Action): void {
  if (editing.value !== null) draft.value.actions[editing.value] = value
}
function removeAction(index: number): void {
  draft.value.actions.splice(index, 1)
  editing.value = null
}
function move(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= draft.value.actions.length) return
  const [action] = draft.value.actions.splice(index, 1)
  draft.value.actions.splice(target, 0, action)
  editing.value = target
}
function done(): void {
  if (
    !Number.isInteger(bar.value) ||
    bar.value < 1 ||
    !Number.isFinite(beat.value) ||
    beat.value < 1 ||
    beat.value >= beatCount.value + 1
  ) {
    error.value = `Choose a positive bar and a beat from 1 to ${beatCount.value}.`
    return
  }
  draft.value.tick = Math.round(map.value.barToTick(bar.value, beat.value))
  const value: Cue = JSON.parse(JSON.stringify(draft.value))
  if (!value.control?.trim() || value.trigger === 'auto') delete value.control
  else value.control = value.control.trim()
  try {
    doc.update((d) => {
      const index = d.cues.findIndex((c) => c.id === value.id)
      if (index < 0) d.cues.push(value)
      else d.cues[index] = value
      d.cues.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id))
      d.lengthTicks = Math.max(d.lengthTicks, map.value.nextBar(value.tick))
    })
    emit('close')
  } catch (reason) {
    error.value = `Cue ${value.name}: ${String(reason)}`
  }
}
function remove(): void {
  doc.update((d) => {
    d.cues = d.cues.filter((c) => c.id !== draft.value.id)
  })
  emit('close')
}
watch(
  engineBus,
  (bus) => {
    stopControl?.()
    stopControl = bus?.on('control', (event) => {
      if (!learning.value || !event.pressed || event.edge !== 'press') return
      draft.value.control = event.controlId
      stopLearn()
    })
    if (captureRequested) void startLearn(bus)
  },
  { immediate: true },
)
onMounted(() => {
  dialog.value!.showModal()
  dialog
    .value!.querySelector<HTMLInputElement>('[aria-label="Cue name"]')
    ?.focus()
})
onUnmounted(() => {
  disposed = true
  stopControl?.()
  stopLearn()
  dialog.value?.close()
  if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-cue-dialog"
    aria-labelledby="cue-title"
    @cancel.prevent="emit('close')"
  >
    <div class="xm-dialog-h">
      <i class="bi bi-flag-fill text-warning" />
      <h5 id="cue-title">
        Cue — {{ draft.name || 'New cue' }}
      </h5>
      <button
        class="btn btn-sm btn-ghost"
        aria-label="Close cue editor"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-dialog-b">
      <div class="row g-2">
        <label class="col-6 form-label">Name<input
          v-model="draft.name"
          class="form-control"
          aria-label="Cue name"
        ></label>
        <label class="col-3 form-label">Bar<input
          v-model.number="bar"
          class="form-control xm-mono"
          type="number"
          min="1"
          step="1"
          aria-label="Cue bar"
        ></label>
        <label class="col-3 form-label">Beat<input
          v-model.number="beat"
          class="form-control xm-mono"
          type="number"
          min="1"
          :max="beatCount + 0.75"
          step="0.25"
          aria-label="Cue beat"
        ></label>
        <div class="col-12">
          <label class="form-label">Trigger</label>
          <div class="xm-seg xm-cue-triggers">
            <button
              v-for="item in [
                { value: 'auto', label: 'Automatic' },
                { value: 'armed', label: 'Armed: wait for control' },
                { value: 'wait', label: 'Wait: hold playback' },
              ] as const"
              :key="item.value"
              :class="{ 'is-on': draft.trigger === item.value }"
              :aria-pressed="draft.trigger === item.value"
              @click="draft.trigger = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>
        <label
          v-if="draft.trigger !== 'auto'"
          class="col-6 form-label"
        >Control
          <div class="xm-row">
            <input
              v-model="draft.control"
              class="form-control"
              aria-label="Cue control"
              placeholder="pad.2"
            ><button
              class="btn btn-sm btn-ghost"
              :aria-pressed="learning"
              @click="learn"
            >
              {{
                capturing ? 'Starting…' : learning ? 'Cancel learn' : 'Learn'
              }}
            </button>
          </div></label>
        <div class="col-6">
          <label class="form-label">Then fire</label>
          <div class="xm-seg">
            <button
              v-for="at in ['now', 'beat', 'bar'] as const"
              :key="at"
              :class="{ 'is-on': draft.at === at }"
              :aria-pressed="draft.at === at"
              @click="draft.at = at"
            >
              {{ at[0].toUpperCase() + at.slice(1) }}
            </button>
          </div>
        </div>
      </div>
      <p
        v-if="learning"
        class="xm-faint mt-2"
        role="status"
      >
        Press a learned controller button or pad. Its normal action is suspended
        while learning.
      </p>
      <p
        v-else-if="draft.trigger !== 'auto' && !draft.control"
        class="xm-faint mt-2"
      >
        {{
          draft.trigger === 'wait'
            ? 'No control: play a key in a live zone or use Skip hold.'
            : 'No control: use Fire next cue or a cue binding.'
        }}
      </p>
      <label class="form-label mt-3">Actions</label>
      <div class="xm-list xm-cue-actions">
        <div
          v-for="(action, index) in draft.actions"
          :key="index"
          class="xm-row"
        >
          <button
            class="btn btn-sm btn-ghost"
            :aria-label="`Move action ${index + 1} up`"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            <i class="bi bi-arrow-up" />
          </button>
          <button
            class="btn btn-sm btn-ghost"
            :aria-label="`Move action ${index + 1} down`"
            :disabled="index === draft.actions.length - 1"
            @click="move(index, 1)"
          >
            <i class="bi bi-arrow-down" />
          </button>
          <button
            class="btn btn-sm btn-ghost flex-grow-1 text-start"
            :aria-pressed="editing === index"
            @click="editing = editing === index ? null : index"
          >
            {{ actionLabel(action, doc.project) }}
          </button>
          <button
            class="btn btn-sm btn-ghost"
            :aria-label="`Remove action ${index + 1}`"
            @click="removeAction(index)"
          >
            <i class="bi bi-x-lg" />
          </button>
        </div>
        <p
          v-if="!draft.actions.length"
          class="xm-faint p-2 mb-0"
        >
          No actions
        </p>
      </div>
      <button
        class="btn btn-sm btn-ghost my-2"
        @click="add"
      >
        <i class="bi bi-plus-lg" /> Add action
      </button>
      <ActionPicker
        v-if="editing !== null && draft.actions[editing]"
        :model-value="draft.actions[editing]"
        :project="doc.project"
        @update:model-value="update"
      />
      <p
        v-if="draft.actions.some((a) => a.type === 'note')"
        class="xm-faint mt-2"
      >
        Cue note actions tap a note for one quarter of a beat.
      </p>
      <p
        v-if="error"
        class="text-danger mt-2"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
    <div class="xm-dialog-f">
      <button
        v-if="cue"
        class="btn btn-sm btn-ghost text-danger me-auto"
        @click="remove"
      >
        <i class="bi bi-trash" /> Delete cue
      </button><button
        class="btn btn-sm btn-ghost"
        @click="emit('close')"
      >
        Cancel
      </button><button
        class="btn btn-sm btn-primary"
        @click="done"
      >
        Done
      </button>
    </div>
  </dialog>
</template>
