import { syncProject } from '../shared/project-sync'
import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles/tokens.css'
import './styles/xm.css'
import './styles/theme.scss'
import App from './App.vue'
import { engineBus } from './bus'
import { useProjectStore } from './stores/project'
import { useRuntimeStore } from './stores/runtime'
import { useSettingsStore } from './stores/settings'
import type { Project } from '../shared/model'

const app = createApp(App)
app.use(createPinia())
const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
let synced: Project | undefined
function sync(force = false): void {
  const bus = engineBus.value
  if (!bus || !runtime.connected) return
  const p = doc.project
  if (p === synced && !force) return
  syncProject(bus, p, synced, force)
  synced = p
}
watch(engineBus, (bus) => {
  runtime.connected = false
  runtime.heldKeys = []
  runtime.readyInstruments = []
  runtime.synthLoading = false
  if (!bus) return
  bus.respond(
    'soundfont:resolve',
    async (font) =>
      (await window.xm.soundfonts.resolve(font.file))?.url ?? null,
  )
  bus.on('synth:state', (value) => {
    runtime.synthLoading = value.loading
    runtime.readyInstruments = value.readyIds
  })
  bus.on('keys', (value) => {
    runtime.heldKeys = value.held
  })
  bus.on('midi:ports', (value) => {
    runtime.midi = value
  })
  bus.on('latency', (value) => {
    runtime.latency = value
  })
  bus.on('ready', () => {
    runtime.connected = true
    sync(true)
    runtime.log({ level: 'ok', source: 'engine', message: 'Engine connected' })
    window.xm.app.engineReady()
  })
  bus.on('log', (entry) => runtime.log(entry))
  bus.on('doc:patch', (patch) => {
    try {
      doc.update((draft) => {
        Object.assign(draft, patch)
      })
    } catch (error) {
      runtime.log({ level: 'error', source: 'engine', message: String(error) })
    }
  })
  bus.on('transport', (value) => {
    runtime.transport = value
  })
  bus.on('runtime', (value) => {
    runtime.state = value
  })
  void settingsReady.then(() => {
    bus.send('settings:set', settings.value)
    bus.send('ping', undefined)
  })
})
watch(
  () => doc.project,
  () => sync(),
)
watch(
  () => settings.value,
  (value) => {
    if (runtime.connected) engineBus.value?.send('settings:set', value)
  },
)
const settingsReady = settings
  .load()
  .catch((error) =>
    runtime.log({ level: 'error', source: 'settings', message: String(error) }),
  )
void window.xm.project
  .restore()
  .then((snapshot) => {
    if (snapshot) doc.load(snapshot)
  })
  .catch((error) =>
    runtime.log({ level: 'error', source: 'files', message: String(error) }),
  )
app.mount('#app')
