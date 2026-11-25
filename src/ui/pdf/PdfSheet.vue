<script setup lang="ts">
import { pendingSheetCommands } from './actions'
import { watch, ref } from 'vue'
import type { PdfDocument } from '../../shared/model'
import { useProjectStore } from '../stores/project'
import { t } from '../i18n'
import PdfViewport from './PdfViewport.vue'

const props = defineProps<{ sheet: PdfDocument; bar: number }>()
const doc = useProjectStore()
const viewport = ref<InstanceType<typeof PdfViewport>>()
const pages = ref({first:0,last:0,total:0})
const error = ref('')
watch(() => [pendingSheetCommands.value, pages.value.total, props.sheet.id] as const, () => {
  if (!pages.value.total) return
  const list = pendingSheetCommands.value
  const remaining = list.filter(cmd => cmd.folder !== doc.folder || cmd.id !== props.sheet.id || !viewport.value?.navigate(cmd.action))
  if (remaining.length !== list.length) pendingSheetCommands.value = remaining
}, {immediate:true})
function edit(changes: Partial<PdfDocument>, group?: string) {
  doc.update(project => {
    const sheet = project.documents?.find(item => item.id === props.sheet.id)
    if (sheet) Object.assign(sheet,changes)
  },group)
}
function mark() {
  const marker = viewport.value?.markerHere()
  if (marker) edit({markers:[...(props.sheet.markers ?? []).filter(m => m.bar !== marker.bar),marker].sort((a,b)=>a.bar-b.bar)})
}
</script>
<template>
  <section
    class="pdf-sheet"
    @wheel.stop
    @pointerdown.stop
  >
    <header>
      <slot />
      <strong>{{ sheet.name }}</strong>
      <button
        :aria-pressed="sheet.theme==='night'"
        @click="edit({theme:sheet.theme==='night'?'light':'night'})"
      >
        {{ t('pdf.night') }}
      </button>
      <select
        :aria-label="t('pdf.columns')"
        :value="sheet.cols"
        @change="edit({cols:Number(($event.target as HTMLSelectElement).value) as PdfDocument['cols']})"
      >
        <option
          v-for="n in [1,2,3]"
          :key="n"
          :value="n"
        >
          {{ t('pdf.columnCount',{count:n}) }}
        </option>
      </select>
      <select
        :aria-label="t('pdf.zoom')"
        :value="sheet.zoom"
        @change="edit({zoom:($event.target as HTMLSelectElement).value==='fit'?'fit':Number(($event.target as HTMLSelectElement).value)})"
      >
        <option value="fit">
          {{ t('pdf.fit') }}
        </option>
        <option
          v-for="z in [0.75,1,1.25,1.5,2]"
          :key="z"
          :value="z"
        >
          {{ z*100 }}%
        </option>
      </select>
      <span v-if="pages.total">{{ t('pdf.pages',{first:pages.first,last:pages.last,total:pages.total}) }}</span>
      <button
        :aria-pressed="!!sheet.follow"
        @click="edit({follow:!sheet.follow})"
      >
        {{ t('pdf.follow') }}
      </button>
      <button
        :disabled="!pages.total"
        @click="mark"
      >
        {{ t('pdf.marker') }}
      </button>
    </header>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
    <PdfViewport
      ref="viewport"
      :sheet="sheet"
      :folder="doc.folder"
      :bar="bar"
      @error="error=String($event)"
      @pages="(first,last,total)=>pages={first,last,total}"
      @scroll="value=>value!==sheet.scroll && edit({scroll:value},'pdf-scroll-'+sheet.id)"
    />
  </section>
</template>
<style scoped>
.pdf-sheet { display:flex; flex-direction:column; height:300px; min-height:140px; resize:vertical; overflow:hidden; border-bottom:1px solid var(--xm-border); }
header { display:flex; flex-wrap:wrap; align-items:center; gap:.4rem; padding:.3rem .5rem; background:var(--xm-bg-1); }
header strong { margin-right:auto; }
button[aria-pressed=true] { color:var(--xm-accent); }
.pdf-sheet :deep(.pdf-scroll) { flex:1; }
</style>
