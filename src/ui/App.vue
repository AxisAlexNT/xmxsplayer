<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useProjectStore } from './stores/project'
import { useRuntimeStore } from './stores/runtime'
import { useSettingsStore } from './stores/settings'
import { engineBus } from './bus'
import KeyboardStrip from './components/KeyboardStrip.vue'
import SoundfontsPanel from './components/SoundfontsPanel.vue'
import InstrumentPicker from './components/InstrumentPicker.vue'
import AudioSettings from './components/AudioSettings.vue'
import ConflictBanner from './components/ConflictBanner.vue'

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
    } else if (cmd === 'save') {
      if (!doc.folder) {
        notify('Create or open a project folder first')
        return
      }
      await doc.save()
      notify('Project saved')
    } else if (cmd === 'undo') doc.undo()
    else if (cmd === 'redo') doc.redo()
    else if (cmd === 'view:collapse') settings.collapse()
    else if (cmd.startsWith('view:lanes:')) { const mode = cmd.slice(11); if (mode === 'staff' || mode === 'roll' || mode === 'per-track') doc.update(draft => { draft.view.lanes = mode }) }
    else if (cmd === 'engine:restarting') {
      runtime.connected = false
      runtime.log({
        level: 'warn',
        source: 'engine',
        message: 'Engine restarting…',
      })
    } else if (cmd === 'about') notify('xmxsplayer 0.1.0 · Application shell')
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
  if (window.innerWidth < 1400 && localStorage.getItem('collapsed') === null) settings.collapsed = true
  window.xm.app.mounted()
  window.addEventListener('beforeunload', beforeUnload)
})
onUnmounted(() => {
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
          v-for="[icon, title] in [
            ['skip-start-fill', 'To start'],
            ['rewind-fill', 'Back one bar'],
            ['play-fill', 'Play / pause'],
            ['stop-fill', 'Stop'],
            ['record-fill', 'Record'],
            ['fast-forward-fill', 'Forward one bar'],
            ['arrow-repeat', 'Loop'],
            ['bell', 'Metronome'],
          ]"
          :key="icon"
          class="xm-tbtn"
          :class="{ 'is-rec': icon === 'record-fill' }"
          :disabled="icon !== 'stop-fill'"
          :title="icon === 'stop-fill' ? 'Stop all notes' : `${title} · Available in a later milestone`"
          @click="icon === 'stop-fill' && engineBus?.send('panic', undefined)"
        >
          <i :class="`bi bi-${icon}`" />
        </button>
      </div>
      <div class="xm-pos">
        <b>001.1.1</b><small>00:00.000</small>
      </div>
      <div
        class="xm-beats"
        title="Beat"
      >
        <span
          v-for="beat in 4"
          :key="beat"
          class="xm-beat"
        />
      </div>
      <div class="xm-tsep" />
      <div class="xm-field">
        <span>Tempo</span><b>{{ p.tempos[0]?.bpm.toFixed(1) }}</b>
      </div>
      <div class="xm-field xm-time-key">
        <span>Time · Key</span><b>4/4 · C</b>
      </div>
      <div class="xm-field">
        <span>Speed</span>
        <div class="xm-row">
          <input
            type="range"
            class="form-range"
            min="25"
            max="150"
            value="100"
            aria-label="Speed"
            disabled
          ><b class="xm-mono">100%</b>
        </div>
      </div>
      <div class="xm-field xm-loop-field">
        <span>Loop</span><b>—</b>
      </div>
      <div class="xm-tsep" />
      <div class="xm-field">
        <span>Follow</span><button
          class="btn btn-sm btn-xm dropdown-toggle"
          disabled
        >
          Written
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
          :class="{ 'is-on': p.view.lanes === mode, 'xm-per-track': mode === 'per-track' }"
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
          disabled
        >
          <i class="bi bi-zoom-out" />
        </button><button
          class="xm-tbtn"
          title="Larger lanes"
          disabled
        >
          <i class="bi bi-zoom-in" />
        </button>
      </div>
      <span class="xm-status"><span
        class="xm-dot"
        :class="{ 'is-off': !runtime.connected, 'is-warn': runtime.synthLoading || (p.instruments.length > 0 && !runtime.readyInstruments.length) }"
      /><span
        class="xm-engine-label"
      >{{ runtime.connected ? (runtime.synthLoading ? 'Loading sounds…' : runtime.latency ? `Built-in · ${(runtime.latency.baseMs + runtime.latency.outputMs).toFixed(1)} ms` : 'Engine ready') : 'Engine restarting…' }}</span></span>
      <span class="xm-status"><span
        class="xm-dot"
        :class="{'is-off':!runtime.midi.inputs.some(i=>!/through/i.test(i.name))}"
      /><i class="bi bi-usb-symbol" /><span
        class="xm-engine-label"
      >{{ runtime.midi.inputs.some(i=>!/through/i.test(i.name)) ? (runtime.midi.inputs.some(i=>/Essential|KeyLab/i.test(i.name)) ? 'KeyLab' : 'MIDI connected') : 'No controller' }}</span></span>
      <button
        class="xm-tbtn"
        title="Audio settings"
        @click="showAudio = true"
      >
        <i class="bi bi-gear" />
      </button>
      <button
        class="xm-tbtn"
        title="Save project"
        @click="command('save')"
      >
        <i class="bi bi-floppy" />
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
              <span class="xm-chip is-sm">{{ p.tracks.find(t=>t.id===connection.trackId)?.name ?? connection.trackId }}</span><i class="bi bi-arrow-right xm-faint" /><button
                class="xm-chip is-sm"
                @click="pickerId=connection.instrumentId"
              >
                <i class="bi bi-music-note" />{{ p.instruments.find(i=>i.id===connection.instrumentId)?.name ?? connection.instrumentId }}
              </button>
            </div><span
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
            </div><span
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

    <main class="xm-main">
      <ConflictBanner @error="fail" />
      <div class="xm-rowgrid xm-ruler">
        <div class="xm-corner">
          <i class="bi bi-rulers" /> Bars
        </div>
        <div class="xm-ruler-bars">
          <span /><span
            v-for="bar in 4"
            :key="bar"
          >{{ bar }}</span>
        </div>
      </div>
      <div class="xm-rowgrid xm-cues">
        <div class="xm-corner">
          Cues
        </div>
        <div />
      </div>
      <div class="xm-tracks">
        <div
          v-for="track in p.tracks"
          :key="track.id"
          class="xm-rowgrid xm-track xm-shell-track"
          :style="{ '--h': `${track.height}px`, '--c': track.color }"
        >
          <div class="xm-th">
            <div class="xm-th-top">
              <i class="bi bi-grip-vertical xm-grip" /><span
                class="xm-th-name"
              >{{ track.name }}</span>
            </div>
            <span
              class="xm-mode"
              :class="`is-${track.mode}`"
            >{{
              track.mode.toUpperCase()
            }}</span>
          </div>
          <div class="xm-lane" />
        </div>
        <div
          v-if="!p.tracks.length"
          class="xm-empty"
        >
          <h1 class="h5 mb-0">
            Start a project
          </h1>
          <span>Open a project folder or create one to begin.</span>
          <div class="xm-row">
            <button
              class="btn btn-primary"
              @click="command('new')"
            >
              New project
            </button><button
              class="btn btn-xm"
              @click="command('open')"
            >
              Open project
            </button>
          </div>
          <small>Tracks, sound and performance controls follow in later
            milestones.</small>
        </div>
      </div>
    </main>
    <KeyboardStrip />
    <InstrumentPicker
      v-if="pickerId"
      :instrument-id="pickerId"
      @close="pickerId=null"
    />
    <AudioSettings
      v-if="showAudio"
      @close="showAudio=false"
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
