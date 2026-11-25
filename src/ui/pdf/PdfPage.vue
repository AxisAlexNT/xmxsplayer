<script setup lang="ts">
import { ref, watch } from 'vue'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api'
import { AnnotationMode } from 'pdfjs-dist'

const props = defineProps<{ pdf: PDFDocumentProxy; page: number; width: number }>()
const emit = defineEmits<{ error: [error: unknown] }>()
const canvas = ref<HTMLCanvasElement>()
watch(() => [props.pdf, props.page, props.width, canvas.value] as const,
  ([pdf, number, width, target], _, cleanup) => {
    if (!target || width <= 0) return
    let cancelled = false
    let task: RenderTask | undefined
    cleanup(() => { cancelled = true; task?.cancel() })
    async function draw(surface: HTMLCanvasElement) {
      const page = await pdf.getPage(number)
      if (cancelled) return
      const base = page.getViewport({scale:1})
      const viewport = page.getViewport({scale:width / base.width * window.devicePixelRatio})
      surface.width = Math.ceil(viewport.width)
      surface.height = Math.ceil(viewport.height)
      task = page.render({canvas:surface, viewport, annotationMode:AnnotationMode.DISABLE})
      await task.promise
    }
    void draw(target).catch(error => { if (!cancelled) emit('error', error) })
  }, { immediate:true, flush:'post' })
</script>
<template>
  <canvas ref="canvas" />
</template>
<style scoped>
canvas { display:block; width:100%; height:auto; }
</style>
