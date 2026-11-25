<script setup lang="ts">
import { dragPadSource } from '../bindings/pad-drop'
import { orchestraControls, orchestraDefaults, unsupportedMembers } from '../../shared/orchestra-controls'
import EffectsDialog from "./EffectsDialog.vue"
import { computed, ref, nextTick } from 'vue'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
import { engineBus } from '../bus'
import { addPreset, presets } from '../../shared/orchestra-presets'
import { uniqueId } from '../../shared/ids'
import type { Orchestra, OrchestraMember } from '../../shared/model'
const doc = useProjectStore(),
  runtime = useRuntimeStore(),
  error = ref('')
const track = computed(() =>
  doc.project.tracks.find((t) => t.kind === 'midi' && t.orchestraId),
)
const current = computed(() =>
  doc.project.orchestras?.find(
    (o) =>
      o.id ===
      (runtime.state.orchestras?.[track.value?.id ?? ''] ??
        (track.value?.kind === 'midi' ? track.value.orchestraId : undefined)),
  ),
)
function select(id: string) {
  engineBus.value?.send('action:run', {
    action: { type: 'orchestra', cmd: 'select', orchestraId: id },
  })
}
async function add(event: Event) {
  const el = event.target as HTMLSelectElement,
    id = el.value
  el.value = ''
  if (!id) return
  try {
    const font = (await window.xm.soundfonts.scan()).find((f) => f.gm)
    if (!font)
      throw Error('Add a General MIDI soundfont directory in Soundfonts first.')
    doc.update((p) => {
      let sf = p.soundfonts.find((s) => s.file === font.file)
      if (!sf) {
        sf = {
          id: uniqueId(
            'gm',
            p.soundfonts.map((f) => f.id),
          ),
          file: font.file,
        }
        p.soundfonts.push(sf)
      }
      addPreset(p, id, sf.id)
    })
    await nextTick()
    select(id)
    error.value = ''
  } catch (e) {
    error.value = String(e)
  }
}
function edit(fn: (o: Orchestra) => void) {
  doc.update((p) => {
    const o = p.orchestras?.find((o) => o.id === current.value?.id)
    if (o) fn(o)
  })
}
function value(e: Event) {
  return Number((e.target as HTMLInputElement).value)
}
function member(
  i: number,
  j: number,
  key: keyof Pick<
    OrchestraMember,
    'lo' | 'hi' | 'comfortLo' | 'comfortHi' | 'gain' | 'octave'
  >,
  e: Event,
) {
  edit((o) => {
    const m = o.sections[i].members[j]
    m[key] = value(e)
    m.comfortLo = Math.min(m.hi, Math.max(m.lo, m.comfortLo))
    m.comfortHi = Math.max(m.comfortLo, Math.min(m.hi, m.comfortHi))
  })
}
function dragRange(e: PointerEvent, i: number, j: number, comfort: boolean) {
  const el = e.currentTarget as HTMLElement,
    rect = el.getBoundingClientRect()
  const key = (x: number) =>
    Math.max(0, Math.min(127, Math.round((127 * (x - rect.left)) / rect.width)))
  const start = key(e.clientX),
    m = current.value!.sections[i].members[j]
  const low = comfort ? m.comfortLo : m.lo,
    high = comfort ? m.comfortHi : m.hi
  const edge = Math.abs(start - low) <= Math.abs(start - high) ? 'low' : 'high'
  const move = (event: PointerEvent) => {
    const pitch = key(event.clientX)
    edit((o) => {
      const v = o.sections[i].members[j]
      if (comfort) {
        if (edge === 'low')
          v.comfortLo = Math.min(v.comfortHi, Math.max(v.lo, pitch))
        else v.comfortHi = Math.max(v.comfortLo, Math.min(v.hi, pitch))
      } else {
        if (edge === 'low') v.lo = Math.min(v.hi, pitch)
        else v.hi = Math.max(v.lo, pitch)
        v.comfortLo = Math.min(v.hi, Math.max(v.lo, v.comfortLo))
        v.comfortHi = Math.max(v.comfortLo, Math.min(v.hi, v.comfortHi))
      }
    })
  }
  el.setPointerCapture(e.pointerId)
  el.addEventListener('pointermove', move)
  el.addEventListener(
    'lostpointercapture',
    () => el.removeEventListener('pointermove', move),
    { once: true },
  )
  move(e)
}
</script>
<template>
  <div class="orchestra-panel">
    <select
      aria-label="Add orchestra preset"
      value=""
      @change="add"
    >
      <option value="">
        + Preset
      </option>
      <option
        v-for="(p, id) in presets"
        :key="id"
        :value="id"
      >
        {{ p.name }}
      </option>
    </select>
    <small
      v-if="error"
      role="alert"
    >{{ error }}</small>
    <div>
      <button
        v-for="o in doc.project.orchestras"
        :key="o.id"
        draggable="true"
        title="Select orchestra, or drag to a controller pad"
        :aria-pressed="o.id === current?.id"
        :style="{ borderColor: o.color }"
        @dragstart="dragPadSource($event, 'orchestra:' + o.id)"
        @click="select(o.id)"
      >
        {{ o.name }}
      </button>
    </div>
    <template v-if="current">
      <label>Layers per key
        <select
          :value="current.maxLayers"
          @change="edit((o) => (o.maxLayers = value($event)))"
        >
          <option
            v-for="n in [0, 1, 2, 3, 4, 5, 6, 7, 8]"
            :key="n"
            :value="n"
          >
            {{ n || 'All' }}
          </option>
        </select></label>
      <label>Outside ranges
        <select
          :value="current.outOfRange"
          @change="
            edit(
              (o) =>
                (o.outOfRange = ($event.target as HTMLSelectElement)
                  .value as Orchestra['outOfRange']),
            )
          "
        >
          <option value="silent">Silent</option>
          <option value="nearest">Nearest octave</option>
        </select></label>
      <details
        v-for="(s, i) in current.sections"
        :key="i"
        class="xm-orc-sec"
      >
        <summary
          :draggable="s.register !== null"
          @dragstart="s.register !== null && dragPadSource($event, 'section:' + current.id + ':' + i)"
        >
          {{ s.name }} · {{ s.register === null ? 'Always on' : 'Register ' + (s.register + 1) }}
        </summary>
        <label>Section level
          <input
            type="range"
            min="0"
            max="100"
            :value="Math.round((s.gain ?? 1) * 100)"
            @input="edit(o => { o.sections[i].gain = value($event) / 100 })"
          >
          {{ Math.round((s.gain ?? 1) * 100) }}%
        </label>
        <EffectsDialog
          :orchestra-id="current.id"
          :section="i"
          label="Section effects"
        />
        <div
          v-for="(m, j) in s.members"
          :key="m.instrumentId"
        >
          <label><input
                   type="checkbox"
                   :checked="m.enabled"
                   @change="
                     edit((o) => (o.sections[i].members[j].enabled = !m.enabled))
                   "
                 >
            {{
              doc.project.instruments.find((v) => v.id === m.instrumentId)?.name
            }}</label>
          <div class="range-keyboard">
            <span
              v-for="n in 128"
              :key="n"
              :class="{ accidental: [1, 3, 6, 8, 10].includes((n - 1) % 12) }"
            />
            <div
              v-for="comfort in [false, true]"
              :key="String(comfort)"
              class="range-row"
              :class="{ comfort }"
              :title="
                comfort ? 'Drag comfort range ends' : 'Drag playable range ends'
              "
              @pointerdown.prevent="dragRange($event, i, j, comfort)"
            >
              <i
                :style="{
                  left: (100 * (comfort ? m.comfortLo : m.lo)) / 128 + '%',
                  width:
                    (100 *
                      ((comfort ? m.comfortHi - m.comfortLo : m.hi - m.lo) +
                        1)) /
                    128 +
                    '%',
                }"
              />
            </div>
          </div>
          <label>Balance by
            <select
              :value="m.balance ?? 'volume'"
              @change="edit(o => { o.sections[i].members[j].balance = ($event.target as HTMLSelectElement).value as OrchestraMember['balance'] })"
            >
              <option value="volume">Volume</option>
              <option value="velocity">Velocity</option>
              <option value="both">Volume and velocity</option>
            </select>
          </label>
          <label
            v-for="k in [
              'lo',
              'hi',
              'comfortLo',
              'comfortHi',
              'octave',
              'gain',
            ] as const"
            :key="k"
          >{{
             {
               lo: 'Low',
               hi: 'High',
               comfortLo: 'Comfort low',
               comfortHi: 'Comfort high',
               octave: 'Octave',
               gain: 'Proportion',
             }[k]
           }}
            <input
              type="range"
              :min="
                k === 'hi'
                  ? m.lo
                  : k === 'comfortLo'
                    ? m.lo
                    : k === 'comfortHi'
                      ? m.comfortLo
                      : k === 'octave'
                        ? -5
                        : 0
              "
              :max="
                k === 'lo'
                  ? m.hi
                  : k === 'comfortLo'
                    ? m.comfortHi
                    : k === 'comfortHi'
                      ? m.hi
                      : k === 'octave'
                        ? 5
                        : k === 'gain'
                          ? 2
                          : 127
              "
              :step="k === 'gain' ? 0.05 : 1"
              :value="m[k]"
              @input="member(i, j, k, $event)"
            >
            {{ k === 'gain' ? Math.round(m.gain * 100) + '%' : m[k] }}
          </label>
        </div>
      </details>
      <div class="xm-macro">
        <label
          v-for="key in orchestraControls"
          :key="key"
          class="xm-knob"
          :style="{'--v':current.fx?.[key] ?? orchestraDefaults[key]}"
          :title="unsupportedMembers(doc.project,current,key).map(i=>i.name + ' has no matching plugin control').join(', ')"
        >
          <i aria-hidden="true" />
          {{ {volume:'Volume',reverb:'Hall reverb',chorus:'Chorus',brightness:'Brightness'}[key] }}
          <input
            type="range"
            :aria-label="'Orchestra ' + key"
            min="0"
            max="100"
            :disabled="!!unsupportedMembers(doc.project,current,key).length"
            :value="Math.round((current.fx?.[key] ?? orchestraDefaults[key]) * 100)"
            @input="edit(o=>{o.fx={...o.fx,[key]:value($event)/100}})"
          >
          <output>{{ Math.round((current.fx?.[key] ?? orchestraDefaults[key]) * 100) }}%</output>
        </label>
      </div>
      <EffectsDialog
        :orchestra-id="current.id"
        label="Effects chain"
      />
    </template>
  </div>
