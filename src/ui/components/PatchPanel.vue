<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Condition, Instrument, PatchConn } from '../../shared/model'
import { uniqueId } from '../../shared/ids'
import { usePerformanceStore } from '../stores/performance'
import { useProjectStore } from '../stores/project'
import { engineBus } from '../bus'
import { palette } from '../bindings/labels'
import EditorPopover from './EditorPopover.vue'
import ConditionEditor from './ConditionEditor.vue'
const emit = defineEmits<{ instrument: [id: string] }>()
const performance = usePerformanceStore(),
  doc = useProjectStore()
const selectedId = ref<string | null>(null),
  anchor = ref({ right: 0, top: 0 }),
  error = ref('')
const selected = computed(() =>
  performance.setup.patch.find((p) => p.id === selectedId.value),
)
const instrument = computed(() =>
  doc.project.instruments.find((i) => i.id === selected.value?.instrumentId),
)
const gate = computed(() =>
  !selected.value?.when
    ? 'none'
    : 'reg' in selected.value.when
      ? `${selected.value.when.reg}:${selected.value.when.on}`
      : 'custom',
)
let audition: string | undefined
let auditionTimer: ReturnType<typeof setTimeout> | undefined
function release(): void {
  if (audition)
    engineBus.value?.send('audition', {
      instrumentId: audition,
      key: 60,
      on: false,
    })
  audition = undefined
  clearTimeout(auditionTimer)
}
function preview(): void {
  release()
  if (!instrument.value) return
  audition = instrument.value.id
  engineBus.value?.send('audition', {
    instrumentId: audition,
    key: 60,
    on: true,
  })
  auditionTimer = setTimeout(release, 600)
}
function open(id: string, bounds: { right: number; top: number }): void {
  selectedId.value = id
  anchor.value = bounds
  error.value = ''
}
function edit(connection: PatchConn, event: Event): void {
  open(
    connection.id,
    (event.currentTarget as HTMLElement).getBoundingClientRect(),
  )
}
function update(patch: Partial<PatchConn>): void {
  try {
    performance.patch((connections) => {
      const c = connections.find((p) => p.id === selectedId.value)
      if (c) Object.assign(c, patch)
    })
    error.value = ''
  } catch {
    error.value = 'Choose an instrument and an integer transpose.'
  }
}
function close(): void {
  selectedId.value = null
  release()
}
function changeInstrument(event: Event): void {
  release()
  update({ instrumentId: (event.target as HTMLSelectElement).value })
}
function condition(value: Condition | undefined): void {
  if (value) update({ when: value })
  else
    performance.patch((connections) => {
      const c = connections.find((p) => p.id === selectedId.value)
      if (c) delete c.when
    })
}
function setGate(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'none') condition(undefined)
  else if (value === 'custom') condition({ all: [] })
  else {
    const [index, on] = value.split(':')
    condition({ reg: Number(index), on: on === 'true' })
  }
}
function label(when?: Condition): string {
  return !when
    ? ''
    : 'reg' in when
      ? `R${when.reg + 1} ${when.on ? 'on' : 'off'}`
      : 'Conditional'
}
function add(trackId: string, event: Event): void {
  const existing = performance.setup.patch
    .filter((p) => p.trackId === trackId)
    .map((p) => p.instrumentId)
  const available = doc.project.instruments.find(
    (i) => !existing.includes(i.id),
  )
  const id = uniqueId(
    'patch',
    performance.setup.patch.map((p) => p.id),
  )
  const created: Instrument | undefined = available
    ? undefined
    : {
        ...(doc.project.instruments[0] ?? {
          backend: 'default',
          soundfontId: doc.project.soundfonts[0]?.id,
          bank: 0,
          program: 0,
          isDrum: false,
          volume: 0.8,
          pan: 0,
          reverb: 0.2,
          chorus: 0,
          transpose: 0,
        }),
        id: uniqueId(
          'instrument',
          doc.project.instruments.map((i) => i.id),
        ),
        name: `Instrument ${doc.project.instruments.length + 1}`,
        color: palette[doc.project.instruments.length % palette.length],
      }
  performance.patch(
    (patch) => {
      patch.push({ id, trackId, instrumentId: available?.id ?? created!.id })
    },
    created
      ? (d) => {
          d.instruments.push(created)
        }
      : undefined,
  )
  open(id, (event.currentTarget as HTMLElement).getBoundingClientRect())
}
function createInstrument(): void {
  if (!selected.value) return
  const current = instrument.value
  if (!current) return
  const created = {
    ...current,
    id: uniqueId(
      'instrument',
      doc.project.instruments.map((i) => i.id),
    ),
    name: `Instrument ${doc.project.instruments.length + 1}`,
    color: palette[doc.project.instruments.length % palette.length],
  }
  performance.patch(
    (patch) => {
      const connection = patch.find((p) => p.id === selectedId.value)
      if (connection) connection.instrumentId = created.id
    },
    (d) => {
      d.instruments.push(created)
    },
  )
  emit('instrument', created.id)
}
function remove(): void {
  release()
  performance.patch((connections) => {
    const index = connections.findIndex((p) => p.id === selectedId.value)
    if (index >= 0) connections.splice(index, 1)
  })
  selectedId.value = null
}
watch(
  () => performance.sceneId,
  () => {
    selectedId.value = null
    release()
  },
)
onUnmounted(release)
defineExpose({ open })
</script>
<template>
  <div class="xm-patch xm-performance-patch">
    <template
      v-for="track in doc.project.tracks.filter((t) => t.kind === 'midi')"
      :key="track.id"
    >
      <span
        class="xm-chip is-sm"
        :style="{ '--c': track.color }"
      ><i class="xm-sw" />{{ track.name }}</span><span class="xm-arrow">→</span>
      <div class="xm-wrap">
        <button
          v-for="connection in performance.setup.patch.filter(
            (p) => p.trackId === track.id,
          )"
          :key="connection.id"
          class="xm-chip is-sm"
          :class="{
            'is-gated': connection.when,
            'is-active': selectedId === connection.id,
          }"
          :style="{
            '--c': doc.project.instruments.find(
              (i) => i.id === connection.instrumentId,
            )?.color,
          }"
          @click="edit(connection, $event)"
        >
          <i class="bi bi-music-note" />{{
            doc.project.instruments.find(
              (i) => i.id === connection.instrumentId,
            )?.name ?? 'Missing instrument'
          }}<span
            v-if="connection.when"
            class="xm-gate"
          >{{
            label(connection.when)
          }}</span>
        </button>
        <button
          class="xm-chip is-add"
          :aria-label="`Add instrument to ${track.name}`"
          @click="add(track.id, $event)"
        >
          <i class="bi bi-plus" />
        </button>
      </div>
    </template>
  </div>
  <p
    v-if="!doc.project.tracks.some((t) => t.kind === 'midi')"
    class="xm-faint mb-0"
  >
    Add a MIDI track to connect instruments.
  </p>
  <EditorPopover
    v-if="selected"
    title="Patch connection"
    :anchor="anchor"
    @close="close"
  >
    <label class="form-label">Instrument<select
      class="form-select"
      aria-label="Patch instrument"
      :value="selected.instrumentId"
      @change="changeInstrument"
    >
      <option
        v-for="i in doc.project.instruments"
        :key="i.id"
        :value="i.id"
      >
        {{ i.name }}
      </option>
    </select></label>
    <div class="xm-row mb-3">
      <button
        class="btn btn-sm btn-ghost"
        :disabled="!instrument"
        @click="emit('instrument', selected.instrumentId)"
      >
        Change preset…
      </button><button
        class="btn btn-sm btn-ghost"
        @click="createInstrument"
      >
        New instrument…
      </button>
    </div>
    <div class="row g-2 mb-2">
      <label class="col form-label">Active when<select
        class="form-select"
        aria-label="Patch condition"
        :value="gate"
        @change="setGate"
      >
        <option value="none">Always</option>
        <template
          v-for="(reg, index) in doc.project.registers"
          :key="index"
        ><option :value="`${index}:true`">
           Register {{ index + 1 }} is on
         </option>
          <option :value="`${index}:false`">
            Register {{ index + 1 }} is off
          </option></template>
        <option value="custom">Custom condition</option>
      </select></label><label class="col form-label">Transpose<input
        class="form-control xm-mono"
        type="number"
        step="1"
        aria-label="Patch transpose"
        :value="selected.transpose ?? 0"
        @change="
          update({
            transpose: Number(($event.target as HTMLInputElement).value),
          })
        "
      ></label>
    </div>
    <ConditionEditor
      v-if="gate === 'custom'"
      :model-value="selected.when"
      :project="doc.project"
      @update:model-value="condition"
    />
    <p class="xm-faint">
      Editing {{ performance.label }}
    </p>
    <p
      v-if="error"
      class="text-danger"
      role="alert"
    >
      {{ error }}
    </p>
    <div class="xm-row justify-content-between">
      <button
        class="btn btn-sm btn-ghost text-danger"
        @click="remove"
      >
        <i class="bi bi-trash" /> Remove
      </button><button
        class="btn btn-sm btn-ghost"
        @click="preview"
      >
        <i class="bi bi-play-fill" /> Audition
      </button>
    </div>
  </EditorPopover>
</template>
