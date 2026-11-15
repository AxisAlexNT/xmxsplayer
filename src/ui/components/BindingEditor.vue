<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { Action, Binding, ControlDef } from '../../shared/model'
import { bindingSchema } from '../../shared/schema'
import { effectiveSetup, isUnbound, unbound } from '../../shared/overlay'
import {
  bindingLayer,
  writeBinding,
  writePadColor,
  type BindingScope,
} from '../bindings/edit'
import { palette, sentence } from '../bindings/labels'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import ActionPicker from './ActionPicker.vue'
import ConditionEditor from './ConditionEditor.vue'
const props = defineProps<{
    control: ControlDef
    profileId: string
    deviceId: string
    initialScope?: BindingScope['kind']
    anchor: { left: number; top: number; right: number }
  }>(),
  emit = defineEmits<{ close: []; learn: [] }>(),
  doc = useProjectStore(),
  runtime = useRuntimeStore(),
  pop = ref<HTMLElement>(),
  kind = ref<BindingScope['kind']>(props.initialScope ?? 'controller'),
  controllerScene = ref(false),
  edge = ref<Binding['edge']>(
    props.control.mode === 'momentary' ? 'press' : 'change',
  ),
  draft = shallowRef<Binding>(unbound(props.control.id, edge.value)),
  error = ref('')
const scope = computed<BindingScope>(() => ({
    kind: kind.value,
    profileId: props.profileId,
    sceneId: runtime.state.activeSceneId,
    controllerScene: controllerScene.value,
  })),
  setup = computed(() =>
    effectiveSetup(doc.project, runtime.state.activeSceneId, [props.profileId]),
  ),
  enabled = computed(() => !isUnbound(draft.value)),
  live = computed(
    () => runtime.controls[`${props.deviceId}|${props.control.id}`],
  ),
  scene = computed(() =>
    doc.project.scenes.find((s) => s.id === runtime.state.activeSceneId),
  )