</template>
<style scoped>
.xm-macro { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; }
.xm-macro .xm-knob { width:100%; min-height:48px; position:relative; }
.xm-macro input[type=range] { position:absolute; inset:0; width:100%; height:100%; margin:0; opacity:0; cursor:ew-resize; }
.xm-macro label:focus-within { outline:2px solid var(--xm-accent); border-radius:4px; }
.xm-macro label:has(input:disabled) { opacity:.55; }
.xm-macro output { font-variant-numeric:tabular-nums; }
.xm-orc-sec { border:1px solid var(--xm-border); border-radius:6px; }
.xm-orc-sec summary { padding:8px; cursor:pointer; }

.orchestra-panel {
  display: grid;
  gap: 6px;
}
.orchestra-panel label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.orchestra-panel input[type='range'] {
  flex: 1;
  min-width: 30px;
}
.orchestra-panel details > div {
  padding: 6px;
  border-bottom: 1px solid var(--xm-border);
}
button[aria-pressed='true'] {
  font-weight: bold;
}
.range-keyboard {
  height: 32px;
  position: relative;
  display: flex;
  background: #bcc3ca;
  margin: 5px 0;
}
.range-keyboard span {
  flex: 1;
  border-right: 1px solid #66707a;
}
.range-keyboard .accidental {
  background: #202831;
  height: 65%;
}
.range-row {
  position: absolute;
  inset: 0 0 50%;
  touch-action: none;
  cursor: ew-resize;
}
.range-row.comfort {
  inset: 50% 0 0;
}
.range-row i {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: #2784bfbb;
  border-inline: 2px solid #a8e4ff;
}
.comfort i {
  background: #26836ebb;
  border-color: #acf6d6;
}
</style>
