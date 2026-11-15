<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { DeviceProfile } from '../../shared/model'
import { engineBus } from '../bus'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import LearnWizard from './LearnWizard.vue'
const runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  profiles = shallowRef<DeviceProfile[]>([]),
  error = ref(''),
  learning = shallowRef<{
    device: { id: string; name: string }
    profile: DeviceProfile
    controlId?: string
  } | null>(null)
const devices = computed(() =>
  runtime.midi.devices.map((device) => ({
    ...device,
    profile: profiles.value.find((p) => p.id === device.profileId),
  })),
)
async function refresh(): Promise<void> {
  if (!runtime.connected) return
  try {
    profiles.value = await engineBus.value!.request(
      'device:profiles',
      undefined,
    )
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
async function assign(name: string, profileId: string): Promise<void> {
  try {
    const v = settings.value
    await settings.save({
      ...v,
      devices: {
        ...v.devices,
        assignments: { ...v.devices.assignments, [name]: profileId },
      },
    })
  } catch (reason) {
    error.value = String(reason)
  }
}
async function forceProgram(event: Event): Promise<void> {
  const value = settings.value
  try {
    await settings.save({
      ...value,
      devices: {
        ...value.devices,
        arturiaForceProgram: (event.target as HTMLInputElement).checked,
      },
    })
  } catch (reason) {
    error.value = String(reason)
  }
}
function learn(deviceId: string, controlId?: string): void {
  const d = devices.value.find((d) => d.id === deviceId)
  if (d?.profile)
    learning.value = {
      device: { id: d.id, name: d.name },
      profile: d.profile,
      controlId,
    }
}
defineExpose({ learn })
</script>
<template>
  <div class="xm-list xm-devices-list">
    <div
      v-for="device in devices"
      :key="device.id"
      class="xm-device-row"
    >
      <div class="xm-row">
        <span class="xm-dot" /><strong>{{ device.name }}</strong><button
          class="btn btn-sm btn-xm ms-auto"
          :disabled="!device.profile"
          :aria-label="`Learn ${device.name} controls`"
          @click="learn(device.id)"
        >
          Learn…
        </button>
      </div>
      <label class="xm-muted">Profile<select
        class="form-select form-select-sm"
        :aria-label="`${device.name} profile`"
        :value="device.profileId"
        @change="
          assign(device.name, ($event.target as HTMLSelectElement).value)
        "
      >
        <option
          v-for="profile in profiles"
          :key="profile.id"
          :value="profile.id"
        >
          {{ profile.name }}
        </option>
      </select></label><span
        v-if="device.profile"
        class="xm-faint"
      >{{ device.profile.controls.filter((c) => c.msg).length }} of
        {{ device.profile.controls.length }} controls learned</span><span
        v-if="device.profile?.feedback"
        class="xm-faint"
        :class="{
          'text-danger': runtime.feedback[device.id]?.status === 'error',
        }"
      >{{
        runtime.feedback[device.id]?.status === 'active'
          ? 'Feedback active'
          : (runtime.feedback[device.id]?.error ?? 'Feedback unavailable')
      }}</span>
    </div>
    <div
      v-if="!devices.length"
      class="xm-faint"
    >
      No controller connected
    </div>
  </div>
  <label
    v-if="devices.some((d) => d.profile?.feedback === 'arturia-mk3')"
    class="xm-force-program"
  ><input
    type="checkbox"
    :checked="settings.value.devices.arturiaForceProgram"
    @change="forceProgram"
  >Select Arturia program on connect</label>
  <p
    v-if="settings.value.devices.arturiaForceProgram"
    class="xm-faint mt-1"
  >
    Changes the keyboard's active program.
  </p>
  <div
    v-if="error"
    class="text-danger mt-2"
    role="alert"
  >
    {{ error }}
  </div>
  <LearnWizard
    v-if="learning"
    v-bind="learning"
    @close="learning = null"
  />
</template>