const resolved = computed(
  () =>
    bindingLayer(doc.project, scope.value)?.bindings?.find(
      (b) => b.control === props.control.id && b.edge === edge.value,
    ) ??
    setup.value.bindings.find(
      (b) => b.control === props.control.id && b.edge === edge.value,
    ),
)
function load(): void {
  draft.value = JSON.parse(
    JSON.stringify(resolved.value ?? unbound(props.control.id, edge.value)),
  )
  error.value = ''
}
watch([resolved, scope, edge], load, { immediate: true })
function apply(next: Binding): void {
  draft.value = next
  const action = next.action
  if (
    action.type === 'param' &&
    action.target.startsWith('track.') &&
    !action.id &&
    !/^fader\.\d+$/.test(props.control.id)
  ) {
    error.value = 'Choose a track for this parameter.'
    return
  }
  const parsed = bindingSchema.safeParse(next)
  if (!parsed.success) {
    error.value = parsed.error.issues
      .map((i) => {
        const field = String(i.path.at(-1))
        return field.endsWith('Id')
          ? `Choose a ${field.slice(0, -2)}.`
          : `${sentence(field)}: ${i.message}`
      })
      .join('; ')
    return
  }
  try {
    doc.update((d) => writeBinding(d, scope.value, parsed.data))
    error.value = ''
  } catch (reason) {
    error.value = String(reason)
  }
}
function action(value: Action): void {
  const when = isUnbound(draft.value) ? undefined : draft.value.when
  apply({ ...draft.value, action: value, when })
}
function color(value: string | null): void {
  try {
    doc.update((d) => writePadColor(d, scope.value, props.control.id, value))
    error.value = ''
  } catch (reason) {
    error.value = String(reason)
  }
}
const returnFocus = document.activeElement as HTMLElement | null
let restoreFocus = false
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
    .value!.querySelector<HTMLSelectElement>('[aria-label="Action type"]')
    ?.focus({ preventScroll: true })
  observer = new ResizeObserver(position)
  observer.observe(pop.value!)
  window.addEventListener('resize', position)
  position()
})
onBeforeUnmount(() => {
  restoreFocus =
    document.activeElement === document.body ||
    !!pop.value?.contains(document.activeElement)
})
onUnmounted(() => {
  if (restoreFocus && returnFocus?.isConnected)
    returnFocus.focus({ preventScroll: true })
  observer?.disconnect()
  window.removeEventListener('resize', position)
})
</script>
<template>
  <Teleport to="body">
    <div
      ref="pop"
      popover="auto"
      class="xm-pop xm-binding-pop"
      aria-label="Binding editor"
      role="dialog"
      @toggle="($event as ToggleEvent).newState === 'closed' && emit('close')"
    >
      <div class="xm-row mb-3">
        <span
          v-if="control.kind === 'pad'"
          class="xm-pad xm-binding-pad"
          :style="{ '--c': setup.padColors[control.id] ?? 'var(--xm-accent)' }"
        ><i>{{ control.id.split('.').at(-1) }}</i></span>
        <div class="flex-grow-1">
          <b>{{ control.label }}</b>
          <div class="xm-faint xm-binding-midi">
            {{
              control.msg
                ? `${control.msg.type} ${control.msg.number} · ch ${control.msg.channel === null ? 'any' : control.msg.channel + 1}`
                : 'Not learned'
            }}
            · {{ (live?.value ?? 0).toFixed(2) }}
          </div>
        </div>
        <button
          class="btn btn-sm btn-ghost"
          aria-label="Close binding editor"
          @click="emit('close')"
        >
          <i class="bi bi-x-lg" />
        </button>
      </div>
      <label class="form-label">On</label>
      <div class="xm-seg mb-3">
        <button
          v-for="value in ['press', 'release', 'change'] as const"
          :key="value"
          :class="{ 'is-on': edge === value }"
          @click="edge = value"
        >
          {{ value[0].toUpperCase() + value.slice(1) }}
        </button>
      </div>
      <ActionPicker
        :model-value="draft.action"
        :project="doc.project"
        :unbound="!enabled"
        allow-unbound
        @update:model-value="action"
        @unbind="apply(unbound(control.id, edge))"
      />
      <div
        v-if="enabled"
        class="row g-2 mt-1"
      >
        <div class="col-7">
          <label class="form-label">Only when</label><ConditionEditor
            :model-value="draft.when"
            :project="doc.project"
            @update:model-value="apply({ ...draft, when: $event })"
          />
        </div>
        <div class="col-5">
          <label class="form-label">Timing</label><select
            class="form-select form-select-sm"
            aria-label="Binding timing"
            :value="draft.at ?? 'now'"
            @change="
              apply({
                ...draft,
                at: ($event.target as HTMLSelectElement).value as Binding['at'],
              })
            "
          >
            <option value="now">
              Now
            </option>
            <option value="beat">
              Beat
            </option>
            <option value="bar">
              Bar
            </option>
          </select>
        </div>
      </div>
      <label class="form-label mt-3">Store in</label>
      <div class="xm-seg">
        <button
          :class="{ 'is-on': kind === 'shared' }"
          @click="kind = 'shared'"
        >
          Shared
        </button><button
          :class="{ 'is-on': kind === 'controller' }"
          @click="kind = 'controller'"
        >
          This controller
        </button><button
          :class="{ 'is-on': kind === 'scene' }"
          :disabled="!scene"
          @click="kind = 'scene'"
        >
          {{ scene ? `Scene: ${scene.name}` : 'This scene' }}
        </button>
      </div>
      <label
        v-if="kind === 'controller' && scene"
        class="d-flex gap-2 mt-2 xm-muted"
      ><input
        v-model="controllerScene"
        type="checkbox"
      >Only in
        {{ scene.name }}</label>
      <template v-if="control.kind === 'pad'">
        <label class="form-label mt-3">Pad colour</label>
        <div class="xm-colours">
          <button
            v-for="value in palette"
            :key="value"
            :style="{ backgroundColor: value }"
            :aria-label="`Pad colour ${value}`"
            :class="{ 'is-selected': setup.padColors[control.id] === value }"
            @click="color(value)"
          /><button
            class="btn btn-sm btn-ghost"
            title="Use inherited colour"
            aria-label="Use inherited pad colour"
            @click="color(null)"
          >
            ⊘
          </button>
        </div>
      </template>
      <div
        v-if="error"
        role="alert"
        class="text-danger mt-2"
      >
        {{ error }}
      </div>
      <div class="xm-row justify-content-between mt-3">
        <button
          class="btn btn-sm btn-ghost text-danger"
          @click="apply(unbound(control.id, edge))"
        >
          Unbind
        </button><button
          class="btn btn-sm btn-xm"
          @click="emit('learn')"
        >
          Re-learn control
        </button>
      </div>
    </div>
  </Teleport>
</template>
