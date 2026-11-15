<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useProjectStore } from './stores/project'
import { useRuntimeStore } from './stores/runtime'
import { useSettingsStore } from './stores/settings'
import { importMidi } from './sources/import-midi'
import { engineBus } from './bus'
import KeyboardStrip from './components/KeyboardStrip.vue'
import SoundfontsPanel from './components/SoundfontsPanel.vue'
import InstrumentPicker from './components/InstrumentPicker.vue'
import AudioSettings from './components/AudioSettings.vue'
import Timeline from './timeline/Timeline.vue'
import { TimeMap } from '../shared/time-map'
import type { Action } from '../shared/model'

const doc = useProjectStore()
const runtime = useRuntimeStore()
const settings = useSettingsStore()
const toast = ref('')
const pickerId = ref<string | null>(null)
const showAudio = ref(false)
let toastTimer: ReturnType<typeof setTimeout>
const sections = [
  'Scenes',
  'Registers',
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
      'input,textarea,select,[contenteditable="true"],button',
    )
  )
    return
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
  if (key === ' ') cmd = 'toggle'
  else if (key === 'enter') cmd = 'stop'
  else if (key === 'r') cmd = 'record'
  else if (key === 'l') cmd = 'loopToggle'
  else if (key === '[') cmd = 'loopStartHere'
  else if (key === ']') cmd = 'loopEndHere'
  if (cmd) {
    event.preventDefault()
    transport(cmd)
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
function fail(error: unknown): void {
  runtime.log({ level: 'error', source: 'files', message: String(error) })
}
async function command(cmd: string): Promise<void> {
  try {
    if (cmd === 'new' || cmd === 'open') {
      if (
        doc.dirtyFiles.length &&
        !window.confirm('Discard unsaved changes and open another project?')
      )
        return
      const snapshot =
        await window.xm.project[cmd === 'new' ? 'create' : 'open']()
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
    } else if (cmd === 'save') {
      if (!doc.folder) {
        notify('Create or open a project folder first')
        return
      }
      await doc.save()
      notify('Project saved')
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
    else if (cmd === 'zoomOut') laneZoom(1 / 1.1)
    else if (cmd === 'quantize')
      notify('Select notes in the piano-roll editor to quantize')
    else if (cmd === 'view:collapse') settings.collapse()
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
function renameRegister(index: number, event: Event): void {
  doc.update((draft) => {
    draft.registers[index].name = (event.target as HTMLInputElement).value
  })
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
function beforeUnload(event: BeforeUnloadEvent): void {
  if (
    doc.dirtyFiles.length &&
    !window.confirm('Discard unsaved changes and quit?')
  ) {
    event.preventDefault()
    event.returnValue = false as unknown as string
  }
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
  <div
    class="xm-app"
    :class="{ 'is-collapsed': settings.collapsed }"
    :style="{ '--xm-w-left': `${settings.leftWidth}px` }"
  >
    <header class="xm-transport">
      <div class="xm-tgroup">
        <button
          class="xm-tbtn"
          title="Collapse left panel"
          @click="settings.collapse()"
        >
          <i class="bi bi-list" />
        </button>
        <input
          class="xm-name"
          aria-label="Project name"
          :value="p.name"
          @change="
            doc.update((d) => {
              d.name = ($event.target as HTMLInputElement).value
            })
          "
        >
        <span
          v-if="doc.dirtyFiles.length"
          class="xm-dot is-warn"
          title="Unsaved changes"
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
            'is-rec': button.cmd === 'record',
            'is-active': button.cmd === 'record' && runtime.transport.recording,
          }"
          :disabled="!runtime.connected"
          :title="button.title"
          :aria-label="button.title"
          @pointerdown="repeat($event, button.cmd)"
          @click="
            ($event.detail === 0 ||
              (button.cmd !== 'rewind' && button.cmd !== 'forward')) &&
              transport(button.cmd)
          "
        >
          <i :class="`bi bi-${button.icon}`" />
        </button>
      </div>
      <div class="xm-pos">
        <b>{{ String(position.bar).padStart(3, '0') }}.{{ position.beat }}.{{
          position.sixteenth
        }}</b><small>{{ elapsed }}</small>
      </div>
      <div
        v-if="p.metronome.visualScreen"
        class="xm-beats"
        title="Beat"
      >
        <span
          v-for="beat in position.num"
          :key="beat"
          class="xm-beat"
          :class="{
            'is-on': runtime.transport.playing && beat === position.beat,
          }"
        />
      </div>
      <div class="xm-tsep" />
      <div class="xm-field">
        <span>Tempo</span><b>{{ timeMap.tempoAt(runtime.transport.tick).toFixed(1) }}</b>
      </div>
      <div class="xm-field xm-time-key">
        <span>Time · Key</span><b>{{ position.num }}/{{ position.den }} · {{ keyName }}</b>
      </div>
      <div class="xm-field">
        <span>Speed</span>
        <div class="xm-row">
          <input
            type="range"
            class="form-range"
            min="25"
            max="150"
            :value="Math.round(runtime.transport.rate * 100)"
            aria-label="Speed"
            @input="
              engineBus?.send('transport:setRate', {
                rate: Number(($event.target as HTMLInputElement).value) / 100,
              })
            "
            @dblclick="engineBus?.send('transport:setRate', { rate: 1 })"
          ><button
            class="xm-speed-reset xm-mono"
            title="Reset speed"
            @click="engineBus?.send('transport:setRate', { rate: 1 })"
          >
            {{ Math.round(runtime.transport.rate * 100) }}%
          </button>
        </div>
      </div>
      <div class="xm-field xm-loop-field">
        <span>Loop</span><b>{{
          p.loop.enabled
            ? `${timeMap.tickToBarBeat(p.loop.startTick).bar} – ${timeMap.tickToBarBeat(p.loop.endTick).bar}`
            : '—'
        }}</b>
      </div>
      <div class="xm-tsep" />
      <div class="xm-field">
        <span>Follow</span><button
          class="btn btn-sm btn-xm dropdown-toggle"
          disabled
        >
          {{ runtime.transport.holding ? 'Holding' : 'Written' }}
        </button>
      </div>
      <div class="flex-grow-1" />
      <div
        class="xm-seg"
        title="Follow view"
      >
        <button
          v-for="mode in ['page', 'center'] as const"
          :key="mode"
          :class="{ 'is-on': p.view.follow === mode }"
          @click="
            doc.update((d) => {
              d.view.follow = mode
            })
          "
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
          title="Smaller lanes"
          @click="laneZoom(1 / 1.1)"
        >
          <i class="bi bi-zoom-out" />
        </button><button
          class="xm-tbtn"
          title="Larger lanes"
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
      /><span class="xm-engine-label">{{
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
        title="Audio settings"
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
          <template v-if="section === 'Scenes'">
            <div class="xm-wrap">
              <span class="xm-chip is-active">Base</span>
            </div>
            <p class="xm-faint mt-2 mb-0">
              No scenes yet
            </p>
          </template>
          <div
            v-else-if="section === 'Registers'"
            class="xm-regs"
          >
            <div
              v-for="(reg, index) in p.registers"
              :key="index"
              class="xm-reg"
            >
              <button disabled>
                {{ index + 1 }}
              </button><input
                class="xm-register-name"
                :aria-label="`Register ${index + 1} name`"
                :value="reg.name"
                @change="renameRegister(index, $event)"
              >
            </div>
          </div>
          <template v-else-if="section === 'Controls'">
            <div class="xm-ctl">
              <div class="xm-pads">
                <button
                  v-for="pad in 8"
                  :key="pad"
                  class="xm-pad is-empty"
                  disabled
                >
                  <span class="xm-pad-n">{{ pad }}</span><span
                    class="xm-pad-label"
                  >Unbound</span>
                </button>
              </div>
            </div>
          </template>
          <template v-else-if="section === 'Log'">
            <button
              class="btn btn-sm btn-ghost mb-2"
              @click="runtime.logs = []"
            >
              Clear
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
              >No messages</span>
            </div>
          </template>
          <template v-else-if="section === 'Script'">
            <p class="xm-faint mb-0">
              Script execution is not available yet.
            </p>
          </template>
          <SoundfontsPanel v-else-if="section === 'Soundfonts'" />
          <template v-else-if="section === 'Patch'">
            <div
              v-for="connection in p.base.patch"
              :key="connection.id"
              class="xm-row mb-2"
            >
              <span class="xm-chip is-sm">{{
                p.tracks.find((t) => t.id === connection.trackId)?.name ??
                  connection.trackId
              }}</span><i class="bi bi-arrow-right xm-faint" /><button
                class="xm-chip is-sm"
                @click="pickerId = connection.instrumentId"
              >
                <i class="bi bi-music-note" />{{
                  p.instruments.find((i) => i.id === connection.instrumentId)
                    ?.name ?? connection.instrumentId
                }}
              </button>
            </div>
            <span
              v-if="!p.base.patch.length"
              class="xm-faint"
            >No track → instrument connections</span>
          </template>
          <template v-else-if="section === 'Devices'">
            <div
              v-for="input in runtime.midi.inputs"
              :key="input.id"
              class="xm-status mb-2"
            >
              <span class="xm-dot" />{{ input.name }}
            </div>
            <span
              v-if="!runtime.midi.inputs.length"
              class="xm-status"
            ><span class="xm-dot is-off" />No controller</span>
          </template>
          <template v-else>
            <span class="xm-faint">{{
              {
                Clips: 'No clips',
                'Signal flow': 'No routes',
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
      @instrument="pickerId = $event"
      @command="command"
      @error="fail"
    />
    <KeyboardStrip />
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
