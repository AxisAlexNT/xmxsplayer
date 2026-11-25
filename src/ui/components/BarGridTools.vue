<script setup lang="ts">
import { useI18n } from '../i18n'
const { t } = useI18n()
import { computed, ref } from 'vue'
import { editTempo } from '../../shared/bar-edit'
import { useSettingsStore } from '../stores/settings'
import { TimeMap } from '../../shared/time-map'
import { fitAudioLength, snapLoop } from '../../shared/beat-grid'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  unit = ref<'beat' | 'bar'>('beat')
const map = computed(() => new TimeMap(doc.project)),
  audio = computed(() => doc.project.tracks.filter((t) => t.kind === 'audio')),
  selected = computed({
    get: () =>
      runtime.selectedAudioId &&
      audio.value.some((t) => t.id === runtime.selectedAudioId)
        ? runtime.selectedAudioId
        : (audio.value[0]?.id ?? ''),
    set: (id: string) => {
      runtime.selectedAudioId = id
    },
  })
const settings=useSettingsStore()
const error=ref('')
function tempo(value: number): void {
  try {
    const next=editTempo(doc.project,runtime.transport.tick,value,settings.value.tempoMode??'scale')
    doc.update(()=>next)
    error.value=''
  } catch(e){error.value=String(e instanceof Error?e.message:e)}
}
function tapMap(active: boolean, discard = false): void {
  engineBus.value?.send('grid:tapMap', {
    active,
    trackId: selected.value,
    unit: unit.value,
    discard,
  })
}
function clear(): void {
  doc.update((d) => {
    d.tempos = map.value.tempos.map(({tick,bpm}) => ({tick,bpm}))
    d.beatAnchors = []
    d.lengthTicks = fitAudioLength(d)
  })
}
</script>
<template>
  <details class="xm-grid-tools">
    <summary
      :title="t('control.barGrid')"
      :aria-label="t('control.barGrid')"
    >
      <i class="bi bi-rulers" /> {{ t('control.bars') }} <i class="bi bi-chevron-down" />
    </summary>
    <div class="xm-grid-popover">
      <span
        v-if="error"
        role="alert"
      >{{ error }}</span><b>{{ t('control.barGrid') }}</b><span
        v-if="doc.project.mapOwner !== null"
        class="xm-muted"
      >{{ t('control.tempoComesFromTheLinkedScore') }}</span>
      <fieldset :disabled="doc.project.mapOwner !== null">
        <label>{{ t('control.bpm') }}<input
          type="number"
          min="20"
          max="400"
          step=".1"
          :value="map.tempoAt(runtime.transport.tick).toFixed(1)"
          :disabled="!!doc.project.beatAnchors.length"
          :aria-label="t('control.gridBpm')"
          @change="tempo(Number(($event.target as HTMLInputElement).value))"
        ></label>
        <div class="xm-row">
          <button
            class="btn btn-sm btn-xm"
            :disabled="!!doc.project.beatAnchors.length"
            @click="tempo(map.tempoAt(runtime.transport.tick)*0.5)"
          >
            {{ t('control.halve') }}
          </button><button
            class="btn btn-sm btn-xm"
            :disabled="!!doc.project.beatAnchors.length"
            @click="tempo(map.tempoAt(runtime.transport.tick)*2)"
          >
            {{ t('control.double') }}
          </button><button
            class="btn btn-sm btn-xm"
            @click="
              engineBus?.send('action:run', {
                action: { type: 'transport', cmd: 'tap' },
              })
            "
          >
            {{ t('control.tapTempo') }}
          </button>
        </div>
        <label>{{ t('control.reference') }}<select
          v-model="selected"
          :disabled="runtime.tapMap.active"
          :aria-label="t('control.gridReference')"
        >
          <option
            v-for="track in audio"
            :key="track.id"
            :value="track.id"
          >
            {{ track.name }}
          </option>
          <option
            v-if="!audio.length"
            value=""
          >{{ t('control.importAudioFirst') }}</option>
        </select></label>
        <button
          class="btn btn-sm btn-xm"
          :disabled="!selected"
          @click="engineBus?.send('grid:barOne', { trackId: selected })"
        >
          {{ t('control.setBar1AtPlayhead') }}
        </button>
        <div class="xm-row">
          <select
            v-model="unit"
            :disabled="runtime.tapMap.active"
            :aria-label="t('control.tapMapUnit')"
          >
            <option value="beat">
              {{ t('control.tapBeats') }}
            </option>
            <option value="bar">
              {{ t('control.tapBars') }}
            </option>
          </select><button
            v-if="!runtime.tapMap.active"
            class="btn btn-sm btn-xm"
            :disabled="!selected || doc.project.loop.enabled"
            :title="t('control.turnLoopingOffStartAudioThenTapEachBeatOrBar')"
            @click="tapMap(true)"
          >
            {{ t('control.tapBeatMap') }}
          </button><button
            v-else
            class="btn btn-sm btn-primary"
            :disabled="runtime.tapMap.anchors.length < 2"
            @click="tapMap(false)"
          >
            {{ t('control.use') }} {{ runtime.tapMap.anchors.length }} {{ t('control.taps') }}
          </button>
        </div>
        <div
          v-if="runtime.tapMap.active"
          class="xm-row"
        >
          <button
            class="btn btn-primary"
            :disabled="
              !runtime.transport.playing || !!runtime.transport.countInBeat
            "
            @click="
              engineBus?.send('action:run', {
                action: { type: 'transport', cmd: 'tapBeat' },
              })
            "
          >
            {{ t('control.tapBeat') }}
          </button><button
            class="btn btn-sm btn-ghost"
            @click="tapMap(false, true)"
          >
            {{ t('control.cancel') }}
          </button><small>{{ runtime.tapMap.anchors.length }} {{ t('control.taps') }}</small>
        </div>
        <small v-if="runtime.tapMap.active">{{ t('control.startAudioThenTapTheFirstTapMarksBar1FinishToApplyTheMap') }}</small>
        <button
          v-if="doc.project.beatAnchors.length"
          class="btn btn-sm btn-ghost"
          @click="clear"
        >
          {{ t('control.clearBeatMap') }}
        </button>
      </fieldset>
      <hr>
      <b>{{ t('control.metronome') }}</b><label><input
                                                  type="checkbox"
                                                  :checked="doc.project.metronome.audible"
                                                  @change="
                                                    doc.update((d) => {
                                                      d.metronome.audible = ($event.target as HTMLInputElement).checked
                                                    })
                                                  "
                                                >
        {{ t('control.audibleClick') }}</label><label><input
                                                      type="checkbox"
                                                      :checked="doc.project.metronome.visualScreen"
                                                      @change="
                                                        doc.update((d) => {
                                                          d.metronome.visualScreen = (
                                                            $event.target as HTMLInputElement
                                                          ).checked
                                                        })
                                                      "
                                                    >
        {{ t('control.screenBeats') }}</label><label><input
                                                     type="checkbox"
                                                     :checked="doc.project.metronome.visualPads"
                                                     @change="
                                                       doc.update((d) => {
                                                         d.metronome.visualPads = (
                                                           $event.target as HTMLInputElement
                                                         ).checked
                                                       })
                                                     "
                                                   >
        {{ t('control.padBeats') }}</label><label><input
                                                  type="checkbox"
                                                  :checked="doc.project.metronome.toCue"
                                                  @change="
                                                    doc.update((d) => {
                                                      d.metronome.toCue = ($event.target as HTMLInputElement).checked
                                                    })
                                                  "
                                                >
        {{ t('control.clickToCue') }}</label><label>{{ t('control.countIn') }}<select
        :value="doc.project.metronome.countInBars"
        :aria-label="t('control.countInBars')"
        @change="
          doc.update((d) => {
            d.metronome.countInBars = Number(
              ($event.target as HTMLSelectElement).value,
            )
          })
        "
      >
        <option
          v-for="bars in [0, 1, 2, 4]"
          :key="bars"
          :value="bars"
        >
          {{ bars ? `${bars} bar${bars === 1 ? '' : 's'}` : 'Off' }}
        </option>
      </select></label>
      <hr>
      <button
        class="btn btn-sm btn-xm"
        @click="
          doc.update((d) => {
            d.loop = snapLoop(map, d.loop)
          })
        "
      >
        {{ t('control.snapLoopToBars') }}
      </button>
    </div>
  </details>
</template>
