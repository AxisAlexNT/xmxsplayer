<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { ControlDef, DeviceProfile } from '../../shared/model'
import type { BindingScope } from '../bindings/edit'
import { effectiveSetup, isUnbound } from '../../shared/overlay'
import { actionLabel } from '../bindings/labels'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { engineBus } from '../bus'
import BindingEditor from './BindingEditor.vue'
import LearnWizard from './LearnWizard.vue'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  profiles = shallowRef<DeviceProfile[]>([]),
  selected = ref(''),
  bank = ref(0),
  scope = ref<BindingScope['kind']>('controller'),
  error = ref(''),
  editing = shallowRef<{
    control: ControlDef
    anchor: { left: number; top: number; right: number }
  } | null>(null),
  learning = ref<string | null>(null)
const device = computed(
    () =>
      runtime.midi.devices.find((d) => d.id === selected.value) ??
      runtime.midi.devices.find((d) => d.profileId !== 'generic') ??
      runtime.midi.devices[0],
  ),
  profile = computed(() =>
    profiles.value.find((p) => p.id === device.value?.profileId),
  ),
  setup = computed(() =>
    effectiveSetup(
      doc.project,
      runtime.state.activeSceneId,
      profile.value ? [profile.value.id] : [],
    ),
  ),
  hasBankB = computed(() =>
    profile.value?.controls.some((c) => c.id === 'pad.9'),
  )
