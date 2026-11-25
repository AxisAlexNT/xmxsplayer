<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'
import { useScriptStore } from '../stores/script'
import { toFiles } from '../../shared/project-files'
import { newProject } from '../../shared/defaults'
import TutorialPicker from './TutorialPicker.vue'
import TourOverlay from './TourOverlay.vue'
import TourStart from './TourStart.vue'
import { advanceTour, startTour, type TourAction, type TourState } from './machine'
import type { Tour } from './tours'

defineProps<{ topic?: string }>()
const emit = defineEmits<{ close: []; error: [error: unknown] }>()
const doc = useProjectStore()
const settings = useSettingsStore()
const scripts = useScriptStore()
const selected = ref<Tour>()
const state = ref<TourState>()
const practice = ref(false)
const busy = ref(false)
const step = computed(() => selected.value?.steps[state.value?.index ?? 0])
const ended = computed(() => state.value?.phase === 'completed' || state.value?.phase === 'skipped')

async function start(copy: boolean) {
  if (busy.value || !selected.value) return
  busy.value = true
  try {
    if (copy) {
      if (doc.folder && (doc.dirtyFiles.length || scripts.dirty)) {
        if (!window.confirm(t('tutorial.saveOriginal'))) return
        await scripts.commit()
        await doc.save()
      }
      const snapshot = await window.xm.project.startPractice(doc.folder ? toFiles(doc.project) : null)
      doc.load(snapshot)
    }
    practice.value = copy
    const progress = settings.value.tutorials?.progress[selected.value.id]
    state.value = startTour(selected.value.steps.length, progress)
  } catch (error) { emit('error', error) }
  finally { busy.value = false }
}
async function act(action: TourAction) {
  if (!state.value || !selected.value || busy.value) return
  const previous = state.value
  const next = advanceTour(previous, action)
  if (next === previous) return
  state.value = next
  if (previous.index === next.index && !ended.value) return
  busy.value = true
  try {
    const id = selected.value.id
    const saved = settings.value.tutorials ?? { progress: {}, done: [], offered: false }
    const progress = { ...saved.progress, [id]: next.index }
    const done = new Set(saved.done)
    if (next.phase === 'completed') { delete progress[id]; done.add(id) }
    await settings.save({ ...settings.value, tutorials: { ...saved, progress, done: [...done] } })
  } catch (error) { emit('error', error) }
  finally { busy.value = false }
  if (ended.value && !practice.value) emit('close')
}
async function finish(keep: boolean) {
  if (busy.value) return
  busy.value = true
  try {
    const snapshot = keep
      ? await window.xm.project.keepPractice(toFiles({...doc.project, script: scripts.draft}))
      : await window.xm.project.discardPractice()
    if (keep && !snapshot) return
    doc.load(snapshot ?? {folder:'', files:toFiles(newProject()), hashes:{}})
    emit('close')
  } catch (error) { emit('error', error) }
  finally { busy.value = false }
}
</script>

<template>
  <TutorialPicker
    v-if="!selected"
    :topic="topic"
    @close="emit('close')"
    @choose="selected=$event"
  />
  <TourStart
    v-else-if="!state"
    :has-project="!!doc.folder"
    @start="start"
    @cancel="!busy && (selected=undefined)"
  />
  <TourOverlay
    v-else-if="step"
    :step="step"
    :state="state"
    :busy="busy"
    @action="act"
  >
    <template v-if="ended && practice">
      <strong>{{ t('tutorial.keepPrompt') }}</strong>
      <button
        :disabled="busy"
        @click="finish(true)"
      >
        {{ t('tutorial.keep') }}
      </button>
      <button
        :disabled="busy"
        @click="finish(false)"
      >
        {{ t('tutorial.discard') }}
      </button>
    </template>
    <template v-else-if="state.phase==='confirmExit'">
      <strong>{{ t('tutorial.exit') }}</strong>
      <button @click="act('resume')">
        {{ t('tutorial.resume') }}
      </button>
      <button @click="act('confirmExit')">
        {{ t('tutorial.skip') }}
      </button>
    </template>
    <template v-else-if="!ended">
      <small>{{ t('tutorial.stepCount',{step:state.index+1,total:state.count}) }}</small>
      <strong>{{ t(step.titleKey) }}</strong><p>{{ t(step.bodyKey) }}</p>
      <button
        :disabled="!state.index || busy"
        @click="act('back')"
      >
        {{ t('tutorial.back') }}
      </button>
      <button
        :disabled="busy"
        @click="act('next')"
      >
        {{ state.index+1===state.count ? t('tutorial.finish') : t('tutorial.next') }}
      </button>
      <button @click="act('requestExit')">
        {{ t('tutorial.skip') }}
      </button>
    </template>
  </TourOverlay>
</template>
<style scoped>
strong,small { display:block; margin-bottom:.4rem; }
button { margin-right:.35rem; }
</style>
