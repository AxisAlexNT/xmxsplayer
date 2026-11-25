<script setup lang="ts">
import PluginBrowser from './PluginBrowser.vue'
import type { PluginRef } from '../../shared/plugins'
const pluginBrowser = ref(false)
function addPlugin(plugin:PluginRef){
  edit(list=>list.push({id:uniqueId(plugin.name,list.map(e=>e.id)),type:'plugin',plugin,enabled:true,params:{}}))
  pluginBrowser.value=false
}
function setSidechain(index: number, trackId: string) {
  edit(list => {
    const effect = list[index]
    effect.sidechain = trackId ? {trackId} : undefined
    if (!effect.plugin || !/^http:\/\/lsp-plug\.in\/plugins\/lv2\/sc_compressor_(mono|stereo)$/.test(effect.plugin.uri)) return
    const selector = effect.plugin.parameters?.find(p => p.name === 'Sidechain type')
    if (selector) effect.params[selector.index] = trackId ? 2 : selector.initial
  })
}
import { openTutorialsKey } from '../tutorial/entry'
import { t } from '../i18n'
import { computed, inject, ref } from 'vue'
import {
  effectDefaults,
  controlsForEffect,
  type Effect,
  type EffectType,
} from '../../shared/effects'
import type { Project } from '../../shared/model'
import { uniqueId } from '../../shared/ids'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'

const openTutorials = inject(openTutorialsKey)
const props = defineProps<{
  instrumentId?: string
  orchestraId?: string
  section?: number
  label?: string
}>()
const doc = useProjectStore(),
  settings = useSettingsStore()
const dialog = ref<HTMLDialogElement>(),
  dragged = ref(-1),
  error = ref('')
const instrument = computed(() =>
  doc.project.instruments.find((i) => i.id === props.instrumentId),
)
const orchestra = computed(() =>
  doc.project.orchestras?.find((o) => o.id === props.orchestraId),
)
const name = computed(
  () =>
    instrument.value?.name ??
    (props.section !== undefined
      ? orchestra.value?.sections[props.section]?.name
      : orchestra.value?.name) ??
    'Master',
)
const native = computed(
  () =>
    instrument.value?.backend === 'fluid' ||
    (instrument.value?.backend === 'default' &&
      settings.value.audio.defaultSynth === 'fluid'),
)
const external = computed(() => instrument.value?.backend === 'midi')
function owner(project: Project) {
  if (props.instrumentId)
    return project.instruments.find((i) => i.id === props.instrumentId)
  if (props.orchestraId) {
    const o = project.orchestras?.find((o) => o.id === props.orchestraId)
    return props.section === undefined ? o : o?.sections[props.section]
  }
}
const isMaster = computed(() => !props.instrumentId && !props.orchestraId)
const chain = computed(
  () =>
    (isMaster.value
      ? doc.project.masterEffects
      : owner(doc.project)?.effects) ?? [],
)
const names: Record<EffectType, string> = {
  plugin: 'Plugin',
  eq: 'Equalizer',
  filter: 'Filter',
  drive: 'Drive',
  compressor: 'Compressor',
  pump: 'Pump',
  delay: 'Delay',
  reverb: 'Reverb',
  chorus: 'Chorus',
  width: 'Stereo width',
  limiter: 'Limiter',
}
const groups: Record<string, EffectType[]> = {
  Dynamics: ['compressor', 'pump', 'limiter'],
  Filter: ['eq', 'filter'],
  Drive: ['drive'],
  Time: ['delay', 'chorus'],
  Space: ['reverb'],
  Utility: ['width'],
}
function edit(fn: (effects: Effect[]) => void) {
  doc.update((project) => {
    if (isMaster.value) fn((project.masterEffects ??= []))
    else {
      const target = owner(project)
      if (target) fn((target.effects ??= []))
    }
  })
}
function add(event: Event) {
  const select = event.target as HTMLSelectElement
  const type = select.value as EffectType
  if (!type) return
  if (type==='plugin'){select.value='';pluginBrowser.value=true;return}
  edit((list) =>
    list.push({
      id: uniqueId(
        type,
        list.map((f) => f.id),
      ),
      type,
      enabled: true,
      params: effectDefaults(type),
    }),
  )
  select.value = ''
}
function move(from: number, to: number) {
  if (from === to || from < 0 || to < 0 || to >= chain.value.length) return
  edit((list) => list.splice(to, 0, list.splice(from, 1)[0]))
}
const savingPreset = ref(''),
  presetName = ref('')
