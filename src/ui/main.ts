import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles/tokens.css'
import './styles/xm.css'
import './styles/theme.scss'
import App from './App.vue'
import { engineBus } from './bus'
import { useRuntimeStore } from './stores/runtime'
import { useSettingsStore } from './stores/settings'

const app = createApp(App)
app.use(createPinia())
const runtime = useRuntimeStore()
const settings = useSettingsStore()
watch(engineBus, (bus) => {
  runtime.connected = false
  if (!bus) return
  bus.on('ready', () => {
    runtime.connected = true
    bus.send('settings:set', settings.value)
    runtime.log({ level: 'ok', source: 'engine', message: 'Engine connected' })
    window.xm.app.engineReady()
  })
  bus.on('log', (entry) => runtime.log(entry))
  bus.on('transport', (value) => {
    runtime.transport = value
  })
  bus.on('runtime', (value) => {
    runtime.state = value
  })
  bus.send('ping', undefined)
})
watch(
  () => settings.value,
  (value) => {
    if (runtime.connected) engineBus.value?.send('settings:set', value)
  },
)
void settings
  .load()
  .catch((error) =>
    runtime.log({ level: 'error', source: 'settings', message: String(error) }),
  )
app.mount('#app')
