<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, ref, shallowRef } from 'vue'
import {
  pluginKey,
  type DiscoveredPlugin,
  type PluginRef,
} from '../../shared/plugins'
import { useSettingsStore } from '../stores/settings'
const props = defineProps<{ instrument: boolean }>()
const emit = defineEmits<{ choose: [plugin: PluginRef]; close: [] }>()
const dialog = ref<HTMLDialogElement>(),
  list = shallowRef<DiscoveredPlugin[]>([]),
  standalone = ref<string[]>([]),
  search = ref(''),
  busy = ref(false),
  error = ref(''),
  host = ref('')
const settings = useSettingsStore(),
  path = ref(settings.value.carlaPath ?? '')
const rows = computed(() =>
  list.value.filter(
    (p) =>
      p.instrument === props.instrument &&
      (p.name + ' ' + p.format + ' ' + p.maker)
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
)
const wanted = computed(() =>
  props.instrument
    ? [
        'Hydrogen',
        'Surge XT',
        'Vitalium',
        'ZynAddSubFX',
        'Helm',
        'Geonkick',
        'sfizz',
        'DrumGizmo',
      ]
    : ['LSP', 'Dragonfly', 'x42', 'Calf'],
)
const missing = computed(() =>
  wanted.value.filter(
    (n) =>
      !list.value.some(
        (p) =>
          p.instrument === props.instrument &&
          (p.name + ' ' + p.maker + ' ' + p.file)
            .toLowerCase()
            .includes(n.toLowerCase()),
      ),
  ),
)
async function scan(force = false) {
  busy.value = true
  error.value = ''
  try {
    host.value = await window.xm.plugins.detect().catch((e) => {
      error.value = String(e)
      return ''
    })
    const result = await window.xm.plugins.scan(force)
    standalone.value = result.standalone
    list.value = result.plugins
    if (result.errors.length) error.value = result.errors.slice(0, 3).join('\n')
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function select(plugin: DiscoveredPlugin) {
  try {
    const ports = await window.xm.plugins.ports(plugin.format, plugin.uri)
    emit('choose', {
      name: plugin.name,
      uri: plugin.uri,
      format: plugin.format,
      hasSidechain: ports?.sidechains ? ports.sidechains.length > 0 : undefined,
      parameters: ports?.parameters.filter((p) => p.input),
    })
  } catch (e) {
    error.value = String(e)
  }
}
async function applyPath() {
  await settings.save({ ...settings.value, carlaPath: path.value.trim() })
  await scan()
}
onMounted(() => {
  dialog.value?.showModal()
  void scan()
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-plugin-browser"
    :aria-label="t('pluginBrowser.plugins')"
    @cancel.prevent="emit('close')"
  >
    <div class="xm-dialog-h">
      <h5>{{ instrument ? 'Plugin instruments' : 'Plugin effects' }}</h5>
      <input
        v-model="search"
        type="search"
        class="form-control"
        :placeholder="t('pluginBrowser.searchPlugins')"
        :aria-label="t('pluginBrowser.searchPlugins')"
      >
    </div>
    <div class="xm-dialog-b">
      <p
        v-if="busy"
        role="status"
      >
        {{ t('pluginBrowser.scanningInstalledPlugins') }}
      </p>
      <template v-else>
        <button
          v-for="p in rows"
          :key="pluginKey(p)"
          class="xm-list-button"
          @click="select(p)"
        >
          <strong>{{ p.name }}</strong> · {{ p.format.toUpperCase() }} {{ t('pluginBrowser.installed') }}
        </button>
        <p v-if="!rows.length">
          {{ t('pluginBrowser.noMatchingInstalledPlugins') }}
        </p>
        <div
          v-for="n in missing.filter((n) =>
            n.toLowerCase().includes(search.toLowerCase()),
          )"
          :key="n"
          class="xm-faint"
        >
          {{ n }} · {{ standalone.includes(n) ? 'App only · Use External MIDI' : 'Not found' }}
        </div>
      </template>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
    <div class="xm-dialog-f">
      <details>
        <summary>{{ t('pluginBrowser.pluginHost') }} {{ host }}</summary>
        <label>{{ t('pluginBrowser.carlaExecutable') }}<input
          v-model="path"
          :placeholder="t('pluginBrowser.findAutomatically')"
        ></label><button @click="applyPath">
          {{ t('library.detect') }}
        </button>
      </details>
      <button
        class="btn btn-xm"
        :disabled="busy"
        @click="scan(true)"
      >
        {{ t('library.rescan') }}
      </button><button
        class="btn btn-primary"
        @click="emit('close')"
      >
        {{ t('pluginBrowser.close') }}
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.xm-plugin-browser {
  width: min(650px, 92vw);
}
.xm-plugin-browser .xm-dialog-b {
  max-height: 55vh;
  overflow: auto;
}
.xm-plugin-browser .xm-list-button {
  display: block;
  width: 100%;
  text-align: left;
}
</style>
