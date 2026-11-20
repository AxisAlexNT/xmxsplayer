<script setup lang="ts">
import {computed,ref,nextTick} from 'vue'
import {useProjectStore} from '../stores/project'
import {useRuntimeStore} from '../stores/runtime'
import {engineBus} from '../bus'
import {addPreset,presets} from '../../shared/orchestra-presets'
import {uniqueId} from '../../shared/ids'
import type {Orchestra,OrchestraMember} from '../../shared/model'
const doc=useProjectStore(),runtime=useRuntimeStore(),error=ref('')
const track=computed(()=>doc.project.tracks.find(t=>t.kind==='midi' && t.orchestraId))
const current=computed(()=>doc.project.orchestras?.find(o=>o.id===(runtime.state.orchestras?.[track.value?.id ?? ''] ?? (track.value?.kind==='midi'?track.value.orchestraId:undefined))))
function select(id:string){engineBus.value?.send('action:run',{action:{type:'orchestra',cmd:'select',orchestraId:id}})}
async function add(event:Event){
 const el=event.target as HTMLSelectElement,id=el.value; el.value=''
 if(!id)return
 try{
 const font=(await window.xm.soundfonts.scan()).find(f=>f.gm)
 if(!font)throw Error('Add a General MIDI soundfont directory in Soundfonts first.')
 doc.update(p=>{
 let sf=p.soundfonts.find(s=>s.file===font.file)
 if(!sf){sf={id:uniqueId('gm',p.soundfonts.map(f=>f.id)),file:font.file};p.soundfonts.push(sf)}
 addPreset(p,id,sf.id)
 })
 await nextTick(); select(id);error.value=''
 }catch(e){error.value=String(e)}
}
function edit(fn:(o:Orchestra)=>void){doc.update(p=>{const o=p.orchestras?.find(o=>o.id===current.value?.id);if(o)fn(o)})}
function value(e:Event){return Number((e.target as HTMLInputElement).value)}
function member(i:number,j:number,key:keyof Pick<OrchestraMember,'lo'|'hi'|'comfortLo'|'comfortHi'|'gain'|'octave'>,e:Event){
 edit(o=>{const m=o.sections[i].members[j];m[key]=value(e);m.comfortLo=Math.min(m.hi,Math.max(m.lo,m.comfortLo));m.comfortHi=Math.max(m.comfortLo,Math.min(m.hi,m.comfortHi))})
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
      </option><option
        v-for="(p,id) in presets"
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
        :aria-pressed="o.id===current?.id"
        :style="{borderColor:o.color}"
        @click="select(o.id)"
      >
        {{ o.name }}
      </button>
    </div>
    <template v-if="current">
      <label>Max layers <select
        :value="current.maxLayers"
        @change="edit(o=>o.maxLayers=value($event))"
      ><option
        v-for="n in [0,1,2,3,4,5,6,7,8]"
        :key="n"
        :value="n"
      >{{ n || 'All' }}</option></select></label>
      <label>Outside ranges <select
        :value="current.outOfRange"
        @change="edit(o=>o.outOfRange=($event.target as HTMLSelectElement).value as Orchestra['outOfRange'])"
      ><option value="silent">Silent</option><option value="nearest">Nearest octave</option></select></label>
      <details
        v-for="(s,i) in current.sections"
        :key="i"
      >
        <summary>{{ s.name }} · Register {{ (s.register ?? 0)+1 }}</summary>
        <div
          v-for="(m,j) in s.members"
          :key="m.instrumentId"
        >
          <label><input
            type="checkbox"
            :checked="m.enabled"
            @change="edit(o=>o.sections[i].members[j].enabled=!m.enabled)"
          > {{ doc.project.instruments.find(v=>v.id===m.instrumentId)?.name }}</label>
          <label
            v-for="k in (['lo','hi','comfortLo','comfortHi','octave','gain'] as const)"
            :key="k"
          >{{ {lo:'Low',hi:'High',comfortLo:'Comfort low',comfortHi:'Comfort high',octave:'Octave',gain:'Gain'}[k] }}
            <input
              type="range"
              :min="k==='hi'? m.lo : k==='comfortLo'?m.lo:k==='comfortHi'?m.comfortLo:k==='octave'?-5:0"
              :max="k==='lo'?m.hi:k==='comfortLo'?m.comfortHi:k==='comfortHi'?m.hi:k==='octave'?5:k==='gain'?2:127"
              :step="k==='gain'?0.05:1"
              :value="m[k]"
              @input="member(i,j,k,$event)"
            > {{ m[k] }}
          </label>
        </div>
      </details>
    </template>
  </div>
</template>
<style scoped>
.orchestra-panel {display:grid;gap:6px}.orchestra-panel label {display:flex;align-items:center;gap:4px}.orchestra-panel input[type=range]{flex:1;min-width:30px}.orchestra-panel details>div{padding:6px;border-bottom:1px solid var(--xm-border)}button[aria-pressed=true]{font-weight:bold}
</style>
