<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { Action, Binding, ControlDef } from '../../shared/model'
import { effectOwners } from '../../shared/effect-targets'
import { controlsForEffect } from '../../shared/effects'
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
import { engineBus } from '../bus'
import { useSettingsStore } from '../stores/settings'
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
const settings = useSettingsStore()
const sweepInstrument = ref('')
const sweepTarget = computed(() => doc.project.instruments.find(i => i.id === sweepInstrument.value) ?? doc.project.instruments[0])
async function filterSweep() {
  const instrument = sweepTarget.value
  if (!instrument) return
  const backend = instrument.backend === 'default' ? settings.value.audio.defaultSynth : instrument.backend
  if (backend !== 'web' && backend !== 'plugin') {
    error.value = 'Built-in or plugin engine only.'
    return
  }
  const inputs = instrument.plugin?.parameters?.filter(p => p.input) ?? []
  const cutoff = inputs.find(p => /cutoff|cut.off|filter frequency/i.test(p.name))
  if (backend === 'plugin' && !cutoff) {
    error.value = 'This plugin has no named cutoff control. Choose its parameter manually.'
    return
  }
  edge.value = 'change'
  await nextTick()
  const binding: Binding = {control: props.control.id, edge: 'change', action: cutoff && backend === 'plugin'
    ? {type:'param', target:'instrument.pluginParam', id:instrument.id, param:String(cutoff.index), min:cutoff.min, max:cutoff.max}
    : {type:'param', target:'instrument.cc', id:instrument.id, cc:74, min:0, max:127}}
  doc.update(project => {
    const target = project.instruments.find(i => i.id === instrument.id)!
    if (backend === 'web') target.initCc = {...target.initCc, 71:100}
    else {
      const resonance = inputs.find(p => /resonance/i.test(p.name))
      if (resonance) target.pluginParams = {...target.pluginParams,
        [resonance.index]:resonance.min + (resonance.max - resonance.min) * 100 / 127}
    }
    writeBinding(project, scope.value, binding)
  })
  error.value = ''
}
async function chooseRecipe(event: Event) {
  const menu = event.target as HTMLSelectElement
  const recipe = menu.value
  menu.value = ''
  const p = doc.project
  let target: Action | undefined
  let trigger: Binding['edge'] = 'change'
  if (recipe === 'volume' || recipe === 'reverb') {
    const instrument = p.instruments[0]
    if (instrument) target = {type:'param', target:recipe === 'volume' ? 'instrument.volume' : 'instrument.reverb', id:instrument.id, min:0, max:1}
  } else if (recipe === 'orchestra') {
    trigger = 'press'
    if (p.orchestras?.length) target = {type:'orchestra', cmd:'select', orchestraId:p.orchestras[0].id}
  } else if (recipe === 'section') {
    trigger = 'press'
    const section = p.orchestras?.flatMap(o => o.sections).find(s => s.register !== null)
    if (section?.register != null) target = {type:'register', cmd:'toggle', index:section.register}
  } else if (recipe === 'effect') {
    for (const owner of effectOwners(p)) {
      const effect = owner.effects?.find(f => Object.keys(controlsForEffect(f)).length)
      if (!effect) continue
      const [param, spec] = Object.entries(controlsForEffect(effect))[0]
      target = {type:'param', target:'effect.param', id:owner.id, effectId:effect.id, param, min:spec.min, max:spec.max}
      break
    }
  }
  if (!target) {
    error.value = recipe === 'effect' ? 'Add an effect with a control first.' :
      recipe === 'section' || recipe === 'orchestra' ? 'Add an orchestra with registered sections first.' : 'Add an instrument first.'
    return
  }
  edge.value = trigger
  await nextTick()
  apply({ control:props.control.id, edge:trigger, action:target })
}
async function drumRoll() {
  const track = doc.project.tracks.find(t => t.kind === 'midi')
  if (!track) {
    error.value = 'Add a MIDI track to play the drum roll.'
    return
  }
  edge.value = 'change'
  await nextTick()
  apply({
    control: props.control.id, edge: 'change', every: 3, direction: 'any',
    action: { type: 'note', trackId: track.id, key: 36, velocity: 'speed', gateMs: 60 },
  })
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
const hits = ref<number[]>([])
watch([scope, edge, () => props.control.id], () => { hits.value = [] })
watch(engineBus, (bus, _, cleanup) => {
  const off = bus?.on('binding:hit', hit => {
    if (hit.deviceId === props.deviceId && hit.controlId === props.control.id)
      hits.value = [...hits.value.slice(-23), hit.velocity]
  })
  if (off) cleanup(off)
}, { immediate: true })
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
      <label class="form-label">Binding recipe
        <select
          class="form-select"
          @change="chooseRecipe"
        >
          <option value="">Choose a recipe…</option>
          <template v-if="control.mode === 'momentary'">
            <option value="orchestra">Switch orchestra</option>
            <option value="section">Toggle section</option>
          </template>
          <template v-else>
            <option value="volume">Volume</option>
            <option value="reverb">Reverb amount</option>
            <option value="effect">Effect knob</option>
          </template>
        </select>
      </label>
      <button
        v-if="control.mode !== 'momentary'"
        class="btn btn-sm btn-xm"
        @click="drumRoll"
      >
        Drum roll
      </button>
      <div
        v-if="control.mode !== 'momentary' && sweepTarget"
        class="d-flex gap-2 mt-2"
      >
        <select
          class="form-select form-select-sm"
          aria-label="Filter sweep instrument"
          :value="sweepTarget.id"
          @change="sweepInstrument=($event.target as HTMLSelectElement).value"
        >
          <option
            v-for="instrument in doc.project.instruments"
            :key="instrument.id"
            :value="instrument.id"
          >
            {{ instrument.name }}
          </option>
        </select>
        <button
          class="btn btn-sm btn-xm"
          @click="filterSweep"
        >
          Filter sweep
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
      <div
        v-if="enabled && edge === 'change'"
        class="row g-2"
      >
        <label class="col form-label">Trigger every (MIDI steps)
          <input
            type="number"
            min="1"
            class="form-control"
            placeholder="Each change"
            :value="draft.every"
            @change="apply({...draft, every: Number(($event.target as HTMLInputElement).value) || undefined})"
          >
        </label>
        <label class="col form-label">Direction
          <select
            class="form-select"
            :value="draft.direction ?? 'any'"
            @change="apply({...draft, direction: ($event.target as HTMLSelectElement).value as Binding['direction']})"
          >
            <option value="any">Both</option><option value="up">Up</option><option value="down">Down</option>
          </select>
        </label>
      </div>
      <div v-if="edge === 'change' && draft.action.type === 'note'">
        <span class="form-label">Hit preview · move the control</span>
        <div
          class="xm-ticks"
          role="img"
          :aria-label="`Recent hits: ${hits.length}, last velocity: ${hits.at(-1) ?? 0}`"
        >
          <i
            v-for="i in 24"
            :key="i"
            :class="{ 'is-hit': i <= hits.length }"
            :style="i <= hits.length ? {height: Math.max(8, hits[i-1] / 127 * 100) + '%'} : {}"
          />
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
