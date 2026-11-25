<script setup lang="ts">
import { computed, watch, onBeforeUnmount } from 'vue'
import type { MidiTrack } from '../../shared/model'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useEditorStore } from '../stores/editor'
import { useRuntimeStore } from '../stores/runtime'
import { noteName } from '../../shared/schema'
import { staffSettings } from './voicing'
const { t } = useI18n()
const props = defineProps<{ track: MidiTrack }>()
const doc = useProjectStore()
const editor = useEditorStore()
const runtime = useRuntimeStore()
const picking = computed(() => editor.splitPickTrack === props.track.id)
function cancelPick() {
  if (picking.value) editor.splitPickTrack = null
}
onBeforeUnmount(cancelPick)
watch(() => runtime.heldKeys, (keys, previous) => {
  if (!picking.value) return
  const pressed = keys.find(n => !previous.some(old => old.key === n.key))
  if (pressed) change({split:pressed.key})
})
const settings = computed(() => staffSettings(props.track, doc.project))
function change(patch: Partial<NonNullable<MidiTrack['staff']>>) {
  cancelPick()
  doc.update((d) => {
    const track = d.tracks.find((tr) => tr.id === props.track.id)
    if (track?.kind === 'midi') track.staff = { ...settings.value, ...patch }
  })
}
</script>
<template>
  <div
    class="xm-staff-controls"
    @pointerdown.stop
  >
    <div
      class="xm-seg"
      :aria-label="t('staff.layout')"
      role="group"
    >
      <button
        :aria-pressed="settings.mode === 'single'"
        :class="{ 'is-on': settings.mode === 'single' }"
        @click="change({ mode: 'single' })"
      >
        {{ t('staff.single') }}
      </button>
      <button
        :aria-pressed="settings.mode === 'grand'"
        :class="{ 'is-on': settings.mode === 'grand' }"
        @click="change({ mode: 'grand' })"
      >
        {{ t('staff.grand') }}
      </button>
    </div>
    <template v-if="settings.mode === 'grand'">
      <span>{{ t('staff.hands') }}</span>
      <div
        class="xm-seg"
        role="group"
        :aria-label="t('staff.splitKey')"
      >
        <button
          :class="{'is-on':settings.split==='auto'}"
          @click="change({split:'auto'})"
        >
          {{ t('staff.auto') }}
        </button>
        <button
          :class="{'is-on':settings.split===60}"
          @click="change({split:60})"
        >
          {{ t('staff.middleC') }}
        </button>
        <button
          :aria-pressed="picking"
          :class="{'is-on':picking || (settings.split!=='auto' && settings.split!==60)}"
          @click="editor.splitPickTrack=picking?null:track.id"
        >
          {{ picking ? t('staff.pressKey') : typeof settings.split==='number' && settings.split!==60 ? noteName(settings.split) : t('staff.pick') }}
        </button>
      </div>
    </template>
    <label><input
             type="checkbox"
             :checked="settings.voices === 2"
             @change="change({ voices: settings.voices === 2 ? 1 : 2 })"
           >
      {{ t('staff.twoVoices') }}</label>
    <label><input
             type="checkbox"
             :checked="settings.pedal"
             @change="change({ pedal: !settings.pedal })"
           >
      {{ t('staff.pedal') }}</label>
  </div>
</template>
