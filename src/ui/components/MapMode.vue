<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, ref, watch } from 'vue'
import type { Binding } from '../../shared/model'
import { effectiveSetup, isUnbound, unbound } from '../../shared/overlay'
import { engineBus } from '../bus'
import {
  mapActive,
  mapTarget,
  mapMenu,
  mapElements,
} from '../bindings/map-mode'
import { mapBinding, mappedBindings } from '../bindings/map-targets'
import { writeBinding } from '../bindings/edit'
import { actionLabel } from '../bindings/labels'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
const emit = defineEmits<{ edit: [deviceId: string, controlId: string] }>()
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  bubble = ref<HTMLElement>(),
  notice = ref('')
const pending = shallowRef<{
  binding: Binding
  profile: string
  scene: string | null
  existing?: Binding
}>()
const menuBindings = computed(() =>
  !mapMenu.value
    ? []
    : runtime.midi.devices.flatMap((device) =>
        mappedBindings(
          doc.project,
          runtime.state.activeSceneId,
          device.profileId,
          mapMenu.value!.action,
          mapMenu.value!.continuous,
        ).map((binding) => ({ device, binding })),
      ),
)
function cancel() {
  pending.value = undefined
  mapTarget.value = null
  mapMenu.value = null
  notice.value = ''
}
watch([() => doc.folder, () => runtime.state.activeSceneId], cancel)
watch(
  [mapActive, engineBus],
  ([active, bus], old) => {
    cancel()
    document.body.classList.toggle('xm-map-mode', active)
    if (active) bus?.send('learn:start', { binding: true })
    else if (old?.[0]) bus?.send('learn:stop', undefined)
  },
  { immediate: true },
)
function removeMapping(profileId:string,binding:Binding) {
  const sceneId=runtime.state.activeSceneId
  doc.update(p=>writeBinding(p,{kind:'controller',profileId,sceneId,controllerScene:!!sceneId},unbound(binding.control,binding.edge)))
  cancel()
}
function editMapping(device:string,control:string) {
  mapActive.value=false
  emit('edit',device,control)
}
function save() {
  const next = pending.value
  if (!next) return
  doc.update((p) =>
    writeBinding(
      p,
      {
        kind: 'controller',
        profileId: next.profile,
        sceneId: next.scene,
        controllerScene: !!next.scene,
      },
      next.binding,
    ),
  )
  cancel()
}
let hold: ReturnType<typeof setTimeout> | undefined
let held = false
function endHold() {
  clearTimeout(hold)
  hold = undefined
}
function grab(event: Event) {
  const el = (event.target as HTMLElement)?.closest<HTMLElement>('.xm-mappable')
  if (!el || !mapActive.value || el.closest('[disabled]')) return
  const target = mapElements.get(el)
  if (!target) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.type === 'pointerdown') {
    endHold()
    held = false
    hold = setTimeout(() => {
      held = true
      cancel()
      mapMenu.value = target
    }, 550)
  }
  if (event.type === 'pointerup') endHold()
  if (event.type === 'contextmenu') {
    cancel()
    mapMenu.value = target
  }
  if (event.type === 'click' && !held) {
    cancel()
    mapTarget.value = target
    el.animate([{outlineOffset:'0px'}, {outlineOffset:'3px'}, {outlineOffset:'0px'}], {duration:400})
  }
  if (event.type === 'click') held = false
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && mapActive.value) {
    event.preventDefault()
    event.stopImmediatePropagation()
    mapActive.value = false
  } else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'm' &&
    !event.repeat
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
    mapActive.value = !mapActive.value
  }
}
watch(
  engineBus,
  (bus, _, cleanup) => {
    const off = bus?.on('control', (e) => {
      if (
        !mapActive.value ||
        e.edge === 'release' ||
        (e.edge === 'change' && e.pressed)
      )
        return
      const device = runtime.midi.devices.find((d) => d.id === e.deviceId)
      if (!device) return
      const scene = runtime.state.activeSceneId
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-map-badge]',
      )) {
        const t = mapElements.get(el)
        if (
          t &&
          mappedBindings(doc.project, scene, device.profileId, t.action,t.continuous).some(
            (b) => b.control === e.controlId,
          )
        )
          el.animate(
            [{ outlineColor: 'white' }, { outlineColor: 'var(--xm-accent)' }],
            { duration: 350 },
          )
      }
      if (
        !mapTarget.value ||
        pending.value ||
        (e.edge !== 'press' && e.edge !== 'change')
      )
        return
      const binding = mapBinding(mapTarget.value.action, e.controlId, e.edge,mapTarget.value.continuous)
      if (!binding) {
        notice.value =
          mapTarget.value.action.type === 'param'
            ? 'Move a knob, fader or encoder.'
            : 'Press a pad or button.'
        return
      }
      const existing = effectiveSetup(doc.project, scene, [
        device.profileId,
      ]).bindings.find(
        (b) => b.control === e.controlId && b.edge === binding.edge,
      )
      pending.value = { binding, profile: device.profileId, scene, existing }
      if (isUnbound(existing)) save()
    })
    if (off) cleanup(off)
  },
  { immediate: true },
)
watch(
  [mapActive, mapTarget, mapMenu],
  () => {
    if (mapActive.value) bubble.value?.showPopover()
    else bubble.value?.hidePopover()
  },
  { flush: 'post' },
)
const events = ['pointerdown', 'pointerup', 'click', 'contextmenu']
onMounted(() => {
  document.addEventListener('pointercancel', endHold, true)
  document.addEventListener('pointerup', endHold, true)
  for (const name of events) document.addEventListener(name, grab, true)
  window.addEventListener('keydown', key, true)
})
onUnmounted(() => {
  endHold()
  document.removeEventListener('pointercancel', endHold, true)
  document.removeEventListener('pointerup', endHold, true)
  for (const name of events) document.removeEventListener(name, grab, true)
  window.removeEventListener('keydown', key, true)
  if (mapActive.value) engineBus.value?.send('learn:stop', undefined)
  mapActive.value = false
  document.body.classList.remove('xm-map-mode')
})
</script>
<template>
  <aside
    ref="bubble"
    popover="manual"
    class="xm-map-prompt"
    aria-label="Map controls"
  >
    <strong>{{ mapTarget?.label ?? mapMenu?.label ?? 'Map controls' }}</strong>
    <template v-if="pending?.existing">
      <span>{{ pending.binding.control }} currently controls
        {{ actionLabel(pending.existing.action, doc.project) }}.</span>
      <button @click="save">
        Replace
      </button><button @click="cancel">
        Cancel
      </button>
    </template>
    <template v-else-if="mapMenu">
      <span v-if="!menuBindings.length">No assigned control.</span>
      <div
        v-for="{ device, binding } in menuBindings"
        :key="device.id + binding.control + binding.edge"
      >
        {{ binding.control }}
        <button
          @click="removeMapping(device.profileId,binding)"
        >
          Unmap
        </button>
        <button
          @click="editMapping(device.id,binding.control)"
        >
          Edit
        </button>
      </div>
    </template>
    <span
      v-else
      role="status"
    >{{
      notice ||
        (mapTarget
          ? 'Move a knob or press a pad.'
          : 'Select an outlined control.')
    }}</span>
    <button @click="mapActive = false">
      Done
    </button>
  </aside>
</template>
