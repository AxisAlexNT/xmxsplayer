<script setup lang="ts">
import { t } from '../i18n'
import { orchestraSections } from '../../shared/orchestra'
import { effectOwners } from '../../shared/effect-targets'
import { controlsForEffect } from '../../shared/effects'
import { computed } from 'vue'
import type { Action, Project, ParamTarget } from '../../shared/model'
import { sentence } from '../bindings/labels'
const props = defineProps<{
    modelValue: Action
    project: Project
    unbound?: boolean
    allowUnbound?: boolean
  }>(),
  emit = defineEmits<{ 'update:modelValue': [value: Action]; unbind: [] }>()
const a = computed(() => props.modelValue),
  types = [
    'transport',
    'scene',
    'orchestra',
    'register',
    'note',
    'param',
    'trackMode',
    'follow',
    'cue',
    'clip',
    'app',
    'script',
    'pdf',
  ] as const
const commands = computed(() =>
  a.value.type === 'transport'
    ? [
        'toggle',
        'play',
        'pause',
        'stop',
        'record',
        'recordMode',
        'rewind',
        'forward',
        'toStart',
        'loopToggle',
        'loopStartHere',
        'loopEndHere',
        'tap',
        'tapBeat',
        'metronome',
        'scrub',
        'skipHold',
      ]
    : a.value.type === 'pdf' ? ['next','prev','scroll','toggleTheme'] : a.value.type === 'scene'
      ? ['activate', 'next', 'prev', 'clear']
      : a.value.type === 'orchestra' ? ['select','next','prev'] : a.value.type === 'register'
        ? ['toggle', 'set', 'momentary']
        : a.value.type === 'cue'
          ? ['fireNext', 'fire', 'prev', 'next']
          : a.value.type === 'clip'
            ? [
                'launch',
                'stop',
                'sweep',
                'pitch',
                'gain',
                'stopAll',
                'stopGroup',
              ]
            : a.value.type === 'app'
              ? [
                  'save',
                  'undo',
                  'redo',
                  'quantize',
                  'toggleFollowView',
                  'toggleLanes',
                  'zoomIn',
                  'zoomOut',
                  'insertBar',
                  'deleteBar',
                  'appendBar',
                ]
              : [],
)
function patch(value: object): void {
  emit('update:modelValue', { ...a.value, ...value } as Action)
}
function choose(type: Action['type'] | ''): void {
  if (!type) {
    emit('unbind')
    return
  }
  const p = props.project
  emit(
    'update:modelValue',
    type === 'transport'
      ? { type, cmd: 'toggle' }
      : type === 'pdf' ? {type,cmd:'next'} : type === 'scene'
        ? { type, cmd: 'next' }
        : type === 'orchestra' ? {type,cmd:'select',orchestraId:p.orchestras?.[0]?.id} : type === 'register'
          ? { type, cmd: 'toggle', index: 0 }
          : type === 'note'
            ? {
                type,
                trackId: p.tracks.find((t) => t.kind === 'midi')?.id ?? '',
                key: 60,
                velocity: 'control',
              }
            : type === 'param'
              ? { type, target: 'rate', min: 0.25, max: 1.5 }
              : type === 'trackMode'
                ? { type, trackId: p.tracks[0]?.id ?? '', mode: 'cycle' }
                : type === 'follow'
                  ? { type, mode: 'cycle' }
                  : type === 'cue'
                    ? { type, cmd: 'fireNext' }
                    : type === 'clip'
                      ? { type, cmd: 'launch', clipId: p.clips[0]?.id ?? '' }
                      : type === 'app'
                        ? { type, cmd: 'save' }
                        : { type: 'script', fn: '' },
  )
}
function command(cmd: string): void {
  if(a.value.type==='orchestra')emit('update:modelValue',{type:'orchestra',cmd:cmd as 'select'|'next'|'prev',...(cmd==='select'?{orchestraId:props.project.orchestras?.[0]?.id}:{})})
  else if (a.value.type === 'scene')
    emit('update:modelValue', {
      type: 'scene',
      cmd: cmd as 'activate' | 'next' | 'prev' | 'clear',
      ...(cmd === 'activate'
        ? { sceneId: props.project.scenes[0]?.id ?? '' }
        : {}),
    })
  else if (a.value.type === 'cue')
    emit('update:modelValue', {
      type: 'cue',
      cmd: cmd as 'fireNext' | 'fire' | 'prev' | 'next',
      ...(cmd === 'fire' ? { cueId: props.project.cues[0]?.id ?? '' } : {}),
    })
  else if (a.value.type === 'clip')
    emit('update:modelValue', {
      type: 'clip',
      cmd: cmd as Extract<Action, { type: 'clip' }>['cmd'],
      ...(cmd === 'stopGroup'
        ? { group: a.value.group ?? '' }
        : cmd === 'stopAll'
          ? {}
          : { clipId: a.value.clipId ?? props.project.clips[0]?.id ?? '' }),
    })
  else if (a.value.type === 'register')
    patch({ cmd, ...(cmd === 'set' ? { on: a.value.on ?? true } : {}) })
  else patch({ cmd })
}
const effectChoices = computed(() => effectOwners(props.project).flatMap(owner =>
  (owner.effects ?? []).flatMap(effect => Object.entries(controlsForEffect(effect)).map(([param, spec]) => ({
    label: owner.name + ' · ' + effect.id + ' · ' + spec.label,
    action: {type: 'param' as const, target: 'effect.param' as const, id: owner.id, effectId: effect.id, param, min: spec.min, max: spec.max},
  })))
))
const selectedEffect = computed(() => {
  const action = a.value
  if (action.type !== 'param') return -1
  return effectChoices.value.findIndex(({action: choice}) =>
    choice.id === action.id && choice.effectId === action.effectId && choice.param === action.param)
})
function selectEffect(index: number) {
  const choice = effectChoices.value[index]
  if (choice) emit('update:modelValue', choice.action)
}
const sections = computed(() => orchestraSections(props.project))
function selectNoteTarget(value: string) {
  if (a.value.type === 'trackMode') patch({trackId:value})
  else if (value.startsWith('instrument:')) patch({instrumentId:value.slice(11),trackId:undefined})
  else patch({trackId:value,instrumentId:undefined})
}
const pluginControls = computed(() => props.project.instruments.filter(i => i.backend === 'plugin')
  .flatMap(i => (i.plugin?.parameters ?? []).filter(p => p.input).map(p => ({
    label: i.name + ' · ' + p.name, id: i.id, param: String(p.index), min: p.min, max: p.max,
  }))))
