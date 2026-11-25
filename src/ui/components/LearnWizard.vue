<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { ControlDef, DeviceProfile } from '../../shared/model'
import { controlMessages, sameControlMessage } from '../../shared/control-messages'
import { uniqueId } from '../../shared/ids'
import { useSettingsStore } from '../stores/settings'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
const props = defineProps<{
    device: { id: string; name: string }
    profile: DeviceProfile
    controlId?: string
  }>(),
  emit = defineEmits<{ close: [] }>(),
  settings = useSettingsStore(),
  runtime = useRuntimeStore()
const dialog = ref<HTMLDialogElement>(),
  draft = ref<DeviceProfile>(structuredClone(props.profile)),
  items = ref(
    props.profile.controls
      .filter((c) => (props.controlId ? c.id === props.controlId : !c.msg))
      .map((c) => c.id),
  ),
  index = ref(0),
  pending = shallowRef<ControlDef | null>(null),
  error = ref(''),
  busy = ref(false),
  last = ref(''),
  newKind = ref<ControlDef['kind']>('button')
const current = computed(() =>
    draft.value.controls.find((c) => c.id === items.value[index.value]),
  ),
  connected = computed(() =>
    runtime.midi.devices.some((d) => d.id === props.device.id),
  ),
  completed = computed(
    () => index.value >= items.value.length && items.value.length > 0,
  )
