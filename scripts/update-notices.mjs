import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
const input = process.argv[2]
if (!input)
  throw Error('Pass the JSON output from license-checker --production --json')
const packages = JSON.parse(await readFile(input, 'utf8'))
const own = JSON.parse(await readFile('package.json', 'utf8'))
const rows = [],
  texts = []
for (const [name, data] of Object.entries(packages).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (name === `${own.name}@${own.version}`) continue
  const license = Array.isArray(data.licenses)
    ? data.licenses.join(' OR ')
    : data.licenses
  rows.push(
    `| ${name} | ${license} | ${data.repository ? `[Source](${data.repository.replace(/^git\+/, '')})` : 'See package metadata'} |`,
  )
  if (name.startsWith('verovio@')) continue
  const file = name.startsWith('signalsmith-stretch@')
    ? 'docs/licenses/signalsmith-stretch.txt'
    : data.licenseFile
  if (!file) throw Error(`Missing license text: ${name}`)
  texts.push(
    `${name}\n${'='.repeat(name.length)}\n\n${await readFile(file, 'utf8')}`,
  )
  for (const notice of [
    'NOTICE',
    'NOTICE.txt',
    'ThirdPartyNoticeText.txt',
    'CopyrightNotice.txt',
  ]) {
    const path = join(data.path, notice)
    if (basename(path) === basename(file)) continue
    try {
      texts.push(`${name}: ${notice}\n\n${await readFile(path, 'utf8')}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
const header = `# Third-party notices

xmxsplayer is MIT-licensed. Its dependencies retain their own licenses. The production dependency scan contains ${rows.length} third-party packages, plus the application itself. The table records the installed versions; full notices are in [dependency license texts](docs/licenses/dependencies.txt).

## SpessaSynth

SpessaSynth Core and SpessaSynth Lib: Copyright © 2026 Spessasus. Both are Apache-2.0. The processor is shipped as a separate worklet; the library is also included in the engine bundle. Their license texts are retained in the dependency texts and beside the worklet as SpessaSynth-LICENSE.txt. No modified SpessaSynth source is shipped.

## Verovio

Verovio 6.4.1, by Laurent Pugin and contributors, is LGPL-3.0-only. Its unmodified \`verovio-module.mjs\` and \`verovio.mjs\` files are separate, replaceable files under \`resources/app.asar.unpacked/out/renderer/notation/\` in extracted builds. The WASM is embedded in the module. The application remains MIT-licensed. Modifications and reverse engineering for debugging modifications to this library are permitted under its license.

The corresponding upstream source and build files are available at [source commit fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8](https://github.com/rism-digital/verovio/tree/fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8), with a [source archive](https://github.com/rism-digital/verovio/archive/fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8.tar.gz). This reference is the npm package's recorded gitHead. Build guidance is in that source tree's Emscripten directory. See [LGPL-3.0](docs/licenses/verovio-LGPL-3.0.txt) and the incorporated [GPL-3.0 terms](docs/licenses/verovio-GPL-3.0.txt).

Extract an AppImage before replacing these modules, or use the Windows ZIP layout. Keep the module filenames and compatible toolkit exports. No signing or integrity restriction is added to prevent library replacement. Consult the upstream build instructions for rebuilding the WASM; rebuilding the MIT application is described in README.

## Signalsmith Stretch

Signalsmith Stretch 1.3.2 is MIT-licensed, Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd. Its worklet includes a local scheduling extension; the original license is retained beside it and in the dependency texts.

## Fonts and desktop runtime

Inter and Fira Code are bundled under the SIL Open Font License 1.1, as specified for the interface. Their original notices are retained in [Inter license](docs/licenses/Inter-LICENSE.txt) and [Fira Code license](docs/licenses/FiraCode-LICENSE.txt). These font assets are separate from npm dependencies.

Electron and Chromium carry additional component notices supplied by the Electron distribution, including LICENSE.electron.txt and LICENSES.chromium.html in packaged output. FluidSynth and MuseScore are independently installed programs; their binaries and soundfonts are not bundled. No third-party recordings or scores are included.

## Production packages

| Package | License | Upstream |
| --- | --- | --- |
`
await writeFile(
  'THIRD_PARTY_NOTICES.md',
  header.replaceAll('\`', '`') + rows.join('\n') + '\n',
)
await writeFile(
  'docs/licenses/dependencies.txt',
  texts
    .join('\n\n' + '-'.repeat(72) + '\n\n')
    .replaceAll('\r\n', '\n')
    .replace(/[ \t]+$/gm, ''),
)
console.log(`Wrote notices for ${rows.length} production dependencies`)
