import { mappable } from './bindings/map-mode'
import { TimeMap } from '../shared/time-map'
import { recordedLength, replaceRange } from '../shared/recording'
import { parameterPatch } from '../shared/parameters'
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
app.directive('mappable',mappable)
const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
window.xm.plugins.onState(event=>{
  if (event.status === 'stopped') return
  runtime.log({source:'plugins',level:event.status==='error'?'error':event.status==='ready'?'ok':'info',
    message:event.message ?? (event.status==='ready'?'Plugin host ready':'Applying plugin changes…')})
})
let synced: Project | undefined
let audioScope: string | undefined
function sync(force = false): void {
  const bus = engineBus.value
  if (!bus || !runtime.connected) return
  const p = doc.project
  if (p === synced && !force) return
  if (force || audioScope !== doc.folder) {
    bus.send('audio:scope', { folder: doc.folder })
    audioScope = doc.folder
    runtime.liveLengthTicks = 0
    runtime.liveTake = undefined
    runtime.clipErrors = {}
    runtime.clipAudition = { state: 'stopped', error: '' }
    runtime.audioPeaks = {}
    runtime.audioStates = {}
  }
  syncProject(bus, p, synced, force)
  synced = p
}
watch(engineBus, (bus) => {
  runtime.connected = false
  runtime.clipProgress = {}
  runtime.clipErrors = {}
  runtime.clipAudition = { state: 'stopped', error: '' }
  runtime.scriptStatus = { hash: '', state: 'empty' }
  runtime.activity = { trackIds: [], instrumentIds: [], routes: [] }
  runtime.controls = {}
  runtime.feedback = {}
  runtime.heldKeys = []
  runtime.readyInstruments = []
  runtime.synthLoading = false
  if (!bus) return
  bus.respond('audio:resolve', ({ file, sampleRate }) =>
    window.xm.project.audioSource(file, sampleRate),
  )
  bus.respond('audio:cache', async ({ file, key, data }) => {
    await window.xm.project.cachePeaks(file, key, data)
    return undefined
  })
  bus.on('grid:taps', (state) => {
    runtime.tapMap = state
  })
  bus.on('audio:peaks', (data) => {
    runtime.audioPeaks[data.trackId] = data
  })
  bus.on('audio:state', (data) => {
    runtime.audioStates[data.trackId] = data
  })
  bus.respond('soundfont:info',font=>window.xm.soundfonts.resolve(font.file))
  bus.respond(
    'soundfont:resolve',
    async (font) =>
      (await window.xm.soundfonts.resolve(font.file))?.url ?? null,
  )
  bus.on('synth:state', (value) => {
    runtime.synthLoading = value.loading
    runtime.readyInstruments = value.readyIds
  })
  bus.on('clip:error', ({ clipId, message }) => {
    runtime.clipErrors[clipId] = message
  })
  bus.on('clip:preview', (value) => {
    runtime.clipAudition = {
      state: value.state,
      error:
        value.error ??
        (value.state === 'stopped' ? runtime.clipAudition.error : ''),
    }
  })
  bus.on('clips:progress', (value) => {
    runtime.clipProgress = value
  })
  bus.on('script:status', (value) => {
    runtime.scriptStatus = value
  })
  bus.on('activity', (value) => {
    runtime.activity = value
  })
  bus.on('keys', (value) => {
    runtime.heldKeys = value.held
  })
  bus.on('feedback', (frame) => {
    runtime.feedback[frame.deviceId] = frame
  })
  bus.on('control', (value) => {
    runtime.controls[`${value.deviceId}|${value.controlId}`] = value
  })
  bus.on('midi:ports', (value) => {
    for (const key of Object.keys(runtime.controls))
      if (!value.devices.some((d) => key.startsWith(d.id + '|')))
        delete runtime.controls[key]
    for (const id of Object.keys(runtime.feedback))
      if (!value.devices.some((d) => d.id === id)) delete runtime.feedback[id]
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
  bus.on('param:change', ({ action, value, tick }) => {
    try {
      doc.update((draft) => {
        const patch = parameterPatch(draft, action, value,tick,settings.value.tempoMode)
        if (patch) Object.assign(draft, patch)
      })
    } catch (error) {
      runtime.log({
        level: 'error',
        source: 'parameter',
        message: String(error),
      })
    }
  })
  bus.on('doc:patch', (patch) => {
    try {
      doc.update((draft) => {
        Object.assign(draft, patch)
      })
    } catch (error) {
      runtime.log({ level: 'error', source: 'engine', message: String(error) })
    }
  })
  bus.on('record:extend', ({lengthTicks}) => { runtime.liveLengthTicks = lengthTicks })
  bus.on('record:progress', frame => {
    if (frame.scope === doc.folder) runtime.liveTake = frame
  })
  bus.on('recorded', (value) => {
    try {
      if ('tracks' in value && value.scope !== doc.folder) return
      const tracks =
        'tracks' in value ? value.tracks : [{ ...value, events: [] }]
      doc.update((d) => {
        for (const data of tracks) {
          const track = d.tracks.find((t) => t.id === data.trackId)
          if (track?.kind !== 'midi') continue
          const kept =
            'mode' in value && value.mode === 'replace' && data.covered
              ? replaceRange(track.notes, track.events, data.covered)
              : track
          track.notes = [...kept.notes, ...data.notes].sort(
            (a, b) => a[0] - b[0] || a[2] - b[2],
          )
          track.events = [...kept.events, ...data.events].sort(
            (a, b) => a.tick - b.tick,
          )
          if (track.link) track.link.state = 'ahead'
          if (!d.loop.enabled) d.lengthTicks = recordedLength(d.lengthTicks, data.notes, new TimeMap(d))
        }
      })
      runtime.liveLengthTicks = 0
      runtime.liveTake = undefined
      runtime.lastTake = tracks.map((t) => ({
        trackId: t.trackId,
        notes: t.notes,
      }))
      runtime.log({
        level: 'ok',
        source: 'recording',
        message: `Recorded ${tracks.reduce((n, t) => n + t.notes.length, 0)} notes`,
      })
    } catch (error) {
      runtime.log({
        level: 'error',
        source: 'recording',
        message: String(error),
      })
    }
  })
  bus.on('transport', (value) => {
    if (!value.recording) {
      runtime.liveTake = undefined
      runtime.liveLengthTicks = 0
    }
    runtime.transport = value
  })
  bus.on('runtime', (value) => {
    for (const [id, state] of Object.entries(value.clips))
      if (state !== 'stopped') delete runtime.clipErrors[id]
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
