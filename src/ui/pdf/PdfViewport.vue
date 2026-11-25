<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'
import type { PdfAction, PdfDocument } from '../../shared/model'
import { openPdfDocument } from './pdf-client'
import { markerAtLine, markerForBar, markerScroll, pagePositions, renderPages } from './layout'
import PdfPage from './PdfPage.vue'

const props = defineProps<{ sheet: PdfDocument; folder: string; bar: number }>()
const emit = defineEmits<{
  scroll: [position: number]
  pages: [first: number, last: number, total: number]
  error: [reason: unknown]
}>()
const root = ref<HTMLElement>()
const pdf = shallowRef<PDFDocumentProxy>()
const ratios = shallowRef<number[]>([])
const width = ref(0)
const viewportHeight = ref(0)
const visible = shallowRef(new Set<number>())
const live = computed(() => renderPages(visible.value, ratios.value.length))
const gap = 8
const pageWidth = computed(() => Math.max(1,(width.value-gap*(props.sheet.cols-1))/props.sheet.cols) *
  (props.sheet.zoom === 'fit' ? 1 : props.sheet.zoom))
const heights = computed(() => ratios.value.map(ratio => ratio*pageWidth.value))
const layout = computed(() => pagePositions(heights.value,props.sheet.cols,gap))
const renderWidth = ref(0)
watch(pageWidth, (value, _, cleanup) => {
  const timer = setTimeout(() => { renderWidth.value = value }, 100)
  cleanup(() => clearTimeout(timer))
}, { immediate: true })
let observer: IntersectionObserver | undefined
let resize: ResizeObserver | undefined
const restored = ref(false)
let animation = 0
function stopAnimation() { cancelAnimationFrame(animation) }
function observePages() {
  observer?.disconnect()
  if (!root.value) return
  const current = new Set<number>()
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const page = Number((entry.target as HTMLElement).dataset.page)
      if (entry.isIntersecting) current.add(page)
      else current.delete(page)
    }
    visible.value = new Set(current)
    if (current.size) emit('pages',Math.min(...current),Math.max(...current),ratios.value.length)
  }, {root:root.value})
  for (const el of root.value.querySelectorAll('[data-page]')) observer.observe(el)
}
watch([() => props.folder, () => props.sheet.file], async (_, __, cleanup) => {
  let cancelled = false
  let session: ReturnType<typeof openPdfDocument> | undefined
  cleanup(() => {
    cancelled = true
    stopAnimation()
    observer?.disconnect()
    if (session) void session.close().catch(error => emit('error', error))
  })
  restored.value = false
  pdf.value = undefined
  ratios.value = []
  visible.value = new Set()
  try {
    const url = await window.xm.project.urlFor(props.sheet.file)
    if (cancelled) return
    session = openPdfDocument(url)
    const doc = await session.ready
    const sizes: number[] = []
    for (let page = 1; page <= doc.numPages; page++) {
      if (cancelled) return
      const viewport = (await doc.getPage(page)).getViewport({scale:1})
      sizes.push(viewport.height / viewport.width)
    }
    if (cancelled) return
    pdf.value = doc
    ratios.value = sizes
    await nextTick()
    if (cancelled || !root.value) return
    restorePosition()
  } catch (error) { if (!cancelled) emit('error',error) }
}, {immediate:true})
function restorePosition() {
  if (restored.value || !root.value || !pdf.value || !width.value || !root.value.clientHeight) return
  root.value.scrollTop = props.sheet.scroll
  restored.value = true
  observePages()
}
onMounted(() => {
  if (!root.value) return
  width.value = root.value.clientWidth
  viewportHeight.value = root.value.clientHeight
  resize = new ResizeObserver(async () => {
    if (root.value) {
      width.value = root.value.clientWidth
      viewportHeight.value = root.value.clientHeight
    }
    await nextTick()
    restorePosition()
  })
  resize.observe(root.value)
})
onBeforeUnmount(() => { stopAnimation(); resize?.disconnect(); observer?.disconnect() })
const activeMarker = computed(() => props.sheet.follow && markerForBar(props.sheet.markers ?? [],props.bar))
watch([activeMarker,layout,restored,viewportHeight], ([marker, bounds]) => {
  stopAnimation()
  const el = root.value
  if (!marker || !el || !restored.value) return
  const target = markerScroll(marker,bounds.tops,heights.value,el.clientHeight,bounds.height)
  if (target === undefined) return
  const start = performance.now(), from = el.scrollTop
  function move(now: number) {
    const progress = Math.min(1,(now-start)/300)
    el!.scrollTop = from + (target!-from)*(1-(1-progress)**3)
    if (progress < 1) animation = requestAnimationFrame(move)
  }
  animation = requestAnimationFrame(move)
})
function pageTo(page: number) {
  stopAnimation()
  if (root.value && layout.value.tops[page-1] !== undefined)
    root.value.scrollTop = layout.value.tops[page-1]
}
function markerHere() {
  const el = root.value
  if (!el || !ratios.value.length) return
  const line = el.scrollTop + el.clientHeight/4
  return markerAtLine(props.bar, line, layout.value.tops, heights.value)
}
function navigate(action: PdfAction) {
  const el = root.value
  if (!el || !restored.value) return false
  stopAnimation()
  if (action.cmd === 'scroll') el.scrollTop += action.amount ?? 160
  else if (action.cmd === 'next' || action.cmd === 'prev') {
    const tops = layout.value.tops
    const pos = el.scrollTop
    const next = action.cmd === 'next' ? tops.find(y => y > pos+1) : [...tops].reverse().find(y => y < pos-1)
    el.scrollTop = next ?? (action.cmd === 'next' ? el.scrollHeight : 0)
  }
  return true
}
defineExpose({pageTo,markerHere,navigate})
</script>
<template>
  <div
    ref="root"
    class="pdf-scroll"
    @scroll="restored && root && emit('scroll',root.scrollTop)"
    @wheel.passive="stopAnimation"
    @pointerdown="stopAnimation"
  >
    <div
      class="pdf-grid"
      :class="{night:sheet.theme==='night'}"
      :style="{gridTemplateColumns:'repeat('+sheet.cols+', '+pageWidth+'px)'}"
    >
      <div
        v-for="(height,index) in heights"
        :key="index"
        :data-page="index+1"
        class="pdf-page"
        :style="{height:height+'px'}"
      >
        <PdfPage
          v-if="pdf && live.includes(index+1) && renderWidth>0"
          :pdf="pdf"
          :width="renderWidth"
          :page="index+1"
          @error="emit('error',$event)"
        />
      </div>
    </div>
  </div>
</template>
<style scoped>
.pdf-scroll { height:100%; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; }
.pdf-grid { display:grid; align-items:start; gap:8px; }
.pdf-page { background:white; overflow:hidden; }
.night .pdf-page { filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.95); }
</style>
