import type { VerovioModuleFactory } from 'verovio'
import type { VerovioToolkit } from 'verovio/esm'
import { VerovioHost } from './verovio-host'
import type { NotationRequest, NotationResponse } from './protocol'
const host = (async (): Promise<VerovioHost> => {
  const base = new URL('/notation/', self.location.origin)
  const [{ default: create }, { VerovioToolkit: Toolkit }] = await Promise.all([
    import(
      /* @vite-ignore */ new URL('verovio-module.mjs', base).href
    ) as Promise<{ default: VerovioModuleFactory }>,
    import(/* @vite-ignore */ new URL('verovio.mjs', base).href) as Promise<{
      VerovioToolkit: typeof VerovioToolkit
    }>,
  ])
  return new VerovioHost(new Toolkit(await create()))
})()
let work = Promise.resolve()
self.onmessage = ({ data }: MessageEvent<NotationRequest>): void => {
  work = work.then(async () => {
    try {
      const renderer = await host
      const result =
        data.cmd === 'load'
          ? renderer.load(data.data.musicxml, data.data.options)
          : data.cmd === 'render'
            ? renderer.render(data.data.page)
            : data.cmd === 'relayout'
              ? renderer.relayout(data.data)
              : renderer.midi()
      self.postMessage({ id: data.id, data: result } satisfies NotationResponse)
    } catch (error) {
      self.postMessage({
        id: data.id,
        error: String(error),
      } satisfies NotationResponse)
    }
  })
}