function describe(control: ControlDef): string {
  const m = control.msg
  return m
    ? `${m.type === 'cc' ? 'CC' : 'Note'} ${m.number} on channel ${(m.channel ?? 0) + 1} (${control.mode === 'relative64' ? 'relative around 64' : control.mode})`
    : ''
}
function begin(): void {
  pending.value = null
  error.value = ''
  engineBus.value?.send('learn:stop', undefined)
  if (current.value && connected.value)
    engineBus.value?.send('learn:start', {
      deviceId: props.device.id,
      controlId: current.value.id,
      control: structuredClone({
        ...current.value,
        ui: { ...current.value.ui },
        ...(current.value.msg ? { msg: { ...current.value.msg } } : {}),
        ...(current.value.aliases
          ? { aliases: current.value.aliases.map((msg) => ({ ...msg })) }
          : {}),
      }),
    })
}
function add(): void {
  const kind = newKind.value
  let number = 1
  while (draft.value.controls.some((c) => c.id === `${kind}.${number}`))
    number++
  const id = `${kind}.${number}`,
    control: ControlDef = {
      id,
      label: `${kind[0].toUpperCase() + kind.slice(1)} ${draft.value.controls.filter((c) => c.kind === kind).length + 1}`,
      kind,
      mode: kind === 'pad' || kind === 'button' ? 'momentary' : 'absolute',
      ui: {
        group: kind + 's',
        row: 0,
        col: draft.value.controls.filter((c) => c.kind === kind).length,
      },
    }
  draft.value.controls.push(control)
  items.value.push(id)
  index.value = items.value.length - 1
  begin()
}
function accept(): boolean {
  if (!pending.value) return true
  const captured = pending.value,
    match = draft.value.controls.find(
      (c) =>
        c.id !== captured.id &&
        controlMessages(c).some((existing) =>
          controlMessages(captured).some((incoming) =>
            sameControlMessage(existing, incoming),
          ),
        ),
    )
  if (match) {
    error.value = `This message is already assigned to ${match.label}. Re-learn this control or skip it.`
    return false
  }
  draft.value.controls = draft.value.controls.map((c) =>
    c.id === captured.id ? captured : c,
  )
  last.value = `${captured.label} = ${describe(captured)}`
  return true
}
function next(skip = false): void {
  if (!skip && !accept()) return
  index.value++
  begin()
}
function back(): void {
  index.value = Math.max(0, index.value - 1)
  begin()
}
async function finish(): Promise<void> {
  if (!accept()) return
  busy.value = true
  error.value = ''
  try {
    const value = settings.value,
      profile = JSON.parse(JSON.stringify(draft.value)) as DeviceProfile
    if (profile.id === 'generic') {
      profile.id = uniqueId(
        `user-${props.device.name}`,
        value.devices.userProfiles.map((p) => p.id),
      )
      profile.name = props.device.name
      profile.ports = [
        { role: 'main', dir: 'both', match: [props.device.name] },
      ]
    }
    await settings.save({
      ...value,
      devices: {
        ...value.devices,
        userProfiles: [
          ...value.devices.userProfiles.filter((p) => p.id !== profile.id),
          profile,
        ],
        assignments: {
          ...value.devices.assignments,
          [props.device.name]: profile.id,
        },
      },
    })
    emit('close')
  } catch (reason) {
    error.value = String(reason)
  } finally {
    busy.value = false
  }
}
let unsubscribe: (() => void) | undefined
onMounted(() => {
  dialog.value!.showModal()
  unsubscribe = engineBus.value?.on('learn:captured', (event) => {
    if (
      event.deviceId === props.device.id &&
      event.control.id === current.value?.id
    ) {
      pending.value = event.control
      error.value = ''
    }
  })
  begin()
})
watch(connected, () => begin())
onUnmounted(() => {
  unsubscribe?.()
  engineBus.value?.send('learn:stop', undefined)
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-learn-dialog"
    aria-labelledby="learn-title"
    @cancel.prevent="!busy && emit('close')"
  >
    <div class="xm-dialog-h">
      <h5 id="learn-title">
        {{ t('learnWizard.learnControls') }} {{ profile.name }}
      </h5>
      <span class="xm-muted xm-mono">{{ Math.min(index + 1, items.length) }} / {{ items.length }}</span><button
        class="btn btn-sm btn-ghost"
        :aria-label="t('learnWizard.closeLearnControls')"
        :disabled="busy"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-dialog-b xm-learn-body">
      <template v-if="current">
        <div class="xm-faint xm-learn-eyebrow">
          {{ t('learnWizard.nowPressOrMove') }}
        </div>
        <h2>{{ current.label }}</h2>
        <div class="xm-ctl-row xm-learn-progress">
          <span
            v-for="(id, i) in items.slice(Math.max(0, index - 2), index + 3)"
            :key="id"
            class="xm-chip"
            :class="{ 'is-sel': id === current.id }"
          >{{ Math.max(0, index - 2) + i + 1
          }}{{
            draft.controls.find((c) => c.id === id)?.msg ? ' ✓' : ''
          }}</span>
        </div>
        <p class="xm-muted">
          {{
            current.kind === 'pad' || current.kind === 'button'
              ? 'Press and release the control.'
              : 'Sweep the full range, or turn the encoder in both directions, then pause.'
          }}
        </p>
        <div
          class="xm-status"
          aria-live="polite"
        >
          <span
            class="xm-dot"
            :class="pending ? '' : 'is-warn'"
          />{{
            !connected
              ? 'Controller disconnected'
              : pending
                ? `Captured: ${describe(pending)}`
                : 'Waiting for a MIDI message…'
          }}
        </div>
        <div
          v-if="pending && pending.kind !== 'pad' && pending.kind !== 'button'"
          class="xm-learn-mode"
        >
          <label
            for="learn-mode"
            class="form-label"
          >{{ t('learnWizard.detectedModeCorrectIfNeeded') }}</label><select
            id="learn-mode"
            class="form-select"
            :value="pending.mode"
            @change="
              pending = {
                ...pending,
                mode: ($event.target as HTMLSelectElement)
                  .value as ControlDef['mode'],
              }
            "
          >
            <option value="absolute">
              {{ t('learnWizard.absolute') }}
            </option>
            <option value="relative64">
              {{ t('learnWizard.relativeAround64') }}
            </option>
          </select>
        </div>
        <button
          v-if="pending"
          class="btn btn-sm btn-xm mt-3"
          @click="begin"
        >
          {{ t('learnWizard.reLearnThisControl') }}
        </button>
      </template>
      <template v-else-if="completed">
        <h2>{{ t('learnWizard.controlsCaptured') }}</h2>
        <p class="xm-muted">
          {{ t('learnWizard.finishToSaveThisControllerProfile') }}
        </p>
      </template>
      <template v-else>
        <h2>{{ t('learnWizard.addAControl') }}</h2>
        <p class="xm-muted">
          {{ t('learnWizard.chooseAControlTypeThenPressOrMoveIt') }}
        </p>
      </template>
      <div
        v-if="!current"
        class="xm-learn-add"
      >
        <select
          v-model="newKind"
          class="form-select"
          :aria-label="t('learnWizard.newControlType')"
        >
          <option
            v-for="kind in ['pad', 'button', 'knob', 'fader', 'encoder']"
            :key="kind"
            :value="kind"
          >
            {{ kind }}
          </option>
        </select><button
          class="btn btn-xm"
          @click="add"
        >
          {{ t('learnWizard.addControl') }}
        </button>
      </div>
      <div
        v-if="last"
        class="xm-faint mt-3"
      >
        {{ t('learnWizard.lastCaptured') }} {{ last }}
      </div>
      <div
        v-if="error"
        role="alert"
        class="text-danger mt-3"
      >
        {{ error }}
      </div>
    </div>
    <div class="xm-dialog-f">
      <button
        class="btn btn-xm me-auto"
        :disabled="busy || index === 0"
        @click="back"
      >
        {{ t('tutorial.back') }}
      </button><button
        v-if="current"
        class="btn btn-xm"
        :disabled="busy"
        @click="next(true)"
      >
        {{ t('learnWizard.skip') }}
      </button><button
        v-if="current"
        class="btn btn-xm"
        :disabled="busy || !pending"
        @click="next()"
      >
        {{ t('tutorial.next') }}
      </button><button
        class="btn btn-primary"
        :disabled="busy"
        @click="finish"
      >
        {{ t('tutorial.finish') }}
      </button>
    </div>
  </dialog>
</template>
