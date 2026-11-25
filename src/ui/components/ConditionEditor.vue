<script setup lang="ts">
import { t } from '../i18n'
import { computed } from 'vue'
import type { Condition, Project } from '../../shared/model'
const props = defineProps<{ modelValue?: Condition; project: Project }>(),
  emit = defineEmits<{ 'update:modelValue': [value: Condition | undefined] }>()
const kind = computed(() => {
  const c = props.modelValue
  return !c
    ? 'always'
    : 'reg' in c
      ? 'reg'
      : 'scene' in c
        ? 'scene'
        : 'bars' in c
          ? 'bars'
          : 'playing' in c
            ? 'playing'
            : 'all' in c
              ? 'all'
              : 'any' in c
                ? 'any'
                : 'not'
})
const children = computed(() => {
  const c = props.modelValue
  return (
    (c &&
      ('all' in c ? c.all : 'any' in c ? c.any : 'not' in c ? [c.not] : [])) ||
    []
  )
})
function choose(type: string): void {
  emit(
    'update:modelValue',
    type === 'always'
      ? undefined
      : type === 'reg'
        ? { reg: 0, on: true }
        : type === 'scene'
          ? { scene: props.project.scenes[0]?.id ?? '' }
          : type === 'bars'
            ? { bars: [1, 4] }
            : type === 'playing'
              ? { playing: true }
              : type === 'all'
                ? { all: [{ playing: true }] }
                : type === 'any'
                  ? { any: [{ playing: true }] }
                  : { not: { playing: true } },
  )
}
function child(index: number, value: Condition | undefined): void {
  const list = [...children.value]
  if (value) list[index] = value
  else list.splice(index, 1)
  emit(
    'update:modelValue',
    kind.value === 'not'
      ? { not: list[0] ?? { all: [] } }
      : kind.value === 'all'
        ? { all: list }
        : { any: list },
  )
}
</script>
<template>
  <div class="xm-condition-editor">
    <select
      class="form-select form-select-sm"
      :aria-label="t('conditionEditor.conditionType')"
      :value="kind"
      @change="choose(($event.target as HTMLSelectElement).value)"
    >
      <option value="always">
        {{ t('conditionEditor.always') }}
      </option>
      <option value="reg">
        {{ t('conditionEditor.register') }}
      </option>
      <option value="scene">
        {{ t('conditionEditor.scene') }}
      </option>
      <option value="bars">
        {{ t('conditionEditor.barRange') }}
      </option>
      <option value="playing">
        {{ t('conditionEditor.playingState') }}
      </option>
      <option value="all">
        {{ t('conditionEditor.allConditions') }}
      </option>
      <option value="any">
        {{ t('conditionEditor.anyCondition') }}
      </option>
      <option value="not">
        {{ t('conditionEditor.not') }}
      </option>
    </select>
    <div
      v-if="modelValue && 'reg' in modelValue"
      class="xm-row mt-2"
    >
      <select
        class="form-select form-select-sm"
        :aria-label="t('conditionEditor.conditionRegister')"
        :value="modelValue.reg"
        @change="
          emit('update:modelValue', {
            reg: Number(($event.target as HTMLSelectElement).value),
            on: !!(modelValue && 'on' in modelValue && modelValue.on),
          })
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
        class="form-select form-select-sm"
        :aria-label="t('conditionEditor.registerConditionState')"
        :value="String(modelValue.on)"
        @change="
          emit('update:modelValue', {
            reg: modelValue && 'reg' in modelValue ? modelValue.reg : 0,
            on: ($event.target as HTMLSelectElement).value === 'true',
          })
        "
      >
        <option value="true">
          {{ t('actionPicker.on') }}
        </option>
        <option value="false">
          {{ t('actionPicker.off') }}
        </option>
      </select>
    </div>
    <select
      v-else-if="modelValue && 'scene' in modelValue"
      class="form-select form-select-sm mt-2"
      :aria-label="t('conditionEditor.conditionScene')"
      :value="modelValue.scene"
      @change="
        emit('update:modelValue', {
          scene: ($event.target as HTMLSelectElement).value,
        })
      "
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
    <div
      v-else-if="modelValue && 'bars' in modelValue"
      class="xm-row mt-2"
    >
      <input
        class="form-control form-control-sm"
        type="number"
        min="1"
        :aria-label="t('conditionEditor.firstBar')"
        :value="modelValue.bars[0]"
        @change="
          emit('update:modelValue', {
            bars: [
              Number(($event.target as HTMLInputElement).value),
              modelValue && 'bars' in modelValue ? modelValue.bars[1] : 1,
            ],
          })
        "
      ><span>{{ t('clipEditor.to') }}</span><input
        class="form-control form-control-sm"
        type="number"
        min="1"
        :aria-label="t('conditionEditor.lastBar')"
        :value="modelValue.bars[1]"
        @change="
          emit('update:modelValue', {
            bars: [
              modelValue && 'bars' in modelValue ? modelValue.bars[0] : 1,
              Number(($event.target as HTMLInputElement).value),
            ],
          })
        "
      >
    </div>
    <select
      v-else-if="modelValue && 'playing' in modelValue"
      class="form-select form-select-sm mt-2"
      :aria-label="t('conditionEditor.playingCondition')"
      :value="String(modelValue.playing)"
      @change="
        emit('update:modelValue', {
          playing: ($event.target as HTMLSelectElement).value === 'true',
        })
      "
    >
      <option value="true">
        {{ t('conditionEditor.playing') }}
      </option>
      <option value="false">
        {{ t('conditionEditor.stopped') }}
      </option>
    </select>
    <div
      v-else-if="['all', 'any', 'not'].includes(kind)"
      class="xm-condition-children"
    >
      <ConditionEditor
        v-for="(condition, i) in children"
        :key="i"
        :model-value="condition"
        :project="project"
        @update:model-value="child(i, $event)"
      /><button
        v-if="kind !== 'not'"
        class="btn btn-sm btn-ghost"
        @click="child(children.length, { playing: true })"
      >
        {{ t('conditionEditor.addCondition') }}
      </button>
    </div>
  </div>
</template>
