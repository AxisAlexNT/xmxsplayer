import { blend, type Builder } from './stage'
export const reverb: Builder = (ctx, { params }) => {
  const node = ctx.createConvolver()
  const worker = new Worker(new URL('./reverb.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>[]>) => {
    const channels = event.data
    const buffer = ctx.createBuffer(2, channels[0].length, ctx.sampleRate)
    channels.forEach((data, index) => buffer.copyToChannel(data, index))
    node.buffer = buffer
    worker.terminate()
  }
  worker.postMessage({ sampleRate: ctx.sampleRate, params })
  return blend(
    ctx,
    {
      input: node,
      output: node,
      close() {
        worker.terminate()
      },
    },
    params.mix,
  )
}
