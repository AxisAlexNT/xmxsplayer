<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { addFont, removeFont, replaceFont } from '../../shared/soundfont-ops'
import type { SoundFontIndexEntry } from '../../shared/api'
import { useI18n } from '../i18n'
import { useProjectStore } from '../stores/project'
import { useSettingsStore } from '../stores/settings'
const emit = defineEmits<{ close: [] }>()
const doc = useProjectStore(),
  settings = useSettingsStore(),
  { t, number } = useI18n()
const dialog = ref<HTMLDialogElement>(),
  entries = shallowRef<SoundFontIndexEntry[]>([]),
  dirs = ref<string[]>([])
const scope = ref('project'),
  query = ref(''),
  busy = ref(false),
  message = ref(''),
  replacing = ref('')
const rows = computed(() => {
  const fonts = new Map(entries.value.map((entry) => [entry.file, entry]))
  const names = new Set([
    ...doc.project.soundfonts.map((f) => f.file),
    ...fonts.keys(),
  ])
  return [...names]
    .map((file) => ({
      file,
      entry: fonts.get(file),
      font: doc.project.soundfonts.find((f) => f.file === file),
    }))
    .filter(
      (r) =>
        r.file.toLowerCase().includes(query.value.toLowerCase()) &&
        (scope.value === 'project'
          ? r.font
          : scope.value === 'all'
            ? true
            : r.entry?.path.slice(0, -r.file.length - 1) === scope.value),
    )
})
async function refresh() {
  const [index, folders] = await Promise.all([
    window.xm.soundfonts.index(),
    window.xm.soundfonts.dirs.get(),
  ])
  entries.value = index
  dirs.value = folders
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    await action()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  dialog.value?.showModal()
  void run(refresh)
})
async function folders(next: string[]) {
  await window.xm.soundfonts.dirs.set(next)
  await settings.load()
  scope.value = 'all'
  await refresh()
}
async function chooseFolder() {
  const path = await window.xm.soundfonts.dirs.choose()
  if (path) await folders([...new Set([...dirs.value, path])])
}
const pending = shallowRef<SoundFontIndexEntry>()
async function loadFile() {
  const path = settings.value.soundfontCopyIntoProject
    ? await window.xm.project.importFile('soundfont')
    : (await window.xm.soundfonts.pick())?.file
  if (!path) return
  doc.update(() => addFont(doc.project, path.split('/').at(-1)!))
  await settings.load()
  await refresh()
}
async function choose(entry: SoundFontIndexEntry, confirmed = false) {
  const id = replacing.value
  if (id && !confirmed) {
    const old = doc.project.soundfonts.find((f) => f.id === id)
    const preview = replaceFont(
      doc.project,
      id,
      entry.file,
      entries.value.find((e) => e.file === old?.file)?.presets ?? [],
      entry.presets,
    )
    if (preview.unmatched.length) {
      const names = preview.unmatched.join(', ')
      message.value = t('library.unmatched', { names })
      pending.value = preview.matched ? entry : undefined
      return
    }
  }
  pending.value = undefined
  const folder = doc.folder
  const file = settings.value.soundfontCopyIntoProject
    ? await window.xm.soundfonts.copy(entry.file)
    : entry.file
  if (doc.folder !== folder) return
  if (id) {
    const old = doc.project.soundfonts.find((f) => f.id === id)
    const result = replaceFont(
      doc.project,
      id,
      file,
      entries.value.find((e) => e.file === old?.file)?.presets ?? [],
      entry.presets,
    )
    doc.update(() => result.project)
    if (result.unmatched.length) {
      const names = result.unmatched.join(', ')
      message.value = t('library.unmatched', { names })
    }
    replacing.value = ''
  } else doc.update(() => addFont(doc.project, file))
  await refresh()
}
async function locate(id: string, file: string) {
  const picked = await window.xm.soundfonts.resolve(file, true)
  if (!picked) return
  doc.update((d) => {
    const font = d.soundfonts.find((f) => f.id === id)
    if (font) font.file = picked.file
  })
  await settings.load()
  await refresh()
}
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-sound-library"
    @cancel="emit('close')"
  >
    <div class="xm-dialog-h">
      <h5>{{ t('library.title') }}</h5><input
        v-model="query"
        class="form-control"
        :placeholder="t('library.search')"
        :aria-label="t('library.search')"
      >
      <button
        class="btn btn-ghost"
        :aria-label="t('library.close')"
        @click="emit('close')"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-lib">
      <nav class="xm-lib-nav">
        <button
          :class="{'is-on':scope==='project'}"
          @click="scope='project'"
        >
          {{ t('library.project') }}
        </button>
        <button
          :class="{'is-on':scope==='all'}"
          @click="scope='all'"
        >
          {{ t('library.all') }}
        </button>
        <b>{{ t('library.folders') }}</b>
        <div
          v-for="dir in dirs"
          :key="dir"
          class="xm-row"
        >
          <button
            :title="dir"
            :class="{'is-on':scope===dir}"
            @click="scope=dir"
          >
            {{ dir }}
          </button>
          <button
            :disabled="busy"
            :aria-label="t('library.removeFolder',{dir})"
            @click="run(()=>folders(dirs.filter(d=>d!==dir)))"
          >
            <i class="bi bi-x" />
          </button>
        </div>
        <button
          :disabled="busy"
          @click="run(chooseFolder)"
        >
          {{ t('library.addFolder') }}
        </button>
        <button
          :disabled="busy"
          @click="run(refresh)"
        >
          {{ t('library.rescan') }}
        </button>
      </nav>
      <section>
        <label><input
          type="checkbox"
          :checked="settings.value.soundfontCopyIntoProject"
          @change="run(()=>settings.save({...settings.value,soundfontCopyIntoProject:!settings.value.soundfontCopyIntoProject}))"
        > {{ t('library.copy') }}</label>
        <p
          v-if="replacing"
          role="status"
        >
          {{ t('library.chooseReplacement') }} <button
            class="btn btn-ghost"
            :disabled="busy"
            @click="replacing='';pending=undefined;message=''"
          >
            {{ t('library.cancel') }}
          </button>
        </p>
        <p
          v-if="message"
          role="status"
        >
          {{ message }}
        </p>
        <p v-if="!rows.length && !busy">
          {{ t('library.empty') }}
        </p>
        <button
          v-if="pending && replacing"
          class="btn btn-primary"
          @click="run(()=>choose(pending!,true))"
        >
          {{ t('library.applyMatched') }}
        </button>
        <div
          v-if="rows.length"
          class="xm-sfrow is-head"
        >
          <span /><span>{{ t('library.font') }}</span><span>{{ t('library.kind') }}</span><span>{{ t('library.presets') }}</span><span>{{ t('library.bytes') }}</span><span />
        </div>
        <div
          v-for="row in rows"
          :key="row.file"
          class="xm-sfrow"
        >
          <i :class="row.font?'bi bi-check-circle':'bi bi-circle'" />
          <span><b>{{ row.file }}</b><small>{{ row.entry?.path??t('library.missing') }}</small></span>
          <span>{{ row.entry?.kind }}</span><span>{{ row.entry?.presets.length }}</span>
          <span>{{ row.entry?t('library.size',{size:number(Math.round(row.entry.bytes/1048576))}):'' }}</span>
          <span class="xm-row">
            <button
              v-if="row.entry && replacing && row.font?.id!==replacing"
              class="btn btn-sm btn-primary"
              :disabled="busy"
              @click="run(()=>choose(row.entry!))"
            >{{ t('library.use') }}</button>
            <template v-else-if="row.font">
              <button
                v-if="!row.entry"
                class="btn btn-sm btn-xm"
                :disabled="busy"
                @click="run(()=>locate(row.font!.id,row.file))"
              >{{ t('library.locate') }}</button>
              <button
                class="btn btn-sm btn-xm"
                :disabled="busy"
                @click="replacing=row.font.id;pending=undefined;message='';scope='all';query=''"
              >{{ t('library.replace') }}</button>
              <button
                class="btn btn-sm btn-ghost"
                :aria-label="t('library.remove')"
                @click="run(async()=>{doc.update(()=>removeFont(doc.project,row.font!.id))})"
              ><i class="bi bi-dash-circle" /></button>
            </template>
            <button
              v-else-if="row.entry"
              class="btn btn-sm btn-xm"
              :disabled="busy || !doc.folder"
              @click="run(()=>choose(row.entry!))"
            >{{ t('library.add') }}</button>
          </span>
        </div>
      </section>
    </div>
    <div class="xm-dialog-f">
      <button
        class="btn btn-xm"
        :disabled="busy||!doc.folder"
        @click="run(loadFile)"
      >
        {{ t('library.load') }}
      </button>
      <button
        class="btn btn-primary"
        @click="emit('close')"
      >
        {{ t('library.done') }}
      </button>
    </div>
  </dialog>
</template>