function selectPlugin(index: number) {
  const choice = pluginControls.value[index]
  if (choice) emit('update:modelValue', {type: 'param', target:'instrument.pluginParam', id:choice.id,
    param:choice.param, min:choice.min, max:choice.max})
}
function target(target: ParamTarget): void {
  if (target === 'instrument.pluginParam') return selectPlugin(0)
  if (target === 'effect.param') return selectEffect(0)
  const instrument = target.startsWith('instrument.'),
    track = target.startsWith('track.') || target.startsWith('audio.'),
    id = target.startsWith('orchestra.') ? props.project.orchestras?.[0]?.id : target === 'section.gain' ? sections.value[0]?.id : instrument
      ? props.project.instruments[0]?.id
      : track
        ? props.project.tracks.find(
            (t) => !target.startsWith('audio.') || t.kind === 'audio',
          )?.id
        : undefined
  emit('update:modelValue', {
    type: 'param',
    target,
    ...(id ? { id } : {}),
    ...(target === 'instrument.cc' ? { cc: 74 } : {}),
    min:
      target === 'rate'
        ? 0.25
        : target === 'track.pan'
          ? -1
          : target === 'audio.semitones'
            ? -12
            : target === 'audio.filterFreq'
              ? 20
              : 0,
    max:
      target === 'instrument.cc' ? 127 : target === 'rate'
        ? 1.5
        : target === 'audio.semitones'
          ? 12
          : target === 'audio.filterFreq'
            ? 12000
            : 1,
  })
}
const targets: ParamTarget[] = [
  'rate',
  'masterVolume',
  'orchestra.volume', 'orchestra.reverb', 'orchestra.chorus', 'orchestra.brightness',
  'section.gain',
  'effect.param',
  'track.volume',
  'track.pan',
  'instrument.pluginParam',
  'instrument.cc',
  'instrument.volume',
  'instrument.reverb',
  'instrument.chorus',
  'audio.semitones',
  'audio.filterFreq',
]
</script>
<template>
  <label v-if="a.type==='orchestra' && a.cmd==='select'">{{ t('actionPicker.orchestra') }} <select
    :value="a.orchestraId"
    @change="patch({orchestraId:($event.target as HTMLSelectElement).value})"
  ><option
    v-for="o in project.orchestras"
    :key="o.id"
    :value="o.id"
  >{{ o.name }}</option></select></label>
  <div class="xm-action-picker">
    <div class="row g-2">
      <div class="col-6">
        <label class="form-label">{{ t('actionPicker.action') }}</label><select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.actionType')"
          :value="unbound ? '' : a.type"
          @change="
            choose(
              ($event.target as HTMLSelectElement).value as Action['type'] | '',
            )
          "
        >
          <option
            v-if="allowUnbound"
            value=""
          >
            {{ t('actionPicker.unbound') }}
          </option>
          <option
            v-for="type in types"
            :key="type"
            :value="type"
          >
            {{ type === 'param' ? 'Parameter' : sentence(type) }}
          </option>
        </select>
      </div>
      <div
        v-if="commands.length && !unbound"
        class="col-6"
      >
        <label class="form-label">{{ t('actionPicker.command') }}</label><select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.actionCommand')"
          :value="'cmd' in a ? a.cmd : ''"
          @change="command(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="cmd in commands"
            :key="cmd"
            :value="cmd"
          >
            {{
              cmd === 'toggle' && a.type === 'transport'
                ? 'Play / pause'
                : sentence(cmd)
            }}
          </option>
        </select>
      </div>
    </div>
    <div
      v-if="!unbound"
      class="xm-action-fields mt-2"
    >
      <template v-if="a.type==='pdf'">
        <label>{{ t('actionPicker.pdfScore') }}
          <select
            :value="a.documentId ?? ''"
            @change="patch({documentId:($event.target as HTMLSelectElement).value || undefined})"
          >
            <option value="">{{ t('actionPicker.activeScore') }}</option>
            <option
              v-for="sheet in project.documents"
              :key="sheet.id"
              :value="sheet.id"
            >{{ sheet.name }}</option>
          </select>
        </label>
        <label v-if="a.cmd==='scroll'">{{ t('actionPicker.scrollDistancePixels') }}
          <input
            type="number"
            :value="a.amount ?? 160"
            @change="patch({amount:Number(($event.target as HTMLInputElement).value)})"
          >
        </label>
      </template>
      <template v-if="a.type === 'param'">
        <label class="form-label">{{ t('actionPicker.parameter') }}</label><select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.parameterTarget')"
          :value="a.target"
          @change="
            target(($event.target as HTMLSelectElement).value as ParamTarget)
          "
        >
          <option
            v-for="targetName in targets"
            :key="targetName"
            :disabled="(targetName==='section.gain' && !sections.length) || (targetName==='effect.param' && !effectChoices.length) || (targetName==='instrument.pluginParam' && !pluginControls.length)"
            :value="targetName"
          >
            {{ sentence(targetName) }}
          </option>
        </select>
        <label
          v-if="a.target.startsWith('orchestra.')"
          class="form-label"
        >{{ t('actionPicker.orchestra') }}
          <select
            class="form-select"
            :value="a.id"
            @change="patch({id:($event.target as HTMLSelectElement).value})"
          >
            <option
              v-for="o in project.orchestras"
              :key="o.id"
              :value="o.id"
            >{{ o.name }}</option>
          </select>
        </label>
        <label
          v-if="a.target==='section.gain'"
          class="form-label"
        >{{ t('actionPicker.orchestraSection') }}
          <select
            class="form-select"
            :value="a.id"
            @change="patch({id:($event.target as HTMLSelectElement).value})"
          >
            <option
              v-for="s in sections"
              :key="s.id"
              :value="s.id"
            >{{ s.name }}</option>
          </select>
        </label>
        <label
          v-if="a.target==='instrument.cc'"
          class="form-label"
        >{{ t('actionPicker.midiControllerNumber') }}
          <input
            type="number"
            min="0"
            max="127"
            class="form-control"
            :value="a.cc"
            @change="patch({cc: Number(($event.target as HTMLInputElement).value)})"
          >
        </label>
        <label
          v-if="a.target==='effect.param'"
          class="form-label mt-2"
        >{{ t('actionPicker.effectParameter') }}
          <select
            class="form-select form-select-sm"
            :aria-label="t('actionPicker.effectParameter')"
            :value="selectedEffect"
            @change="selectEffect(Number(($event.target as HTMLSelectElement).value))"
          >
            <option
              v-for="(choice,i) in effectChoices"
              :key="i"
              :value="i"
            >{{ choice.label }}</option>
          </select>
        </label><label
          v-if="a.target==='instrument.pluginParam'"
          class="form-label mt-2"
        >{{ t('actionPicker.pluginControl') }}<select
          class="form-select"
          :value="pluginControls.findIndex(p=>a.type==='param' && p.id===a.id && p.param===a.param)"
          @change="selectPlugin(Number(($event.target as HTMLSelectElement).value))"
        >
          <option
            v-for="(p,i) in pluginControls"
            :key="p.id + ':' + p.param"
            :value="i"
          >{{ p.label }}</option>
        </select></label><label
          v-else-if="a.target.startsWith('instrument.')"
          class="form-label mt-2"
        >{{ t('actionPicker.instrument') }}<select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.parameterInstrument')"
          :value="a.id ?? ''"
          @change="patch({ id: ($event.target as HTMLSelectElement).value })"
        >
          <option
            value=""
            disabled
          >{{ t('actionPicker.selectInstrument') }}</option>
          <option
            v-for="instrument in project.instruments"
            :key="instrument.id"
            :value="instrument.id"
          >
            {{ instrument.name }}
          </option>
        </select></label><label
          v-else-if="
            a.target.startsWith('track.') || a.target.startsWith('audio.')
          "
          class="form-label mt-2"
        >{{ t('actionPicker.track') }}<select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.parameterTrack')"
          :value="a.id ?? ''"
          @change="
            patch({
              id: ($event.target as HTMLSelectElement).value || undefined,
            })
          "
        >
          <option value="">{{ t('actionPicker.byFaderOrder') }}</option>
          <option
            v-for="track in project.tracks.filter(
              (t) =>
                a.type === 'param' &&
                (!a.target.startsWith('audio.') || t.kind === 'audio'),
            )"
            :key="track.id"
            :value="track.id"
          >
            {{ track.name }}
          </option>
        </select></label>
        <div class="xm-row mt-2">
          <label class="form-label">{{ t('actionPicker.minimum') }}<input
            class="form-control form-control-sm"
            type="number"
            :aria-label="t('actionPicker.parameterMinimum')"
            :value="a.min"
            @change="
              patch({
                min: Number(($event.target as HTMLInputElement).value),
              })
            "
          ></label><label class="form-label">{{ t('actionPicker.maximum') }}<input
            class="form-control form-control-sm"
            type="number"
            :aria-label="t('actionPicker.parameterMaximum')"
            :value="a.max"
            @change="
              patch({
                max: Number(($event.target as HTMLInputElement).value),
              })
            "
          ></label>
        </div>
      </template>
      <template v-if="a.type === 'note' || a.type === 'trackMode'">
        <label class="form-label">{{ a.type === 'note' ? 'Play through' : 'Track' }}<select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.actionTrack')"
          :value="a.type === 'note' && a.instrumentId ? 'instrument:' + a.instrumentId : a.trackId"
          @change="selectNoteTarget(($event.target as HTMLSelectElement).value)"
        >
          <optgroup
            v-if="a.type === 'note'"
            label="Instruments"
          >
            <option
              v-for="instrument in project.instruments"
              :key="instrument.id"
              :value="'instrument:' + instrument.id"
            >{{ instrument.name }}</option>
          </optgroup>
          <option
            value=""
            disabled
          >{{ t('actionPicker.selectTrack') }}</option>
          <option
            v-for="track in project.tracks.filter(
              (t) => a.type !== 'note' || t.kind === 'midi',
            )"
            :key="track.id"
            :value="track.id"
          >
            {{ track.name }}
          </option>
        </select></label><template v-if="a.type === 'note'">
          <div class="xm-row mt-2">
            <label class="form-label">{{ t('actionPicker.midiKey') }}<input
              class="form-control form-control-sm"
              type="number"
              min="0"
              max="127"
              :aria-label="t('actionPicker.noteKey')"
              :value="a.key"
              @change="
                patch({
                  key: Number(($event.target as HTMLInputElement).value),
                })
              "
            ></label><label class="form-label">{{ t('actionPicker.velocity') }}<select
              class="form-select form-select-sm"
              :aria-label="t('actionPicker.noteVelocitySource')"
              :value="typeof a.velocity === 'number' ? 'fixed' : a.velocity"
              @change="
                patch({
                  velocity:
                    ($event.target as HTMLSelectElement).value === 'fixed'
                      ? 100
                      : ($event.target as HTMLSelectElement).value as 'speed' | 'control',
                })
              "
            >
              <option value="control">{{ t('actionPicker.control') }}</option>
              <option value="speed">{{ t('actionPicker.movementSpeed') }}</option>
              <option value="fixed">{{ t('actionPicker.fixed') }}</option>
            </select></label><input
              v-if="typeof a.velocity === 'number'"
              class="form-control form-control-sm"
              type="number"
              min="1"
              max="127"
              :aria-label="t('actionPicker.noteVelocity')"
              :value="a.velocity"
              @change="
                patch({
                  velocity: Number(($event.target as HTMLInputElement).value),
                })
              "
            >
            <label class="form-label">{{ t('actionPicker.autoReleaseMs') }}
              <input
                type="number"
                min="1"
                class="form-control form-control-sm"
                :placeholder="t('actionPicker.onRelease')"
                :value="a.gateMs"
                @change="patch({gateMs:Number(($event.target as HTMLInputElement).value) || undefined})"
              >
            </label>
          </div>
        </template><select
          v-else
          class="form-select form-select-sm mt-2"
          :aria-label="t('actionPicker.trackModeAction')"
          :value="a.mode"
          @change="patch({ mode: ($event.target as HTMLSelectElement).value })"
        >
          <option
            v-for="mode in ['auto', 'live', 'mute', 'cycle']"
            :key="mode"
            :value="mode"
          >
            {{ sentence(mode) }}
          </option>
        </select>
      </template>
      <template v-if="a.type === 'register'">
        <select
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.actionRegister')"
          :value="a.index"
          @change="
            patch({ index: Number(($event.target as HTMLSelectElement).value) })
          "
        >
          <option
            v-for="(reg, i) in project.registers"
            :key="i"
            :value="i"
          >
            {{ i + 1 }} · {{ reg.name }}
          </option>
        </select><select
          v-if="a.cmd === 'set'"
          class="form-select form-select-sm mt-2"
          :aria-label="t('actionPicker.registerActionState')"
          :value="String(a.on ?? true)"
          @change="
            patch({ on: ($event.target as HTMLSelectElement).value === 'true' })
          "
        >
          <option value="true">
            {{ t('actionPicker.on') }}
          </option>
          <option value="false">
            {{ t('actionPicker.off') }}
          </option>
        </select>
      </template>
      <select
        v-if="a.type === 'scene' && a.cmd === 'activate'"
        class="form-select form-select-sm"
        :aria-label="t('actionPicker.actionScene')"
        :value="a.sceneId ?? ''"
        @change="patch({ sceneId: ($event.target as HTMLSelectElement).value })"
      >
        <option
          value=""
          disabled
        >
          {{ t('actionPicker.selectScene') }}
        </option>
        <option
          v-for="scene in project.scenes"
          :key="scene.id"
          :value="scene.id"
        >
          {{ scene.name }}
        </option>
      </select>
      <select
        v-if="a.type === 'follow'"
        class="form-select form-select-sm"
        :aria-label="t('actionPicker.followActionMode')"
        :value="a.mode"
        @change="patch({ mode: ($event.target as HTMLSelectElement).value })"
      >
        <option
          v-for="mode in ['written', 'waitNotes', 'tempoTrack', 'cycle']"
          :key="mode"
          :value="mode"
        >
          {{ sentence(mode) }}
        </option>
      </select>
      <select
        v-if="a.type === 'cue' && a.cmd === 'fire'"
        class="form-select form-select-sm"
        :aria-label="t('actionPicker.actionCue')"
        :value="a.cueId ?? ''"
        @change="patch({ cueId: ($event.target as HTMLSelectElement).value })"
      >
        <option
          value=""
          disabled
        >
          {{ t('actionPicker.selectCue') }}
        </option>
        <option
          v-for="cue in project.cues"
          :key="cue.id"
          :value="cue.id"
        >
          {{ cue.name }}
        </option>
      </select>
      <template v-if="a.type === 'clip'">
        <input
          v-if="a.cmd === 'stopGroup'"
          class="form-control form-control-sm"
          :aria-label="t('actionPicker.clipGroup')"
          :placeholder="t('actionPicker.groupName')"
          :value="a.group ?? ''"
          @change="patch({ group: ($event.target as HTMLInputElement).value })"
        ><select
          v-else-if="a.cmd !== 'stopAll'"
          class="form-select form-select-sm"
          :aria-label="t('actionPicker.actionClip')"
          :value="a.clipId ?? ''"
          @change="
            patch({ clipId: ($event.target as HTMLSelectElement).value })
          "
        >
          <option
            value=""
            disabled
          >
            {{ t('actionPicker.selectClip') }}
          </option>
          <option
            v-for="clip in project.clips"
            :key="clip.id"
            :value="clip.id"
          >
            {{ clip.name }}
          </option>
        </select>
      </template>
      <input
        v-if="a.type === 'script'"
        class="form-control form-control-sm"
        :aria-label="t('actionPicker.scriptFunction')"
        :placeholder="t('actionPicker.functionName')"
        :value="a.fn"
        @change="patch({ fn: ($event.target as HTMLInputElement).value })"
      >
    </div>
  </div>
</template>
