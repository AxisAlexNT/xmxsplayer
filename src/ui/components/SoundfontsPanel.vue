<script setup lang="ts">
import SoundLibrary from './SoundLibrary.vue'
import { useI18n } from '../i18n'
const {t}=useI18n()
const managing=ref(false)
import { onMounted, ref } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { uniqueId } from '../../shared/ids'
import { syncProject } from '../../shared/project-sync'
import { engineBus } from '../bus'
const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
const available = ref<string[]>([])
const busy = ref(false)
async function refresh(): Promise<void> {
  available.value = (await window.xm.soundfonts.scan()).map((s) => s.file)
}
onMounted(() => {
  void refresh().catch(fail)
})
function fail(error: unknown): void {
  runtime.log({ level: 'error', source: 'soundfonts', message: String(error) })
}
async function add(): Promise<void> {
  busy.value = true
  try {
    const path = settings.value.soundfontCopyIntoProject ? await window.xm.project.importFile('soundfont') : undefined
    const picked = settings.value.soundfontCopyIntoProject ? (path ? {file:path.split('/').at(-1)!} : null) : await window.xm.soundfonts.pick()
    if (!picked) return
    if (!doc.project.soundfonts.some((sf) => sf.file === picked.file))
      doc.update((p) => {
        p.soundfonts.push({
          id: uniqueId(
            picked.file.replace(/\.sf[23]$/i, ''),
            p.soundfonts.map((s) => s.id),
          ),
          file: picked.file,
        })
      })
    await settings.load()
    await refresh()
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
async function locate(id: string, file: string): Promise<void> {
  busy.value = true
  try {
    const picked = await window.xm.soundfonts.resolve(file, true)
    if (!picked) return
    doc.update((p) => {
      p.soundfonts.find((sf) => sf.id === id)!.file = picked.file
    })
    await settings.load()
    await refresh()
    if (engineBus.value)
      syncProject(engineBus.value, doc.project, undefined, true)
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <div class="xm-list">
    <div
      v-for="sf in doc.project.soundfonts"
      :key="sf.id"
    >
      <i
        :class="
          available.includes(sf.file)
            ? 'bi bi-check-circle-fill xm-log-ok'
            : 'bi bi-exclamation-triangle-fill xm-log-warn'
        "
      />
      <span class="xm-sf-name">{{ sf.file }}</span>
      <button
        v-if="!available.includes(sf.file)"
        class="btn btn-sm btn-xm"
        :disabled="busy"
        @click="locate(sf.id, sf.file)"
      >
        {{ t('library.locate') }}
      </button>
    </div>
    <div
      v-if="!doc.project.soundfonts.length"
      class="xm-faint"
    >
      {{ t('library.noSoundfonts') }}
    </div>
  </div>
  <button
    class="btn btn-sm btn-ghost mt-2"
    :disabled="busy"
    @click="add"
  >
    <i class="bi bi-plus-lg" /> {{ t('library.addSoundfont') }}
  </button>
  <p class="xm-faint mt-2 mb-0">
    {{ t('library.soundfontsAreFoundByFileNameInYourSoundfontFolders') }}
  </p>
  <button
    class="btn btn-sm btn-xm"
    @click="managing=true"
  >
    {{ t('library.manage') }}
  </button>
  <SoundLibrary
    v-if="managing"
    @close="managing=false"
  />
</template>
