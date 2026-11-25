<script setup lang="ts">
import { useI18n } from './i18n'
const { t } = useI18n()
import TempoPopover from './components/TempoPopover.vue'
import SourcesPanel from './components/SourcesPanel.vue'
import { useSourcesStore } from './stores/sources'
import FollowControl from './components/FollowControl.vue'
import ClipsPanel from './components/ClipsPanel.vue'
import ScriptPanel from './components/ScriptPanel.vue'
import ScriptTrust from './components/ScriptTrust.vue'
import { useScriptStore } from './stores/script'
import SignalFlowPanel from './components/SignalFlowPanel.vue'
import type { FlowSelection } from './flow/model'
import { usePerformanceStore } from './stores/performance'
import PatchPanel from './components/PatchPanel.vue'
import ScenesPanel from './components/ScenesPanel.vue'
import OrchestraPanel from './components/OrchestraPanel.vue'
import RegistersPanel from './components/RegistersPanel.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from './stores/project'
import { useRuntimeStore } from './stores/runtime'
import { useEditorStore } from './stores/editor'
import { useSettingsStore } from './stores/settings'
import { importedAudio } from './sources/import-audio'
import { audioFormats, audioExtension } from '../shared/audio'
import { importMidi } from './sources/import-midi'
import { engineBus } from './bus'
import KeyboardStrip from './components/KeyboardStrip.vue'
import SoundfontsPanel from './components/SoundfontsPanel.vue'
import InstrumentPicker from './components/InstrumentPicker.vue'
import AudioSettings from './components/AudioSettings.vue'
import DevicesPanel from './components/DevicesPanel.vue'
import ControlsPanel from './components/ControlsPanel.vue'
import Timeline from './timeline/Timeline.vue'
import { appendBars, deleteBars, insertBars } from '../shared/bar-edit'
import { TimeMap } from '../shared/time-map'
import type { Action } from '../shared/model'

