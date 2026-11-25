<script setup lang="ts">
import { effectOwners } from '../../shared/effect-targets'
import { effectParameters } from '../../shared/effects'
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
    : a.value.type === 'scene'
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
      : type === 'scene'
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
  (owner.effects ?? []).flatMap(effect => Object.entries(effectParameters[effect.type]).map(([param, spec]) => ({
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
function target(target: ParamTarget): void {
  if (target === 'effect.param') return selectEffect(0)
  const instrument = target.startsWith('instrument.'),
    track = target.startsWith('track.') || target.startsWith('audio.'),
    id = instrument
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
      target === 'rate'
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
  'effect.param',
  'track.volume',
  'track.pan',
  'instrument.volume',
  'instrument.reverb',
  'instrument.chorus',
  'audio.semitones',
  'audio.filterFreq',
]
</script>
<template>
  <label v-if="a.type==='orchestra' && a.cmd==='select'">Orchestra <select
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
        <label class="form-label">Action</label><select
          class="form-select form-select-sm"
          aria-label="Action type"
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
            Unbound
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
        <label class="form-label">Command</label><select
          class="form-select form-select-sm"
          aria-label="Action command"
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
      <template v-if="a.type === 'param'">
        <label class="form-label">Parameter</label><select
          class="form-select form-select-sm"
          aria-label="Parameter target"
          :value="a.target"
          @change="
            target(($event.target as HTMLSelectElement).value as ParamTarget)
          "
        >
          <option
            v-for="targetName in targets"
            :key="targetName"
            :disabled="targetName==='effect.param' && !effectChoices.length"
            :value="targetName"
          >
            {{ sentence(targetName) }}
          </option>
        </select>
        <label
          v-if="a.target==='effect.param'"
          class="form-label mt-2"
        >Effect parameter
          <select
            class="form-select form-select-sm"
            aria-label="Effect parameter"
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
          v-if="a.target.startsWith('instrument.')"
          class="form-label mt-2"
        >Instrument<select
          class="form-select form-select-sm"
          aria-label="Parameter instrument"
          :value="a.id ?? ''"
          @change="patch({ id: ($event.target as HTMLSelectElement).value })"
        >
          <option
            value=""
            disabled
          >Select instrument</option>
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
        >Track<select
          class="form-select form-select-sm"
          aria-label="Parameter track"
          :value="a.id ?? ''"
          @change="
            patch({
              id: ($event.target as HTMLSelectElement).value || undefined,
            })
          "
        >
          <option value="">By fader order</option>
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
          <label class="form-label">Minimum<input
            class="form-control form-control-sm"
            type="number"
            aria-label="Parameter minimum"
            :value="a.min"
            @change="
              patch({
                min: Number(($event.target as HTMLInputElement).value),
              })
            "
          ></label><label class="form-label">Maximum<input
            class="form-control form-control-sm"
            type="number"
            aria-label="Parameter maximum"
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
        <label class="form-label">Track<select
          class="form-select form-select-sm"
          aria-label="Action track"
          :value="a.trackId"
          @change="
            patch({ trackId: ($event.target as HTMLSelectElement).value })
          "
        >
          <option
            value=""
            disabled
          >Select track</option>
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
            <label class="form-label">MIDI key<input
              class="form-control form-control-sm"
              type="number"
              min="0"
              max="127"
              aria-label="Note key"
              :value="a.key"
              @change="
                patch({
                  key: Number(($event.target as HTMLInputElement).value),
                })
              "
            ></label><label class="form-label">Velocity<select
              class="form-select form-select-sm"
              aria-label="Note velocity source"
              :value="a.velocity === 'control' ? 'control' : 'fixed'"
              @change="
                patch({
                  velocity:
                    ($event.target as HTMLSelectElement).value === 'control'
                      ? 'control'
                      : 100,
                })
              "
            >
              <option value="control">Control</option>
              <option value="fixed">Fixed</option>
            </select></label><input
              v-if="a.velocity !== 'control'"
              class="form-control form-control-sm"
              type="number"
              min="1"
              max="127"
              aria-label="Note velocity"
              :value="a.velocity"
              @change="
                patch({
                  velocity: Number(($event.target as HTMLInputElement).value),
                })
              "
            >
          </div>
        </template><select
          v-else
          class="form-select form-select-sm mt-2"
          aria-label="Track mode action"
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
          aria-label="Action register"
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
          aria-label="Register action state"
          :value="String(a.on ?? true)"
          @change="
            patch({ on: ($event.target as HTMLSelectElement).value === 'true' })
          "
        >
          <option value="true">
            On
          </option>
          <option value="false">
            Off
          </option>
        </select>
      </template>
      <select
        v-if="a.type === 'scene' && a.cmd === 'activate'"
        class="form-select form-select-sm"
        aria-label="Action scene"
        :value="a.sceneId ?? ''"
        @change="patch({ sceneId: ($event.target as HTMLSelectElement).value })"
      >
        <option
          value=""
          disabled
        >
          Select scene
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
        aria-label="Follow action mode"
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
        aria-label="Action cue"
        :value="a.cueId ?? ''"
        @change="patch({ cueId: ($event.target as HTMLSelectElement).value })"
      >
        <option
          value=""
          disabled
        >
          Select cue
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
          aria-label="Clip group"
          placeholder="Group name"
          :value="a.group ?? ''"
          @change="patch({ group: ($event.target as HTMLInputElement).value })"
        ><select
          v-else-if="a.cmd !== 'stopAll'"
          class="form-select form-select-sm"
          aria-label="Action clip"
          :value="a.clipId ?? ''"
          @change="
            patch({ clipId: ($event.target as HTMLSelectElement).value })
          "
        >
          <option
            value=""
            disabled
          >
            Select clip
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
        aria-label="Script function"
        placeholder="Function name"
        :value="a.fn"
        @change="patch({ fn: ($event.target as HTMLInputElement).value })"
      >
    </div>
  </div>
</template>