const groups = computed(() => {
  const result = new Map<string, ControlDef[]>()
  for (const c of profile.value?.controls ?? []) {
    if (
      c.kind === 'pad' &&
      Math.floor((Number(c.id.split('.').at(-1)) - 1) / 8) !== bank.value
    )
      continue
    const group = c.ui.group
    result.set(group, [...(result.get(group) ?? []), c])
  }
  return [...result].map(([name, controls]) => ({
    name,
    controls: controls.sort(
      (a, b) => a.ui.row - b.ui.row || a.ui.col - b.ui.col,
    ),
    columns: Math.max(...controls.map((c) => c.ui.col)) + 1,
    pad: controls[0].kind === 'pad',
    strip: controls.every((c) => c.kind === 'fader' || c.kind === 'knob'),
  }))
})
async function refresh(): Promise<void> {
  if (!runtime.connected) return
  try {
    profiles.value = await engineBus.value!.request(
      'device:profiles',
      undefined,
    )
    error.value = ''
  } catch (reason) {
    error.value = String(reason)
  }
}
watch(
  () => runtime.connected,
  () => void refresh(),
  { immediate: true },
)
watch(
  () => settings.value.devices,
  () => void refresh(),
)
watch(
  () => device.value?.id,
  () => {
    editing.value = null
    learning.value = null
    bank.value = 0
  },
)
function binding(control: ControlDef) {
  const edge = control.mode === 'momentary' ? 'press' : 'change'
  return setup.value.bindings.find(
    (b) => b.control === control.id && b.edge === edge,
  )
}
function label(control: ControlDef): string {
  const b = binding(control)
  return !control.msg
    ? 'Learn'
    : isUnbound(b) || !b
      ? 'Bind…'
      : actionLabel(b.action, doc.project, control.id)
}
function live(control: ControlDef) {
  return runtime.controls[`${device.value?.id}|${control.id}`]
}
function feedback(control: ControlDef) {
  return device.value
    ? runtime.feedback[device.value.id]?.controls[control.id]
    : undefined
}
function lit(control: ControlDef): boolean {
  const value = feedback(control)
  if (value) return value.level > 0.5 && value.state !== 'off'
  if (live(control)?.pressed) return true
  const action = binding(control)?.action
  return action?.type === 'register'
    ? (runtime.state.registers[action.index] ?? false)
    : action?.type === 'transport' && action.cmd === 'toggle'
      ? runtime.transport.playing
      : false
}
function controlStyle(control: ControlDef) {
  const value = feedback(control),
    color =
      value?.color ?? setup.value.padColors[control.id] ?? 'var(--xm-accent)'
  return {
    '--c': color,
    '--v': live(control)?.value ?? 0,
    ...(value && control.kind === 'pad'
      ? {
          backgroundColor:
            value.state === 'off'
              ? 'transparent'
              : `color-mix(in srgb, ${color} ${Math.round(value.level * 100)}%, var(--xm-bg-2))`,
        }
      : {}),
  }
}
function open(event: MouseEvent, control: ControlDef): void {
  if (!control.msg) {
    learning.value = control.id
    return
  }
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  editing.value = {
    control,
    anchor: { left: r.left, right: r.right, top: r.top },
  }
}
function relearn(): void {
  if (editing.value) learning.value = editing.value.control.id
  editing.value = null
}
</script>
<template>
  <template v-if="device && profile">
    <div class="xm-controls-heading">
      <select
        v-model="selected"
        class="form-select form-select-sm"
        aria-label="Active controller"
      >
        <option
          v-if="!selected"
          value=""
        >
          {{ device.name }}
        </option>
        <option
          v-for="d in runtime.midi.devices"
          :key="d.id"
          :value="d.id"
        >
          {{ d.name }}
        </option>
      </select>
      <div
        v-if="hasBankB"
        class="xm-seg"
        aria-label="Pad bank"
      >
        <button
          :class="{ 'is-on': bank === 0 }"
          @click="bank = 0"
        >
          A
        </button><button
          :class="{ 'is-on': bank === 1 }"
          @click="bank = 1"
        >
          B
        </button>
      </div>
    </div>
    <div
      class="xm-seg mb-2"
      title="Where new bindings are stored"
    >
      <button
        :class="{ 'is-on': scope === 'shared' }"
        @click="scope = 'shared'"
      >
        Shared
      </button><button
        :class="{ 'is-on': scope === 'controller' }"
        @click="scope = 'controller'"
      >
        This controller
      </button><button
        :class="{ 'is-on': scope === 'scene' }"
        :disabled="!runtime.state.activeSceneId"
        @click="scope = 'scene'"
      >
        This scene
      </button>
    </div>
    <div class="xm-ctl xm-controls-profile">
      <div
        v-for="group in groups"
        :key="group.name"
        class="xm-controls-group"
      >
        <div class="xm-ctl-label">
          {{
            group.name === 'pads'
              ? `Pads · bank ${bank ? 'B' : 'A'}`
              : group.name
          }}
        </div>
        <div class="xm-control-scroll">
          <div
            :class="
              group.pad
                ? 'xm-pads'
                : group.strip
                  ? 'xm-ctl-row'
                  : 'xm-control-buttons'
            "
            :style="
              group.pad
                ? {}
                : {
                  gridTemplateColumns: `repeat(${group.columns}, minmax(var(--xm-hit), 1fr))`,
                }
            "
          >
            <button
              v-for="control in group.controls"
              :key="control.id"
              :class="[
                control.kind === 'pad'
                  ? 'xm-pad'
                  : control.kind === 'knob' || control.kind === 'encoder'
                    ? 'xm-knob'
                    : control.kind === 'fader'
                      ? 'xm-fader'
                      : 'xm-cbtn',
                {
                  'is-empty':
                    control.kind === 'pad' &&
                    (feedback(control)?.state === 'off' ||
                      (!feedback(control) && isUnbound(binding(control)))),
                  'is-lit': lit(control),
                  'is-blink': feedback(control)?.state === 'queued',
                  'is-sel': editing?.control.id === control.id,
                },
              ]"
              :style="controlStyle(control)"
              :aria-label="`Bind ${control.label}`"
              :title="`${control.label} · ${label(control)}${live(control) ? ` · ${Math.round(live(control)!.value * 127)}` : ''}`"
              @click="open($event, control)"
            >
              <i v-if="control.kind === 'pad'">{{
                control.id.split('.').at(-1)
              }}</i><i
                v-else-if="
                  control.kind === 'knob' ||
                    control.kind === 'encoder' ||
                    control.kind === 'fader'
                "
              /><span v-else>{{ control.label }}</span><span>{{ label(control) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <button
      v-if="!profile.controls.length"
      class="btn btn-sm btn-xm"
      @click="learning = ''"
    >
      Learn a control…
    </button>
    <BindingEditor
      v-if="editing"
      :key="`${device.id}:${editing.control.id}`"
      v-bind="editing"
      :profile-id="profile.id"
      :device-id="device.id"
      :initial-scope="scope"
      @close="editing = null"
      @learn="relearn"
    />
    <LearnWizard
      v-if="learning !== null"
      :device="device"
      :profile="profile"
      :control-id="learning || undefined"
      @close="learning = null"
    />
  </template>
  <span
    v-else
    class="xm-faint"
  >{{
    runtime.midi.devices.length
      ? 'Loading controller…'
      : 'No controller connected'
  }}</span>
  <div
    v-if="error"
    class="text-danger mt-2"
    role="alert"
  >
    {{ error }}
  </div>
</template>