const patchPanels = ref<InstanceType<typeof PatchPanel>[]>([])
const controlPanels = ref<InstanceType<typeof ControlsPanel>[]>([])
const keyboardStrip = ref<InstanceType<typeof KeyboardStrip>>()
const rig = usePerformanceStore()
const scripts = useScriptStore()
const scriptPanels = ref<InstanceType<typeof ScriptPanel>[]>([])
async function flowSelect(
  selection: FlowSelection,
  anchor: { right: number; top: number },
): Promise<void> {
  if (selection.kind === 'instrument') {
    pickerId.value = selection.id
    return
  }
  if (selection.kind === 'output') {
    if (selection.instrumentId) pickerId.value = selection.instrumentId
    else showAudio.value = true
    return
  }
  if (selection.kind === 'zone') {
    rig.editScene = true
    await nextTick()
    keyboardStrip.value?.openZone(selection.id, anchor)
    return
  }
  if (selection.kind === 'track') {
    const track = doc.project.tracks.find((t) => t.id === selection.id)
    if (!track) return
    if (track.kind === 'midi') editor.activate(track.id)
    else runtime.selectedAudioId = track.id
    const header = [
      ...document.querySelectorAll<HTMLElement>('[data-track-id]'),
    ].find((el) => el.dataset.trackId === track.id)
    header?.scrollIntoView({ block: 'nearest' })
    header
      ?.querySelector<HTMLInputElement>('.xm-track-name')
      ?.focus({ preventScroll: true })
    return
  }
  if (selection.kind === 'keyboard') {
    document
      .querySelector<SVGElement>('[aria-label="Playable keyboard"] [data-key]')
      ?.focus()
    return
  }
  if (selection.kind === 'cues') {
    document
      .querySelector<HTMLButtonElement>('[aria-label="Add cue at playhead"]')
      ?.focus()
    return
  }
  const section =
    selection.kind === 'control'
      ? 'Controls'
      : selection.kind === 'device'
        ? 'Devices'
        : 'Script'
  settings.sections[section] = true
  await nextTick()
  const pane = [...document.querySelectorAll<HTMLElement>('.xm-sec')].find(
    (el) => el.querySelector('h6')?.textContent?.trim() === section,
  )
  pane?.scrollIntoView({ block: 'nearest' })
  if (selection.kind === 'control')
    await controlPanels.value[0]?.selectControl(
      selection.deviceId,
      selection.controlId,
      anchor,
    )
  else if (selection.kind === 'script') scriptPanels.value[0]?.focus()
  else if (selection.kind === 'device') {
    const device = runtime.midi.devices.find((d) => d.id === selection.id)
    pane?.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
      if (el.getAttribute('aria-label') === `${device?.name} profile`)
        el.focus({ preventScroll: true })
    })
  }
}
async function flowPatch(
  id: string,
  anchor: { right: number; top: number },
): Promise<void> {
  rig.editScene = true
  await editPatch(id, anchor)
}
async function editPatch(
  id: string,
  anchor: { right: number; top: number },
): Promise<void> {
  settings.sections.Patch = true
  await nextTick()
  patchPanels.value[0]?.open(id, anchor)
}
const sources = useSourcesStore()
sources.init()
watch(
  () => sources.notice,
  (n) => {
    if (n) notify(n.text)
  },
)
const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
const editor = useEditorStore()
watch(
  () => editor.notice,
  (value) => {
    if (value) notify(value.text)
  },
)
const toast = ref('')
const pickerId = ref<string | null>(null)
const showAudio = ref(false)
let toastTimer: ReturnType<typeof setTimeout>
const sections = [
  'Scenes',
  'Registers',
  'Orchestra',
  'Patch',
  'Clips',
  'Controls',
  'Signal flow',
  'Devices',
  'Soundfonts',
  'Sources',
  'Script',
  'Log',
]
const p = computed(() => doc.project)
const timeMap = computed(() => new TimeMap(p.value))
const position = computed(() =>
  timeMap.value.tickToBarBeat(runtime.transport.tick),
)
const elapsed = computed(() => {
  const seconds = timeMap.value.tickToSec(runtime.transport.tick)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
})
const keyName = computed(() => {
  const key = timeMap.value.keyAt(runtime.transport.tick)
  const major = [
    'C♭',
    'G♭',
    'D♭',
    'A♭',
    'E♭',
    'B♭',
    'F',
    'C',
    'G',
    'D',
    'A',
    'E',
    'B',
    'F♯',
    'C♯',
  ]
  const minor = [
    'A♭',
    'E♭',
    'B♭',
    'F',
    'C',
    'G',
    'D',
    'A',
    'E',
    'B',
    'F♯',
    'C♯',
    'G♯',
    'D♯',
    'A♯',
  ]
  return (key.minor ? minor : major)[key.fifths + 7] + (key.minor ? 'm' : '')
})
const transportButtons = computed(
  () =>
    [
      { icon: 'skip-start-fill', title: 'To start', cmd: 'toStart' },
      { icon: 'rewind-fill', title: 'Back one bar', cmd: 'rewind' },
      {
        icon: runtime.transport.playing ? 'pause-fill' : 'play-fill',
        title: 'Play / pause',
        cmd: 'toggle',
      },
      { icon: 'stop-fill', title: 'Stop · press twice to return', cmd: 'stop' },
      { icon: 'record-fill', title: 'Record', cmd: 'record' },
      { icon: 'fast-forward-fill', title: 'Forward one bar', cmd: 'forward' },
      { icon: 'arrow-repeat', title: 'Loop', cmd: 'loopToggle' },
      { icon: 'bell', title: 'Metronome', cmd: 'metronome' },
    ] as const,
)
function transport(
  cmd: Extract<Action, { type: 'transport' }>['cmd'],
  value?: number,
): void {
  engineBus.value?.send('action:run', {
    action: { type: 'transport', cmd },
    value,
  })
}
function setFollowView(mode: 'page' | 'center'): void {
  doc.update((d) => {
    d.view.follow = mode
  })
  editor.followRevision++
}
function laneZoom(factor: number): void {
  doc.update((d) => {
    d.view.laneZoom = Math.max(0.5, Math.min(3, d.view.laneZoom * factor))
  })
}
let repeatTimer: ReturnType<typeof setTimeout> | undefined
function repeat(event: PointerEvent, cmd: string): void {
  if (event.button !== 0 || (cmd !== 'rewind' && cmd !== 'forward')) return
  const button = event.currentTarget as HTMLElement
  button.setPointerCapture(event.pointerId)
  let count = 0
  transport(cmd)
  const again = (): void => {
    transport(cmd, Math.min(8, 1 + Math.floor(count++ / 5)))
    repeatTimer = setTimeout(again, Math.max(60, 200 - count * 8))
  }
  repeatTimer = setTimeout(again, 400)
  const stop = (): void => {
    clearTimeout(repeatTimer)
    button.removeEventListener('pointerup', stop)
    button.removeEventListener('pointercancel', stop)
    button.removeEventListener('lostpointercapture', stop)
  }
  button.addEventListener('pointerup', stop)
  button.addEventListener('pointercancel', stop)
  button.addEventListener('lostpointercapture', stop)
}
function shortcut(event: KeyboardEvent): void {
  if (
    event.defaultPrevented ||
    event.repeat ||
    document.querySelector('[role="dialog"]') ||
    (event.target as HTMLElement).closest(
      'input,textarea,select,[contenteditable="true"]',
    )
  )
    return
  if (editor.keydown(event)) return
  const key = event.key.toLowerCase()
  let cmd: Extract<Action, { type: 'transport' }>['cmd'] | undefined
  if (event.ctrlKey || event.metaKey) {
    if (key === '+' || key === '=') {
      event.preventDefault()
      laneZoom(1.1)
    } else if (key === '-') {
      event.preventDefault()
      laneZoom(1 / 1.1)
    }
    return
  }
  if (
    (key === ' ' || key === 'enter' || key === 'tab') &&
    (event.target as HTMLElement).closest('button')
  )
    return
  if (key === ' ') cmd = 'toggle'
  else if (key === 'enter') cmd = 'stop'
  else if (key === 'r') cmd = event.shiftKey ? 'recordMode' : 'record'
  else if (key === 'l') cmd = 'loopToggle'
  else if (key === '[') cmd = 'loopStartHere'
  else if (key === ']') cmd = 'loopEndHere'
  if (cmd) {
    event.preventDefault()
    transport(cmd)
  } else if (/^[1-8]$/.test(key)) {
    event.preventDefault()
    engineBus.value?.send('action:run', {
      action: { type: 'register', cmd: 'toggle', index: Number(key) - 1 },
    })
  } else if (key === 'f') {
    event.preventDefault()
    void command('toggleFollowView')
  } else if (key === 'tab') {
    event.preventDefault()
    void command('toggleLanes')
  }
}
const stopActions = watch(
  engineBus,
  (bus, _old, onCleanup) => {
    if (bus)
      onCleanup(
        bus.on('app', ({ cmd }) => {
          void command(cmd)
        }),
      )
  },
  { immediate: true },
)
function notify(message: string): void {
  toast.value = message
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 4000)
}
async function addAudio(file: string): Promise<void> {
  if (!engineBus.value || !runtime.connected)
    throw Error('Wait for the audio engine to connect')
  if (!audioFormats.has(audioExtension(file)))
    throw Error(`${file}: choose WAV, MP3, OGG, FLAC or M4A audio`)
  notify(`Loading ${file.split('/').at(-1)}…`)
  clearTimeout(toastTimer)
  const folder = doc.folder
  const draft = importedAudio(doc.project, file, 0)
  const loaded = await engineBus.value
    .request('audio:load', { trackId: draft.track.id, url: '', file }, 120000)
    .catch((error) => {
      if (doc.folder !== folder) return null
      throw error
    })
  if (!loaded || doc.folder !== folder) return
  const imported = importedAudio(doc.project, file, loaded.durationSec)
  doc.update((d) => {
    d.tracks.push(imported.track)
    d.lengthTicks = imported.lengthTicks
  })
  notify(`${imported.track.name} imported`)
}
async function drop(event: DragEvent): Promise<void> {
  if (!event.dataTransfer?.files.length) return
  if (!doc.folder) {
    notify('Create or open a project folder first')
    return
  }
  const folder = doc.folder
  for (const file of event.dataTransfer.files) {
    if (doc.folder !== folder) break
    try {
      await addAudio(await window.xm.project.importDropped(file))
    } catch (error) {
      fail(error)
    }
  }
}
function fail(error: unknown): void {
  notify(error instanceof Error ? error.message : String(error))
  runtime.log({ level: 'error', source: 'files', message: String(error) })
}
async function command(cmd: string): Promise<void> {
  try {
    if (cmd === 'record:armRequired') {
      notify('Arm a MIDI track before recording')
      return
    }
    if (cmd === 'link:score') await sources.link()
    else if (cmd === 'export:midi') await sources.exportForScore()
    else if (cmd === 'import:audio') {
      if (!doc.folder) {
        notify('Create or open a project folder first')
        return
      }
      const file = await window.xm.project.importFile('audio')
      if (file) await addAudio(file)
    } else if (cmd === 'new' || cmd === 'open' || cmd === 'open:portable') {
      if (runtime.transport.recording)
        await engineBus.value?.request('recording:flush', undefined)
      if (
        (doc.dirtyFiles.length || scripts.dirty) &&
        !window.confirm('Discard unsaved changes and open another project?')
      )
        return
      const snapshot =
        await window.xm.project[cmd === 'new' ? 'create' : cmd === 'open:portable' ? 'openPortable' : 'open']()
      if (snapshot) {
        doc.load(snapshot)
        runtime.log({
          level: 'ok',
          source: 'files',
          message: `Opened ${snapshot.folder}`,
        })
      }
    } else if (cmd === 'import:midi') {
      if (!doc.folder) {
        notify('Create or open a project folder first')
        return
      }
      const file = await window.xm.project.importFile('midi')
      if (!file) return
      const response = await fetch(await window.xm.project.urlFor(file))
      if (!response.ok)
        throw new Error(`${file}: import failed (${response.status})`)
      const next = importMidi(
        doc.project,
        new Uint8Array(await response.arrayBuffer()),
        file.split('/').at(-1)!,
      )
      doc.update((draft) => {
        Object.assign(draft, next)
      })
      notify(`${file.split('/').at(-1)} imported`)
    } else if (cmd === 'save' || cmd === 'export:portable') {
      if (!doc.folder) {
        notify('Create or open a project folder first')
        return
      }
      await scripts.commit()
      await doc.save()
      if (cmd === 'export:portable') {
        const path = await window.xm.project.exportPortable()
        if (path) notify(`Portable project saved to ${path}`)
      } else notify('Project saved')
    } else if (cmd === 'undo') doc.undo()
    else if (cmd === 'redo') doc.redo()
    else if (cmd === 'toggleFollowView')
      doc.update((d) => {
        d.view.follow = d.view.follow === 'page' ? 'center' : 'page'
      })
    else if (cmd === 'toggleLanes')
      doc.update((d) => {
        d.view.lanes = d.view.lanes === 'roll' ? 'staff' : 'roll'
      })
    else if (cmd === 'zoomIn') laneZoom(1.1)
    else if (
      cmd === 'insertBar' ||
      cmd === 'deleteBar' ||
      cmd === 'appendBar'
    ) {
      const bar = timeMap.value.tickToBarBeat(runtime.transport.tick).bar
      const next =
        cmd === 'appendBar'
          ? appendBars(doc.project, 1)
          : cmd === 'insertBar'
            ? insertBars(doc.project, bar, 1)
            : deleteBars(doc.project, bar, 1)
      doc.update(() => next)
      if (
        cmd !== 'appendBar' &&
        next.tracks.some(
          (t) =>
            t.kind === 'audio' &&
            t.offsetSec + t.durationSec >
              timeMap.value.tickToSec(timeMap.value.barToTick(bar)),
        )
      )
        notify('Reference audio stays in place and may no longer line up.')
    } else if (cmd === 'zoomOut') laneZoom(1 / 1.1)
    else if (cmd === 'quantize') {
      if (!editor.quantize())
        notify(
          editor.snap
            ? 'Select notes or record a take to quantize'
            : 'Choose a snap grid to quantize',
        )
    } else if (cmd === 'view:collapse') settings.collapse()
    else if (cmd.startsWith('view:lanes:')) {
      const mode = cmd.slice(11)
      if (mode === 'staff' || mode === 'roll' || mode === 'per-track')
        doc.update((draft) => {
          draft.view.lanes = mode
        })
    } else if (cmd === 'engine:restarting') {
      runtime.connected = false
      runtime.log({
        level: 'warn',
        source: 'engine',
        message: 'Engine restarting…',
      })
    } else if (cmd === 'settings:audio') showAudio.value = true
    else if (cmd === 'about') notify('xmxsplayer 0.1.0 · Application shell')
  } catch (error) {
    fail(error)
  }
}
function resize(event: PointerEvent): void {
  const target = event.target as HTMLElement
  target.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent): void => {
    settings.leftWidth = Math.min(560, Math.max(300, e.clientX))
  }
  const up = (): void => {
    localStorage.setItem('leftWidth', String(settings.leftWidth))
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}
const stopMenu = window.xm.app.onMenu((cmd) => {
  void command(cmd)
})
const stopFiles = window.xm.project.onFilesChanged((change) => {
  try {
    for (const path of doc.reload(change)) {
      notify(`${path} reloaded`)
      runtime.log({
        level: 'info',
        source: 'files',
        message: `${path} reloaded from disk`,
      })
    }
  } catch (error) {
    fail(error)
  }
})
let closeAllowed = false
let closing = false
async function prepareClose(): Promise<void> {
  if (closing) return
  closing = true
  try {
    if (runtime.connected)
      await engineBus.value?.request('recording:close', undefined)
    if (
      (doc.dirtyFiles.length || scripts.dirty) &&
      !(await window.xm.app.confirmClose())
    )
      return
    closeAllowed = true
    window.close()
  } catch (error) {
    fail(error)
  } finally {
    closing = false
  }
}
function beforeUnload(event: BeforeUnloadEvent): void {
  if (closeAllowed) return
  event.preventDefault()
  event.returnValue = false as unknown as string
  void prepareClose()
}
onMounted(() => {
  if (window.innerWidth < 1400 && localStorage.getItem('collapsed') === null)
    settings.collapsed = true
  window.xm.app.mounted()
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('keydown', shortcut)
})
onUnmounted(() => {
  stopActions()
  clearTimeout(repeatTimer)
  window.removeEventListener('keydown', shortcut)
  stopMenu()
  stopFiles()
  clearTimeout(toastTimer)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <ScriptTrust />
  <div
    class="xm-app"
    :class="{
      'is-collapsed': settings.collapsed,
      'is-following':
        (runtime.state.followMode ?? p.follow.mode) !== 'written' ||
        runtime.transport.holding,
    }"
    :style="{ '--xm-w-left': `${settings.leftWidth}px` }"
    @dragover.prevent
    @drop.prevent="drop"
  >
    <header class="xm-transport">
      <div class="xm-tgroup">
        <button
          class="xm-tbtn"
          :title="t('control.collapseLeftPanel')"
          @click="settings.collapse()"
        >
          <i class="bi bi-list" />
        </button>
        <input
          class="xm-name"
          :aria-label="t('control.projectName')"
          :value="p.name"
          @change="
            doc.update((d) => {
              d.name = ($event.target as HTMLInputElement).value
            })
          "
        >
        <span
          v-if="doc.dirtyFiles.length || scripts.dirty"
          class="xm-dot is-warn"
          :title="t('control.unsavedChanges')"
        />
      </div>
      <div class="xm-tsep" />
      <div class="xm-tgroup">
        <button
          v-for="button in transportButtons"
          :key="button.cmd"
          class="xm-tbtn"
          :class="{
            'is-play': button.cmd === 'toggle' && runtime.transport.playing,
            'is-on':
              (button.cmd === 'toggle' && runtime.transport.playing) ||
              (button.cmd === 'record' && runtime.transport.recording) ||
              (button.cmd === 'loopToggle' && p.loop.enabled) ||
              (button.cmd === 'metronome' && p.metronome.audible),
            'is-holding': button.cmd === 'toggle' && runtime.transport.holding,
            'is-rec': button.cmd === 'record',
            'is-active': button.cmd === 'record' && runtime.transport.recording,
          }"
          :disabled="
            !runtime.connected ||
              (runtime.synthLoading &&
                (button.cmd === 'toggle' || button.cmd === 'record'))
          "
          :title="button.title"
          :aria-label="button.title"
          @pointerdown="repeat($event, button.cmd)"
          @click="
            ($event.detail === 0 ||
              (button.cmd !== 'rewind' && button.cmd !== 'forward')) &&
              transport(button.cmd)
          "
        >
          <i
            :class="`bi bi-${button.cmd === 'toggle' && runtime.transport.holding ? 'hourglass-split' : button.icon}`"
          />
        </button>
      </div>
      <details class="xm-record-settings">
        <summary :title="t('control.recordingSettings')">
          {{ p.record?.mode === 'replace' ? 'Replace' : 'Overdub' }}
        </summary>
        <div class="xm-grid-popover">
          <button
            :disabled="runtime.transport.recording"
            @click="transport('recordMode')"
          >
            {{ t('control.switchTo') }} {{ p.record?.mode === 'replace' ? 'Overdub' : 'Replace' }}
          </button>
          <label>{{ t('control.preRollBars') }} <select
            :value="p.record?.preRollBars ?? 0"
            :disabled="runtime.transport.recording"
            @change="doc.update(d=>{d.record={mode:d.record?.mode ?? 'overdub',preRollBars:Number(($event.target as HTMLSelectElement).value)}})"
          ><option
            v-for="n in [0,1,2,3,4]"
            :key="n"
          >{{ n }}</option></select></label>
        </div>
      </details>
      <div class="xm-pos">
        <b>{{ String(position.bar).padStart(3, '0') }}.{{ position.beat }}.{{
          position.sixteenth
        }}</b><small>{{ elapsed }}</small>
      </div>
      <div
        v-if="p.metronome.visualScreen"
        class="xm-beats"
        :title="t('control.beat')"
      >
        <span
          v-for="beat in position.num"
          :key="beat"
          class="xm-beat"
          :class="{
            'is-on':
              runtime.transport.playing &&
              beat ===
              (runtime.transport.countInBeat
                ? ((runtime.transport.countInBeat - 1) % position.num) + 1
                : position.beat),
          }"
        />
      </div>
      <div class="xm-tsep" />
      <TempoPopover />
      <div class="xm-field xm-time-key">
        <span>{{ t('control.timeKey') }}</span><b>{{ position.num }}/{{ position.den }} · {{ keyName }}</b>
      </div>
      <div class="xm-field">
        <span>{{ t('control.speed') }}</span>
        <div class="xm-row">
          <input
            type="range"
            class="form-range"
            min="25"
            max="150"
            :value="Math.round(runtime.transport.rate * 100)"
            :title="t('control.playbackSpeedOnlyDoesNotChangeTheSongTempo')"
            :aria-label="t('control.speed')"
            @input="
              engineBus?.send('transport:setRate', {
                rate: Number(($event.target as HTMLInputElement).value) / 100,
              })
            "
            @dblclick="engineBus?.send('transport:setRate', { rate: 1 })"
          ><button
            class="xm-speed-reset xm-mono"
            :title="t('control.resetSpeed')"
            @click="engineBus?.send('transport:setRate', { rate: 1 })"
          >
            {{ Math.round(runtime.transport.rate * 100) }}%
          </button>
        </div>
      </div>
      <div class="xm-field xm-loop-field">
        <span>{{ t('control.loop') }}</span><b>{{
          p.loop.enabled
            ? `${timeMap.tickToBarBeat(p.loop.startTick).bar} – ${timeMap.tickToBarBeat(p.loop.endTick).bar}`
            : '—'
        }}</b>
      </div>
      <div class="xm-tsep" />
      <FollowControl />
      <div class="flex-grow-1" />
      <div
        class="xm-seg"
        :title="t('control.followView')"
      >
        <button
          v-for="mode in ['page', 'center'] as const"
          :key="mode"
          :class="{ 'is-on': p.view.follow === mode }"
          @click="setFollowView(mode)"
        >
          {{ mode === 'page' ? 'Page' : 'Center' }}
        </button>
      </div>
      <div class="xm-seg xm-lane-view">
        <button
          v-for="mode in ['staff', 'roll', 'per-track'] as const"
          :key="mode"
          :class="{
            'is-on': p.view.lanes === mode,
            'xm-per-track': mode === 'per-track',
          }"
          @click="
            doc.update((d) => {
              d.view.lanes = mode
            })
          "
        >
          {{ { staff: 'Staff', roll: 'Roll', 'per-track': 'Per track' }[mode] }}
        </button>
      </div>
      <div class="xm-tgroup xm-zoom">
        <button
          class="xm-tbtn"
          :title="t('control.smallerLanes')"
          @click="laneZoom(1 / 1.1)"
        >
          <i class="bi bi-zoom-out" />
        </button><button
          class="xm-tbtn"
          :title="t('control.largerLanes')"
          @click="laneZoom(1.1)"
        >
          <i class="bi bi-zoom-in" />
        </button>
      </div>
      <span class="xm-status"><span
        class="xm-dot"
        :class="{
          'is-off': !runtime.connected,
          'is-warn':
            runtime.synthLoading ||
            (p.instruments.length > 0 && !runtime.readyInstruments.length),
        }"
      /><span
        v-if="
          runtime.connected &&
            !runtime.synthLoading &&
            runtime.latency?.backend === 'fluid'
        "
        class="xm-engine-label"
      >{{ t('control.fluidsynth') }}<small class="xm-configured-latency">{{ t('control.configured') }} {{ runtime.latency.fluidMs.toFixed(1) }} {{ t('control.ms') }}</small></span><span
        v-else
        class="xm-engine-label"
      >{{
        runtime.connected
          ? runtime.synthLoading
            ? 'Loading sounds…'
            : runtime.latency
              ? `Built-in · ${(runtime.latency.baseMs + runtime.latency.outputMs).toFixed(1)} ms`
              : 'Engine ready'
          : 'Engine restarting…'
      }}</span></span>
      <span class="xm-status"><span
        class="xm-dot"
        :class="{
          'is-off': !runtime.midi.inputs.some(
            (i) => !/through/i.test(i.name),
          ),
        }"
      /><i class="bi bi-usb-symbol" /><span class="xm-engine-label">{{
        runtime.midi.inputs.some((i) => !/through/i.test(i.name))
          ? runtime.midi.inputs.some((i) => /Essential|KeyLab/i.test(i.name))
            ? 'KeyLab'
            : 'MIDI connected'
          : 'No controller'
      }}</span></span>
      <button
        class="xm-tbtn"
        :title="t('control.audioSettings')"
        @click="showAudio = true"
      >
        <i class="bi bi-gear" />
      </button>
    </header>

    <aside class="xm-left">
      <section
        v-for="section in sections"
        :key="section"
        class="xm-sec"
      >
        <button
          class="xm-sec-h"
          :aria-expanded="settings.sections[section] !== false"
          @click="settings.toggle(section)"
        >
          <i
            :class="`bi bi-chevron-${settings.sections[section] === false ? 'right' : 'down'}`"
          />
          <h6>{{ section }}</h6>
          <span
            v-if="section === 'Log'"
            class="xm-count"
          >{{
            runtime.logs.length
          }}</span>
        </button>
        <div
          v-if="settings.sections[section] !== false"
          class="xm-sec-b"
        >
          <ScenesPanel v-if="section === 'Scenes'" />
          <OrchestraPanel v-else-if="section === 'Orchestra'" />
          <RegistersPanel v-else-if="section === 'Registers'" />
          <ControlsPanel
            v-else-if="section === 'Controls'"
            ref="controlPanels"
          />
          <SignalFlowPanel
            v-else-if="section === 'Signal flow'"
            @select="flowSelect"
            @patch="flowPatch"
          />
          <template v-else-if="section === 'Log'">
            <button
              class="btn btn-sm btn-ghost mb-2"
              @click="runtime.logs = []"
            >
              {{ t('control.clear') }}
            </button>
            <div
              class="xm-log"
              aria-live="polite"
            >
              <div
                v-for="(entry, index) in runtime.logs"
                :key="index"
              >
                <span class="xm-faint">{{ entry.time }} </span><span
                  :class="`xm-log-${entry.level}`"
                >{{ entry.source }}</span>
                {{ entry.message }}
              </div>
              <span
                v-if="!runtime.logs.length"
                class="xm-faint"
              >{{ t('control.noMessages') }}</span>
            </div>
          </template>
          <ScriptPanel
            v-else-if="section === 'Script'"
            ref="scriptPanels"
          />
          <SoundfontsPanel v-else-if="section === 'Soundfonts'" />
          <PatchPanel
            v-else-if="section === 'Patch'"
            ref="patchPanels"
            @instrument="pickerId = $event"
          />
          <DevicesPanel v-else-if="section === 'Devices'" />
          <ClipsPanel v-else-if="section === 'Clips'" />
          <SourcesPanel
            v-else-if="section === 'Sources'"
            @error="fail"
          />
          <template v-else>
            <span class="xm-faint">{{
              {
                Soundfonts: 'No soundfonts',
                Sources: 'No linked scores',
              }[section]
            }}</span>
          </template>
        </div>
      </section>
    </aside>
    <div
      v-if="!settings.collapsed"
      class="xm-shell-divider"
      :style="{ left: `${settings.leftWidth - 3}px` }"
      @pointerdown="resize"
    />

    <Timeline
      @patch="editPatch"
      @instrument="pickerId = $event"
      @command="command"
      @error="fail"
    />
    <KeyboardStrip
      ref="keyboardStrip"
      @script="flowSelect({ kind: 'script' }, { right: 0, top: 0 })"
    />
    <InstrumentPicker
      v-if="pickerId"
      :instrument-id="pickerId"
      @close="pickerId = null"
    />
    <AudioSettings
      v-if="showAudio"
      @close="showAudio = false"
    />
    <div
      v-if="toast"
      class="xm-toast-stack"
      role="status"
    >
      <div class="xm-log">
        {{ toast }}
      </div>
    </div>
  </div>
</template>
