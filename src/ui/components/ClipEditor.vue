<script setup lang="ts">
import { t } from '../i18n'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Clip } from '../../shared/model'
import type { RequestMap } from '../../shared/protocol'
import { clipSchema } from '../../shared/schema'
import { uniqueId } from '../../shared/ids'
import { TimeMap } from '../../shared/time-map'
import { engineBus } from '../bus'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { useSettingsStore } from '../stores/settings'
import { clipBindings, deleteClip, snapClipBar } from '../clips/model'
import ClipWave from './ClipWave.vue'
const props = defineProps<{
    clip: Clip
    fresh?: boolean
    source?: RequestMap['clip:source']['output']
  }>(),
  emit = defineEmits<{ close: [] }>()
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  settings = useSettingsStore(),
  dialog = ref<HTMLDialogElement>()
const original = JSON.stringify(props.clip),
  draft = ref<Clip>(JSON.parse(original)),
  source = ref(props.source),
  error = ref(''),
  loading = ref(!props.source),
  snapping = ref(false)
const bound = computed(() =>
  clipBindings(
    doc.project,
    draft.value.id,
    runtime.state.activeSceneId,
    runtime.midi.devices.map((d) => d.profileId),
  ).join(', '),
)
const valid = computed(
  () =>
    clipSchema.safeParse(draft.value).success &&
    (!source.value || draft.value.endSec <= source.value.durationSec + 1e-7),
)
const auditioning = computed(() => runtime.clipAudition.state !== 'stopped')
let disposed = false,
  revision = 0,
  snapRequest = 0,
  timingTouched = !props.fresh
