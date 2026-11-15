import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const destination = new URL('../src/engine/public/worklets/', import.meta.url)
await mkdir(destination, { recursive: true })
await copyFile(new URL('../node_modules/spessasynth_lib/dist/spessasynth_processor.min.js', import.meta.url), new URL('spessasynth_processor.min.js', destination))
await copyFile(new URL('../node_modules/spessasynth_lib/LICENSE', import.meta.url), new URL('SpessaSynth-LICENSE.txt', destination))
console.log(`Copied synth worklet to ${fileURLToPath(destination)}`)
