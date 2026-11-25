<script setup lang="ts">
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
    aria-label="Plugins"
    @cancel.prevent="emit('close')"
  >
    <div class="xm-dialog-h">
      <h5>{{ instrument ? 'Plugin instruments' : 'Plugin effects' }}</h5>
      <input
        v-model="search"
        type="search"
        class="form-control"
        placeholder="Search plugins"
        aria-label="Search plugins"
      >
    </div>
    <div class="xm-dialog-b">
      <p
        v-if="busy"
        role="status"
      >
        Scanning installed plugins…
      </p>
      <template v-else>
        <button
          v-for="p in rows"
          :key="pluginKey(p)"
          class="xm-list-button"
          @click="select(p)"
        >
          <strong>{{ p.name }}</strong> · {{ p.format.toUpperCase() }} ·
          Installed
        </button>
        <p v-if="!rows.length">
          No matching installed plugins.
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
        <summary>Plugin host {{ host }}</summary>
        <label>Carla executable<input
          v-model="path"
          placeholder="Find automatically"
        ></label><button @click="applyPath">
          Detect
        </button>
      </details>
      <button
        class="btn btn-xm"
        :disabled="busy"
        @click="scan(true)"
      >
        Rescan
      </button><button
        class="btn btn-primary"
        @click="emit('close')"
      >
        Close
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