const focusReturn = document.activeElement as HTMLElement | null
function close(): void {
  emit('close')
}
function changeRange(start: number, end: number): void {
  draft.value.startSec = start
  draft.value.endSec = end
}
async function snap(): Promise<void> {
  if (!source.value || !engineBus.value) return
  const request = ++snapRequest,
    current = ++revision,
    start = draft.value.startSec,
    end = draft.value.endSec
  snapping.value = true
  try {
    const startBar = snapClipBar(doc.project, draft.value.file, start),
      endBar = snapClipBar(doc.project, draft.value.file, end)
    const positions =
      startBar === null || endBar === null
        ? await Promise.all([
            engineBus.value.request('clip:snap', {
              file: draft.value.file,
              seconds: start,
            }),
            engineBus.value.request('clip:snap', {
              file: draft.value.file,
              seconds: end,
            }),
          ])
        : [startBar, endBar]
    if (
      disposed ||
      current !== revision ||
      draft.value.startSec !== start ||
      draft.value.endSec !== end
    )
      return
    const minimum = 1 / source.value.sampleRate
    draft.value.startSec = Math.max(
      0,
      Math.min(source.value.durationSec - minimum, positions[0]),
    )
    draft.value.endSec = Math.max(
      draft.value.startSec + minimum,
      Math.min(source.value.durationSec, positions[1]),
    )
  } catch (reason) {
    if (!disposed && current === revision) error.value = String(reason)
  } finally {
    if (!disposed && request === snapRequest) snapping.value = false
  }
}
function sync(): void {
  if (draft.value.sync) draft.value.pitchMode = 'keepTempo'
  if (!timingTouched) draft.value.quantize = draft.value.sync ? 'bar' : 'now'
}
function timing(at: Clip['quantize']): void {
  timingTouched = true
  draft.value.quantize = at
}
function detect(): void {
  draft.value.beats = Math.max(
    0.25,
    Math.round(
      (((draft.value.endSec - draft.value.startSec) *
        new TimeMap(doc.project).tempoAt(runtime.transport.tick)) /
        60) *
        4,
    ) / 4,
  )
}
function audition(): void {
  runtime.clipAudition.error = ''
  if (auditioning.value) engineBus.value?.send('clip:audition', null)
  else if (valid.value)
    engineBus.value?.send(
      'clip:audition',
      JSON.parse(JSON.stringify(draft.value)),
    )
}
function done(): void {
  try {
    if (!valid.value) throw Error('Choose a valid fragment and clip settings')
    if (
      !props.fresh &&
      JSON.stringify(doc.project.clips.find((c) => c.id === props.clip.id)) !==
        original
    )
      throw Error(
        'This clip changed outside the editor. Reopen it before applying changes.',
      )
    const clip = clipSchema.parse(JSON.parse(JSON.stringify(draft.value)))
    doc.update((project) => {
      if (props.fresh) {
        clip.id = uniqueId(
          clip.id,
          project.clips.map((c) => c.id),
        )
        project.clips.push(clip)
      } else
        project.clips[project.clips.findIndex((c) => c.id === props.clip.id)] =
          clip
    })
    close()
  } catch (reason) {
    error.value = String(reason)
  }
}
function remove(): void {
  doc.update((project) => deleteClip(project, props.clip.id))
  close()
}
watch(
  () => [draft.value.startSec, draft.value.endSec],
  () => {
    revision++
    snapping.value = false
  },
  { flush: 'sync' },
)
onMounted(async () => {
  runtime.clipAudition.error = ''
  dialog.value!.showModal()
  try {
    if (!source.value)
      source.value = await engineBus.value!.request(
        'clip:source',
        { file: draft.value.file },
        120000,
      )
  } catch (reason) {
    if (!disposed) error.value = String(reason)
  } finally {
    if (!disposed) loading.value = false
  }
})
onUnmounted(() => {
  disposed = true
  revision++
  engineBus.value?.send('clip:audition', null)
  if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true })
})
</script>
<template>
  <dialog
    ref="dialog"
    class="xm-dialog xm-clip-dialog"
    aria-labelledby="clip-title"
    @cancel.prevent="close"
  >
    <div class="xm-dialog-h">
      <input
        v-model="draft.color"
        type="color"
        class="xm-clip-colour"
        :aria-label="t('clipEditor.clipColour')"
      >
      <h5 id="clip-title">
        {{ t('clipEditor.clip') }} {{ draft.name }}
      </h5>
      <button
        class="btn btn-sm btn-xm"
        :disabled="loading || !valid || !runtime.connected"
        @click="audition"
      >
        <i :class="`bi bi-${auditioning ? 'stop' : 'play'}-fill`" />
        {{ auditioning ? 'Stop audition' : 'Audition' }}
      </button><button
        class="btn btn-sm btn-ghost"
        :aria-label="t('clipEditor.closeClipEditor')"
        @click="close"
      >
        <i class="bi bi-x-lg" />
      </button>
    </div>
    <div class="xm-dialog-b">
      <div class="xm-row xm-clip-meta">
        <span class="xm-muted flex-grow-1">{{ draft.file
        }}<template v-if="source">
          · {{ (source.sampleRate / 1000).toFixed(1) }} {{ t('clipEditor.kHz') }}
          {{ source.channels === 1 ? 'mono' : 'stereo' }} ·
          {{ source.durationSec.toFixed(3) }} {{ t('clipEditor.s') }}</template></span><span class="xm-mono xm-muted">{{ t('clipEditor.length') }}
          {{ Math.max(0, draft.endSec - draft.startSec).toFixed(3) }} {{ t('clipEditor.s') }}</span>
      </div>
      <p
        v-if="loading"
        class="xm-faint"
        role="status"
      >
        {{ t('clipEditor.loadingWaveform') }}
      </p>
      <ClipWave
        v-if="source"
        :source="source"
        :start="Number(draft.startSec) || 0"
        :end="Number(draft.endSec) || 0"
        :color="draft.color"
        @change="changeRange"
        @commit="snap"
      />
      <div class="xm-row xm-clip-range">
        <label>{{ t('clipEditor.start') }}
          <input
            v-model.number="draft.startSec"
            type="number"
            min="0"
            :max="draft.endSec"
            step="0.001"
            class="form-control xm-mono"
            :aria-label="t('clipEditor.clipStartSeconds')"
          ></label><label>{{ t('clipEditor.end') }}
          <input
            v-model.number="draft.endSec"
            type="number"
            :min="draft.startSec"
            :max="source?.durationSec"
            step="0.001"
            class="form-control xm-mono"
            :aria-label="t('clipEditor.clipEndSeconds')"
          ></label><span class="xm-faint">{{
          snapClipBar(doc.project, draft.file, 0) === null
            ? 'Edges snap to nearby zero crossings'
            : 'Edges snap to the project bar grid'
        }}</span><span
          v-if="snapping"
          class="xm-faint"
        >{{ t('clipEditor.snapping') }}</span>
      </div>
      <div class="row g-3 xm-clip-fields">
        <div class="col-6 col-md-3">
          <label
            class="form-label"
            for="clip-name"
          >{{ t('picker.name') }}</label><input
            id="clip-name"
            v-model="draft.name"
            class="form-control"
            :aria-label="t('clipEditor.clipName')"
          >
        </div>
        <div class="col-6 col-md-3">
          <label
            class="form-label"
            for="clip-launch"
          >{{ t('clipEditor.launchPads') }}</label><select
            id="clip-launch"
            v-model="draft.launch"
            class="form-select"
            :aria-label="t('clipEditor.clipLaunchMode')"
          >
            <option value="toggle">
              {{ t('clipEditor.toggle') }}
            </option>
            <option value="hold">
              {{ t('clipEditor.hold') }}
            </option>
            <option value="oneShot">
              {{ t('clipEditor.oneShot') }}
            </option>
            <option value="retrigger">
              {{ t('clipEditor.retrigger') }}
            </option>
          </select>
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label">{{ t('clipEditor.startStopOn') }}</label>
          <div class="xm-seg">
            <button
              v-for="at in ['now', 'beat', 'bar'] as const"
              :key="at"
              :class="{ 'is-on': draft.quantize === at }"
              :aria-pressed="draft.quantize === at"
              @click="timing(at)"
            >
              {{ at === 'now' ? 'Now' : at === 'beat' ? 'Beat' : 'Bar' }}
            </button>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <label
            class="form-label"
            for="clip-group"
          >{{ t('clipEditor.exclusiveGroup') }}</label><input
            id="clip-group"
            v-model="draft.group"
            class="form-control"
            :aria-label="t('clipEditor.clipExclusiveGroup')"
          >
        </div>
        <div class="col-12 col-md-4">
          <label class="form-label">{{ t('clipEditor.tempoSync') }}</label>
          <div class="xm-row">
            <label
              class="xm-clip-sync-toggle form-switch"
              :title="t('clipEditor.tempoSync')"
            >
              <input
                v-model="draft.sync"
                type="checkbox"
                role="switch"
                class="form-check-input"
                :aria-label="t('clipEditor.clipTempoSync')"
                @change="sync"
              ><span class="visually-hidden">{{ t('clipEditor.tempoSync') }}</span></label><input
              v-model.number="draft.beats"
              type="number"
              min="0.0001"
              step="0.25"
              class="form-control xm-mono xm-clip-small"
              :aria-label="t('clipEditor.clipBeatLength')"
              :disabled="!draft.sync"
            ><span class="xm-muted">{{ t('clipEditor.beats') }}</span><button
              class="btn btn-sm btn-ghost"
              :disabled="!draft.sync"
              :title="t('clipEditor.detectFromFragmentLengthAtCurrentTempo')"
              @click="detect"
            >
              {{ t('library.detect') }}
            </button>
          </div>
        </div>
        <div class="col-12 col-md-5">
          <label class="form-label">{{ t('clipEditor.pitch') }}</label>
          <div class="xm-row">
            <input
              v-model.number="draft.semitones"
              type="number"
              step="0.1"
              class="form-control xm-mono xm-clip-small"
              :aria-label="t('clipEditor.clipSemitones')"
            ><span class="xm-muted">{{ t('clipEditor.st') }}</span>
            <div class="xm-seg">
              <button
                :class="{ 'is-on': draft.pitchMode === 'keepTempo' }"
                @click="draft.pitchMode = 'keepTempo'"
              >
                {{ t('clipEditor.keepTempo') }}
              </button><button
                :class="{ 'is-on': draft.pitchMode === 'tape' }"
                :disabled="draft.sync"
                @click="draft.pitchMode = 'tape'"
              >
                {{ t('clipEditor.tapePitchSpeed') }}
              </button>
            </div>
          </div>
        </div>
        <div class="col-12 col-md-3">
          <label class="form-label">{{ t('clipEditor.gainPan') }}</label>
          <div class="xm-row">
            <input
              v-model.number="draft.gain"
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="form-range"
              :aria-label="t('clipEditor.clipGain')"
            ><input
              v-model.number="draft.pan"
              type="range"
              min="-1"
              max="1"
              step="0.01"
              class="form-range"
              :aria-label="t('clipEditor.clipPan')"
            >
          </div>
        </div>
        <div class="col-12">
          <label class="form-label">{{ t('clipEditor.options') }}</label>
          <div class="xm-wrap">
            <button
              v-for="option in [
                { key: 'loop', label: 'Loop' },
                { key: 'pressureToGain', label: 'Pad pressure → gain' },
                { key: 'toCue', label: 'To cue out' },
              ] as const"
              :key="option.key"
              class="xm-chip is-sm"
              :class="{ 'is-active': draft[option.key] }"
              :aria-pressed="draft[option.key]"
              :disabled="option.key === 'loop' && draft.launch === 'oneShot'"
              @click="draft[option.key] = !draft[option.key]"
            >
              {{ option.label }}
            </button><label class="xm-row ms-auto">{{ t('clipEditor.fade') }}
              <input
                v-model.number="draft.fadeMs"
                type="number"
                min="0"
                step="1"
                class="form-control xm-mono xm-clip-small"
                :aria-label="t('clipEditor.clipFadeMilliseconds')"
              >
              {{ t('control.ms') }}</label>
          </div>
          <small
            v-if="draft.toCue && settings.value.audio.cue.mode === 'device'"
            class="xm-faint"
          >{{ t('clipEditor.separateDeviceCueTimingIsApproximate') }}</small>
        </div>
        <div class="col-12">
          <hr class="xm-clip-divider">
          <label class="form-label">{{ t('clipEditor.onAFaderOrKnob') }}</label>
          <div class="xm-row xm-clip-sweep">
            <div class="xm-seg">
              <button
                v-for="mode in [
                  { value: 'moving', label: 'While moving' },
                  { value: 'position', label: 'Position, bottom = off' },
                  { value: 'pitchOnly', label: 'Pitch only' },
                ] as const"
                :key="mode.value"
                :class="{ 'is-on': draft.sweep.mode === mode.value }"
                :aria-pressed="draft.sweep.mode === mode.value"
                @click="draft.sweep.mode = mode.value"
              >
                {{ mode.label }}
              </button>
            </div>
            <label class="xm-row">{{ t('clipEditor.range') }}
              <input
                v-model.number="draft.sweep.range[0]"
                type="number"
                class="form-control xm-mono xm-clip-small"
                :aria-label="t('clipEditor.clipSweepMinimumSemitones')"
              ></label><label class="xm-row">{{ t('clipEditor.to') }}
              <input
                v-model.number="draft.sweep.range[1]"
                type="number"
                class="form-control xm-mono xm-clip-small"
                :aria-label="t('clipEditor.clipSweepMaximumSemitones')"
              >
              {{ t('clipEditor.st') }}</label><label
              v-if="draft.sweep.mode === 'moving'"
              class="xm-row"
            >{{ t('clipEditor.release') }}
              <input
                v-model.number="draft.sweep.releaseMs"
                type="number"
                min="0"
                class="form-control xm-mono xm-clip-small"
                :aria-label="t('clipEditor.clipSweepReleaseMilliseconds')"
              >
              {{ t('control.ms') }}</label><label
              v-if="draft.sweep.mode === 'position'"
              class="xm-row"
            >{{ t('clipEditor.offBelow') }}
              <input
                v-model.number="draft.sweep.offBelow"
                type="number"
                min="0"
                max="1"
                step="0.01"
                class="form-control xm-mono xm-clip-small"
                :aria-label="t('clipEditor.clipSweepOffThreshold')"
              ></label>
          </div>
        </div>
      </div>
      <p
        v-if="error || runtime.clipAudition.error"
        class="text-danger mt-3 mb-0"
        role="alert"
      >
        {{ error || runtime.clipAudition.error }}
      </p>
    </div>
    <div class="xm-dialog-f">
      <button
        v-if="!fresh"
        class="btn btn-ghost text-danger me-auto"
        @click="remove"
      >
        <i class="bi bi-trash" /> {{ t('clipEditor.deleteClip') }}
      </button><span class="xm-faint xm-clip-bound">{{ t('clipEditor.boundTo') }} {{ bound || '—' }}</span><button
        class="btn btn-xm"
        @click="close"
      >
        {{ t('picker.cancel') }}
      </button><button
        class="btn btn-primary"
        :disabled="loading || snapping || !valid"
        @click="done"
      >
        {{ t('library.done') }}
      </button>
    </div>
  </dialog>
</template>
