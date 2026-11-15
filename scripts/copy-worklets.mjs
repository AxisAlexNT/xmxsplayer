import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform } from 'sucrase'

const destination = new URL('../src/engine/public/worklets/', import.meta.url)
await mkdir(destination, { recursive: true })
await copyFile(
  new URL(
    '../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js',
    import.meta.url,
  ),
  new URL('spessasynth_processor.min.js', destination),
)
await copyFile(
  new URL('../node_modules/spessasynth_lib/LICENSE', import.meta.url),
  new URL('SpessaSynth-LICENSE.txt', destination),
)
console.log(`Copied synth worklet to ${fileURLToPath(destination)}`)

const stretch = await readFile(
  new URL(
    '../node_modules/signalsmith-stretch/SignalsmithStretch.mjs',
    import.meta.url,
  ),
  'utf8',
)
const marker = 'registerProcessor(audioNodeKey, WasmProcessor);'
if (stretch.split(marker).length !== 2)
  throw Error('Unsupported stretch processor registration')
const extension = transform(
  await readFile(
    new URL('../src/engine/clips/stretch-plan.ts', import.meta.url),
    'utf8',
  ),
  { transforms: ['typescript'] },
).code.replace('export function installClipPlan', 'function installClipPlan')
const readyMarker = "this.port.postMessage(['ready', methodArgCounts]);"
if (stretch.split(readyMarker).length !== 2)
  throw Error('Unsupported stretch processor handshake')
await writeFile(
  new URL('signalsmith-stretch.mjs', destination),
  stretch
    .replace(marker, `${extension}\n${marker}`)
    .replace(readyMarker, `installClipPlan(this);\n${readyMarker}`),
)

await copyFile(
  new URL('../docs/licenses/signalsmith-stretch.txt', import.meta.url),
  new URL('Signalsmith-Stretch-LICENSE.txt', destination),
)
