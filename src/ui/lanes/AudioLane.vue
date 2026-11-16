<script setup lang="ts">
import { computed,inject,onMounted,onUnmounted,ref,watch } from 'vue'
import type { AudioTrack } from '../../shared/model'
import { PEAK_FRAMES } from '../../shared/audio'
import { TimeMap } from '../../shared/time-map'
import { timelineKey } from '../timeline/context'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'
const props=defineProps<{track:AudioTrack;height:number}>(),doc=useProjectStore(),runtime=useRuntimeStore(),timeline=inject(timelineKey)!,canvas=ref<HTMLCanvasElement>(),previewOffset=ref<number|null>(null)
const offset=computed(()=>previewOffset.value??props.track.offsetSec),error=computed(()=>runtime.audioStates[props.track.id]?.error)
let previousAxis:unknown
let visible=true,observer:IntersectionObserver|undefined,cache=new Map<number,HTMLCanvasElement>(),key=''
function draw():void{
 if(!visible||!canvas.value)return
 const axis=timeline.axis.value,frame=timeline.frame.value,w=axis.pageWidth,h=props.height,dpr=devicePixelRatio||1,el=canvas.value,data=runtime.audioPeaks[props.track.id],map=new TimeMap(doc.project)
 if(el.width!==Math.round(w*dpr)||el.height!==Math.round(h*dpr)){el.width=Math.round(w*dpr);el.height=Math.round(h*dpr)}
 const nextKey=JSON.stringify([data?.key,w,h,offset.value,doc.project.tempos,doc.project.beatAnchors,doc.project.timeSigs,doc.project.view.pxPerQuarter]);if(key!==nextKey||previousAxis!==axis){key=nextKey;previousAxis=axis;cache.clear()}
 const ctx=el.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h)
 for(const page of frame.pages){let image=cache.get(page);if(!image){image=document.createElement('canvas');image.width=Math.round(w*dpr);image.height=Math.round(h*dpr);const c=image.getContext('2d')!;c.scale(dpr,dpr);c.fillStyle='#13212c';c.fillRect(0,0,w,h)
  const[start,end]=axis.pageRange(page);for(const measure of (axis.measures?.(page)??map.measures(start,end))){const x=(axis.measureX?.(measure.start,page)??axis.xInPage(measure.start,page));c.strokeStyle='#34434f';c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}
  if(data){c.fillStyle=props.track.color;c.globalAlpha=.55;for(let x=96;x<w;x++){const from=(map.tickToSec(axis.tickAt(page,x))-offset.value)*data.sampleRate/PEAK_FRAMES,to=(map.tickToSec(axis.tickAt(page,x+1))-offset.value)*data.sampleRate/PEAK_FRAMES;if(to<0||from>=data.peaks.length)continue;let amplitude=0;for(let i=Math.max(0,Math.floor(from));i<=Math.min(data.peaks.length-1,Math.ceil(to));i++)amplitude=Math.max(amplitude,data.peaks[i]);const a=Math.max(.5,amplitude*(h/2-6));c.fillRect(x,h/2-a,1,a*2)}}cache.set(page,image);for(const old of cache.keys())if(!frame.pages.includes(old))cache.delete(old)}ctx.drawImage(image,page*w-frame.offset,0,w,h)}
}
function tickAt(event:PointerEvent):number{const a=timeline.axis.value,x=event.clientX-canvas.value!.getBoundingClientRect().left+timeline.frame.value.offset,page=Math.max(0,Math.min(a.pageCount-1,Math.floor(x/a.pageWidth)));return a.tickAt(page,x-page*a.pageWidth)}
function drag(event:PointerEvent):void{
 if(event.button!==0||event.shiftKey)return
 event.preventDefault();const target=canvas.value!,map=new TimeMap(doc.project),start=map.tickToSec(tickAt(event)),initial=props.track.offsetSec;target.setPointerCapture(event.pointerId)
 const move=(e:PointerEvent):void=>{previewOffset.value=initial+map.tickToSec(tickAt(e))-start}
 const cleanup=():void=>{previewOffset.value=null;target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',cancel)}
 const up=():void=>{if(previewOffset.value!==null){const value=previewOffset.value;doc.update(d=>{const t=d.tracks.find(t=>t.id===props.track.id);if(t?.kind==='audio'){t.offsetSec=value;d.lengthTicks=Math.max(d.lengthTicks,Math.ceil(map.secToTick(value+t.durationSec)))}})}cleanup()};const cancel=():void=>cleanup();target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',cancel)
}
watch(()=>timeline.frame.value,draw,{flush:'post'})
onMounted(()=>{observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)draw()});observer.observe(canvas.value!);draw()})
onUnmounted(()=>observer?.disconnect())
</script>
<template>
  <div class="xm-lane xm-audio-lane">
    <canvas
      ref="canvas"
      class="xm-roll-canvas"
      :aria-label="`${track.name} waveform`"
      title="Drag to move audio · Shift-drag to set loop"
      @pointerdown="drag"
    /><span
      v-if="error"
      class="xm-audio-error"
      role="alert"
    >{{ error }}</span><span
      v-else-if="runtime.audioStates[track.id]?.loading"
      class="xm-roll-label"
    >Loading audio…</span><span
      v-if="previewOffset!==null"
      class="xm-roll-label"
    >{{ offset.toFixed(3) }} s</span>
  </div>
</template>
