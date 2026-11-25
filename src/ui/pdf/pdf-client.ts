import { getDocument, PDFWorker } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** Each open score owns its worker, including during a cancelled load. */
export function openPdfDocument(url: string) {
  const port = new Worker(workerUrl, { type: 'module' })
  const worker = PDFWorker.create({ port })
  const assets = new URL('/pdf/', window.location.href)
  const options = {
    url,
    worker,
    isEvalSupported: false,
    useSystemFonts: true,
    cMapUrl: new URL('cmaps/', assets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    useWorkerFetch: true,
  }
  const task = getDocument(options)
  return {
    ready: task.promise,
    async close() {
      try { await task.destroy() }
      finally { worker.destroy(); port.terminate() }
    },
  }
}