function preset(event: Event, index: number) {
  const select = event.target as HTMLSelectElement
  const choice = select.value
  select.value = ''
  const effect = chain.value[index]
  if (choice === 'save') {
    savingPreset.value = effect.id
    presetName.value = effect.preset ?? names[effect.type]
  } else {
    const saved = settings.value.effectPresets?.[Number(choice)]
    if (saved?.type === effect.type)
      edit((list) => {
        list[index].params = { ...saved.params }
        list[index].preset = saved.name
      })
  }
}
async function savePreset(index: number) {
  const effect = chain.value[index]
  const name = presetName.value.trim()
  if (!name) return
  const others = (settings.value.effectPresets ?? []).filter(
    (p) => p.name !== name || p.type !== effect.type,
  )
  try {
    await settings.save({
      ...settings.value,
      effectPresets: [
        ...others,
        { name, type: effect.type, params: { ...effect.params } },
      ],
    })
    edit((list) => {
      const target = list.find((item) => item.id === effect.id)
      if (target) target.preset = name
    })
    savingPreset.value = ''
  } catch (e) {
    error.value = String(e)
  }
}
async function pluginWindow(id:string) {
  try { error.value='';await window.xm.plugins.editor(id) }
  catch(e){error.value=String(e)}
}
function nativeParam(key: 'reverb' | 'chorus', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  doc.update((p) => {
    const target = p.instruments.find((i) => i.id === props.instrumentId)
    if (target) target[key] = value
  })
}
</script>
<template>
  <button
    data-tour="fx-open"
    class="xm-chip is-sm"
    :aria-label="`Effects chain · ${name}`"
    @click="dialog?.showModal()"
  >
    {{ label ?? 'FX' }}
  </button>
  <dialog
    ref="dialog"
    class="xm-dialog xm-effects-dialog"
    :aria-label="`Effects chain · ${name}`"
  >
    <div class="xm-dialog-h">
      <h5>Effects chain · {{ name }}</h5>
      <button
        v-if="openTutorials"
        class="btn btn-sm btn-ghost"
        :aria-label="t('tutorial.effectsHelp')"
        @click="dialog?.close(); openTutorials('effects')"
      >
        ?
      </button>
    </div>
    <div
      v-if="native && instrument"
      class="xm-dialog-b"
    >
      <label
        v-for="key in ['reverb', 'chorus'] as const"
        :key="key"
      >{{ names[key] }}
        <input
          type="range"
          min="0"
          max="1"
          step=".01"
          :value="instrument[key]"
          @change="nativeParam(key, $event)"
        >
      </label>
      <p>Insert effects for FluidSynth run in the plugin host.</p>
    </div>
    <p
      v-else-if="external"
      class="xm-dialog-b"
    >
      Set effects on the external MIDI instrument.
    </p>
    <div
      v-else
      class="xm-dialog-b xm-fx-cards"
    >
      <button
        v-if="instrument?.backend==='plugin'"
        class="btn btn-sm btn-xm"
        @click="pluginWindow('instrument-'+instrument.id)"
      >
        Instrument window
      </button>
      <section
        v-for="(fx, i) in chain"
        :key="fx.id"
        data-tour="fx-card"
        class="xm-fxcard"
        @dragover.prevent
        @drop.prevent="move(dragged, i)"
      >
        <header class="xm-fxh">
          <span
            draggable="true"
            title="Drag to reorder"
            @dragstart="dragged = i"
            @dragend="dragged = -1"
          >⠿</span>
          <strong>{{ fx.plugin?.name ?? names[fx.type] }}</strong>
          <button
            data-tour="fx-power"
            class="xm-pwr"
            :class="{'is-on':fx.enabled}"
            :title="fx.enabled ? 'Bypass effect' : 'Enable effect'"
            :aria-pressed="fx.enabled"
            :aria-label="`Enable ${names[fx.type]}`"
            @click="
              edit((list) => {
                list[i].enabled = !list[i].enabled
              })
            "
          />
        </header>
        <button
          v-if="fx.type==='plugin' && (isMaster || instrument?.backend==='plugin')"
          class="btn btn-sm btn-xm"
          @click="pluginWindow((isMaster?'master':'instrument-'+instrument?.id)+'-insert-'+i)"
        >
          Plugin window
        </button>
        <label v-if="fx.type==='plugin' && fx.plugin?.hasSidechain !== false">Sidechain track
          <select
            :value="fx.sidechain?.trackId ?? ''"
            @change="setSidechain(i, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">None</option><option
              v-for="track in doc.project.tracks.filter(t=>t.kind==='midi')"
              :key="track.id"
              :value="track.id"
            >{{ track.name }}</option>
          </select>
        </label>
        <label v-if="fx.type === 'pump'">Trigger track
          <select
            :value="fx.trigger?.trackId ?? ''"
            @change="
              edit((list) => {
                const id = ($event.target as HTMLSelectElement).value
                list[i].trigger = id ? { trackId: id } : undefined
              })
            "
          >
            <option value="">Select track…</option>
            <option
              v-for="track in doc.project.tracks.filter(
                (t) => t.kind === 'midi',
              )"
              :key="track.id"
              :value="track.id"
            >
              {{ track.name }}
            </option>
          </select>
        </label>
        <label
          v-for="(spec, key) in controlsForEffect(fx)"
          :key="key"
          v-mappable="{label:fx.id+' '+spec.label,action:{type:'param',target:'effect.param',id:props.instrumentId?'instrument:'+props.instrumentId:props.section!==undefined?'section:'+props.orchestraId+':'+props.section:props.orchestraId?'orchestra:'+props.orchestraId:'master',effectId:fx.id,param:key,min:spec.min,max:spec.max}}"
        >{{ spec.label }}
          <select
            v-if="key === 'mode'"
            class="form-select form-select-sm"
            :value="fx.params[key] ?? spec.initial"
            @change="
              edit((list) => {
                list[i].params[key] = Number(
                  ($event.target as HTMLSelectElement).value,
                )
              })
            "
          >
            <option
              v-for="(mode, n) in ['Low-pass', 'High-pass', 'Band-pass']"
              :key="mode"
              :value="n"
            >
              {{ mode }}
            </option>
          </select>
          <input
            v-else-if="key === 'sync' || key === 'pingPong'"
            type="checkbox"
            :checked="!!fx.params[key]"
            @change="
              edit((list) => {
                list[i].params[key] = Number(
                  ($event.target as HTMLInputElement).checked,
                )
              })
            "
          >
          <template v-else><input
                             type="range"
                             :min="spec.min"
                             :max="spec.max"
                             :step="spec.step"
                             :value="fx.params[key] ?? spec.initial"
                             @change="
                               edit((list) => {
                                 list[i].params[key] = Number(
                                   ($event.target as HTMLInputElement).value,
                                 )
                               })
                             "
                           >
            <output>{{ fx.params[key] ?? spec.initial }} {{ spec.unit }}</output></template>
        </label>
        <select
          v-if="fx.type!=='plugin'"
          class="form-select form-select-sm"
          data-tour="fx-preset"
          aria-label="Effect presets"
          value=""
          @change="preset($event, i)"
        >
          <option value="">
            {{ fx.preset ?? 'Presets…' }}
          </option>
          <option value="save">
            Save preset…
          </option>
          <template
            v-for="(p, n) in settings.value.effectPresets"
            :key="n"
          >
            <option
              v-if="p.type === fx.type"
              :value="n"
            >
              {{ p.name }}
            </option>
          </template>
        </select>
        <form
          v-if="savingPreset === fx.id"
          @submit.prevent="savePreset(i)"
        >
          <label>Preset name<input
            v-model="presetName"
            required
          ></label>
          <button type="submit">
            Save
          </button><button
            type="button"
            @click="savingPreset = ''"
          >
            Cancel
          </button>
        </form>
        <footer>
          <button
            :disabled="i === 0"
            aria-label="Move earlier"
            @click="move(i, i - 1)"
          >
            ←
          </button>
          <button
            :disabled="i === chain.length - 1"
            aria-label="Move later"
            @click="move(i, i + 1)"
          >
            →
          </button>
          <button @click="edit((list) => list.splice(i, 1))">
            Remove
          </button>
        </footer>
      </section>
      <select
        data-tour="fx-add"
        aria-label="Add effect"
        class="xm-fx-add form-select form-select-sm"
        value=""
        @change="add"
      >
        <option value="plugin">
          Plugin effect…
        </option>
        <option value="">
          + Add effect…
        </option>
        <optgroup
          v-for="(types, group) in groups"
          :key="group"
          :label="group"
        >
          <option
            v-for="type in types"
            :key="type"
            :value="type"
          >
            {{ names[type] }}
          </option>
        </optgroup>
      </select>
      <PluginBrowser
        v-if="pluginBrowser"
        :instrument="false"
        @close="pluginBrowser=false"
        @choose="addPlugin"
      />
    </div>
    <div class="xm-dialog-f">
      <span
        v-if="error"
        role="alert"
      >{{ error }}</span><button
        class="btn btn-primary"
        @click="dialog?.close()"
      >
        Done
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.xm-effects-dialog {
  width: min(860px, 94vw);
}
.xm-fx-cards {
  display: flex;
  align-items: stretch;
  gap: 0.7rem;
  overflow: auto;
}
.xm-fxcard header,
.xm-fxcard footer {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.xm-fxcard header strong {
  flex: 1;
}
.xm-fxcard [draggable] {
  cursor: grab;
}
.xm-fxcard label {
  display: grid;
  grid-template-columns: 1fr auto;
  font-size: 0.8rem;
}
.xm-fxcard label input[type='range'] {
  grid-column: 1/-1;
  width: 100%;
}
.xm-fxcard output {
  grid-column: 2;
  grid-row: 1;
}
.xm-fx-add {
  align-self:flex-start;
  width:auto;
  flex: none;
}
</style>
