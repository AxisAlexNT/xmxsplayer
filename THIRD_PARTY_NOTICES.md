# Third-party notices

xmxsplayer is MIT-licensed. Its dependencies retain their own licenses. The production dependency scan contains 82 third-party packages, plus the application itself. The table records the installed versions; full notices are in [dependency license texts](docs/licenses/dependencies.txt).

## PDF sheet music

The renderer and worker include Mozilla PDF.js 6.5.438 under Apache-2.0. The installed application carries its license at `out/renderer/pdf/LICENSE` inside app.asar. Adobe character maps and Foxit standard fonts retain their respective redistribution notices at `out/renderer/pdf/cmaps/LICENSE` and `out/renderer/pdf/standard_fonts/LICENSE_FOXIT`. The bundled OpenJPEG, JBIG2 and qcms modules carry their upstream notices in the adjacent wasm directory. [PDF.js source](https://github.com/mozilla/pdf.js)

## SpessaSynth

SpessaSynth Core and SpessaSynth Lib: Copyright © 2026 Spessasus. Both are Apache-2.0. The processor is shipped as a separate worklet; the library is also included in the engine bundle. Their license texts are retained in the dependency texts and beside the worklet as SpessaSynth-LICENSE.txt. No modified SpessaSynth source is shipped.

## Verovio

Verovio 6.4.1, by Laurent Pugin and contributors, is LGPL-3.0-only. Its unmodified `verovio-module.mjs` and `verovio.mjs` files are separate, replaceable files under `resources/app.asar.unpacked/out/renderer/notation/` in extracted builds. The WASM is embedded in the module. The application remains MIT-licensed. Modifications and reverse engineering for debugging modifications to this library are permitted under its license.

The corresponding upstream source and build files are available at [source commit fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8](https://github.com/rism-digital/verovio/tree/fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8), with a [source archive](https://github.com/rism-digital/verovio/archive/fbe8f4695ab0a123cb096e0cf92354b44f7a2fb8.tar.gz). This reference is the npm package's recorded gitHead. Build guidance is in that source tree's Emscripten directory. See [LGPL-3.0](docs/licenses/verovio-LGPL-3.0.txt) and the incorporated [GPL-3.0 terms](docs/licenses/verovio-GPL-3.0.txt).

Extract an AppImage before replacing these modules, or use the Windows ZIP layout. Keep the module filenames and compatible toolkit exports. No signing or integrity restriction is added to prevent library replacement. Consult the upstream build instructions for rebuilding the WASM; rebuilding the MIT application is described in README.

## Signalsmith Stretch

Signalsmith Stretch 1.3.2 is MIT-licensed, Copyright (c) 2022 Geraint Luff / Signalsmith Audio Ltd. Its worklet includes a local scheduling extension; the original license is retained beside it and in the dependency texts.

## Fonts and desktop runtime

Inter and Fira Code are bundled under the SIL Open Font License 1.1, as specified for the interface. Their original notices are retained in [Inter license](docs/licenses/Inter-LICENSE.txt) and [Fira Code license](docs/licenses/FiraCode-LICENSE.txt). These font assets are separate from npm dependencies.

Electron and Chromium carry additional component notices supplied by the Electron distribution, including LICENSE.electron.txt and LICENSES.chromium.html in packaged output. FluidSynth and MuseScore are independently installed programs; their binaries and soundfonts are not bundled. No third-party recordings or scores are included.

## Windows portable launcher

The portable EXE includes NSIS 3.0.4.1 (zlib/libpng for the used core/System/elevate and Deflate components), StdUtils 1.14 (LGPL-2.1-or-later with its NSIS clarification), and Nsis7z 19.00 (upstream LGPL notice, with public-domain LZMA SDK code). The DLLs are unmodified. Full notices, exact source archives shipped with the application, hashes and replacement/rebuild instructions are in [Windows launcher components](docs/windows-launcher.md). These components retain their licenses; the application remains MIT-licensed. The Windows ZIP has no NSIS launcher.

## Production packages

| Package | License | Upstream |
| --- | --- | --- |
| @babel/helper-string-parser@7.29.14 | MIT | [Source](https://github.com/babel/babel) |
| @babel/helper-validator-identifier@7.29.7 | MIT | [Source](https://github.com/babel/babel) |
| @babel/parser@7.29.14 | MIT | [Source](https://github.com/babel/babel) |
| @babel/types@7.29.14 | MIT | [Source](https://github.com/babel/babel) |
| @codemirror/autocomplete@6.20.4 | MIT | [Source](https://code.haverbeke.berlin/codemirror/autocomplete) |
| @codemirror/commands@6.11.1 | MIT | [Source](https://code.haverbeke.berlin/codemirror/commands) |
| @codemirror/lang-javascript@6.2.5 | MIT | [Source](https://github.com/codemirror/lang-javascript) |
| @codemirror/language@6.13.1 | MIT | [Source](https://code.haverbeke.berlin/codemirror/language) |
| @codemirror/lint@6.9.8 | MIT | [Source](https://code.haverbeke.berlin/codemirror/lint) |
| @codemirror/state@6.7.6 | MIT | [Source](https://code.haverbeke.berlin/codemirror/state) |
| @codemirror/streamparser@6.0.0 | MIT | [Source](https://code.haverbeke.berlin/codemirror/streamparser) |
| @codemirror/view@6.43.15 | MIT | [Source](https://code.haverbeke.berlin/codemirror/view) |
| @jridgewell/gen-mapping@0.3.13 | MIT | [Source](https://github.com/jridgewell/sourcemaps) |
| @jridgewell/resolve-uri@3.1.3 | MIT | [Source](https://github.com/jridgewell/resolve-uri) |
| @jridgewell/sourcemap-codec@1.6.0 | MIT | [Source](https://github.com/jridgewell/sourcemaps) |
| @jridgewell/trace-mapping@0.3.31 | MIT | [Source](https://github.com/jridgewell/sourcemaps) |
| @lezer/common@1.5.5 | MIT | [Source](https://code.haverbeke.berlin/lezer/common) |
| @lezer/highlight@1.2.5 | MIT | [Source](https://code.haverbeke.berlin/lezer/highlight) |
| @lezer/javascript@1.5.6 | MIT | [Source](https://code.haverbeke.berlin/lezer/javascript) |
| @lezer/lr@1.4.12 | MIT | [Source](https://code.haverbeke.berlin/lezer/lr) |
| @marijn/find-cluster-break@1.0.4 | MIT | [Source](https://code.haverbeke.berlin/marijn/find-cluster-break) |
| @popperjs/core@2.11.8 | MIT | [Source](https://github.com/popperjs/popper-core) |
| @tonejs/midi@2.0.28 | MIT | [Source](https://github.com/Tonejs/Midi) |
| @vue/compiler-core@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/compiler-dom@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/compiler-sfc@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/compiler-ssr@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/devtools-api@8.2.1 | MIT | [Source](https://github.com/vuejs/devtools) |
| @vue/devtools-kit@8.2.1 | MIT | [Source](https://github.com/vuejs/devtools) |
| @vue/devtools-shared@8.2.1 | MIT | [Source](https://github.com/vuejs/devtools) |
| @vue/reactivity@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/runtime-core@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/runtime-dom@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/server-renderer@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @vue/shared@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| @xmldom/xmldom@0.9.12 | MIT | [Source](https://github.com/xmldom/xmldom) |
| any-promise@1.3.0 | MIT | [Source](https://github.com/kevinbeaty/any-promise) |
| array-flatten@3.0.0 | MIT | [Source](https://github.com/blakeembrey/array-flatten) |
| birpc@2.9.0 | MIT | [Source](https://github.com/antfu-collective/birpc) |
| bootstrap-icons@1.13.2 | MIT | [Source](https://github.com/twbs/icons) |
| bootstrap@5.3.9 | MIT | [Source](https://github.com/twbs/bootstrap) |
| chokidar@6.0.0 | MIT | [Source](https://github.com/paulmillr/chokidar) |
| commander@4.1.1 | MIT | [Source](https://github.com/tj/commander.js) |
| crelt@1.0.7 | MIT | [Source](https://code.haverbeke.berlin/marijn/crelt) |
| csstype@3.2.3 | MIT | [Source](https://github.com/frenic/csstype) |
| entities@7.0.1 | BSD-2-Clause | [Source](https://github.com/fb55/entities) |
| estree-walker@2.0.2 | MIT | [Source](https://github.com/Rich-Harris/estree-walker) |
| fdir@6.5.0 | MIT | [Source](https://github.com/thecodrr/fdir) |
| fflate@0.8.3 | MIT | [Source](https://github.com/101arrowz/fflate) |
| hookable@5.5.3 | MIT | [Source](https://github.com/unjs/hookable) |
| immer@11.2.10 | MIT | [Source](https://github.com/immerjs/immer) |
| lines-and-columns@1.2.4 | MIT | [Source](https://github.com/eventualbuddha/lines-and-columns) |
| magic-string@0.30.21 | MIT | [Source](https://github.com/Rich-Harris/magic-string) |
| midi-file@1.2.4 | MIT | [Source](https://github.com/carter-thaxton/midi-file) |
| mz@2.7.0 | MIT | [Source](https://github.com/normalize/mz) |
| nanoid@3.3.20 | MIT | [Source](https://github.com/ai/nanoid) |
| nostics@1.3.0 | MIT | [Source](https://github.com/vercel-labs/nostics) |
| object-assign@4.1.1 | MIT | [Source](https://github.com/sindresorhus/object-assign) |
| perfect-debounce@2.1.0 | MIT | [Source](https://github.com/unjs/perfect-debounce) |
| picocolors@1.1.1 | ISC | [Source](https://github.com/alexeyraspopov/picocolors) |
| picomatch@4.0.7 | MIT | [Source](https://github.com/micromatch/picomatch) |
| pinia@4.1.0 | MIT | [Source](https://github.com/vuejs/pinia) |
| pirates@4.0.7 | MIT | [Source](https://github.com/danez/pirates) |
| postcss@8.5.33 | MIT | [Source](https://github.com/postcss/postcss) |
| readdirp@5.1.1 | MIT | [Source](https://github.com/paulmillr/readdirp) |
| signalsmith-stretch@1.3.2 | MIT | [Source](https://signalsmith-audio.co.uk/code/stretch) |
| source-map-js@1.2.2 | BSD-3-Clause | [Source](https://github.com/7rulnik/source-map-js) |
| spessasynth_core@4.4.10 | Apache-2.0 | [Source](https://github.com/spessasus/spessasynth_core) |
| spessasynth_lib@4.4.8 | Apache-2.0 | [Source](https://github.com/spessasus/spessasynth_lib) |
| stb-vorbis@0.0.7 | Apache-2.0 | [Source](https://github.com/spessasus/stb-vorbis) |
| style-mod@4.1.4 | MIT | [Source](https://code.haverbeke.berlin/marijn/style-mod) |
| sucrase@3.35.1 | MIT | [Source](https://github.com/alangpierce/sucrase) |
| thenify-all@1.6.0 | MIT | [Source](https://github.com/thenables/thenify-all) |
| thenify@3.3.1 | MIT | [Source](https://github.com/thenables/thenify) |
| tinyglobby@0.2.17 | MIT | [Source](https://github.com/SuperchupuDev/tinyglobby) |
| ts-interface-checker@0.1.13 | Apache-2.0 | [Source](https://github.com/gristlabs/ts-interface-checker) |
| typescript@6.0.3 | Apache-2.0 | [Source](https://github.com/microsoft/TypeScript) |
| verovio@6.4.1 | LGPL-3.0-only | [Source](https://github.com/rism-digital/verovio) |
| vue@3.5.45 | MIT | [Source](https://github.com/vuejs/core) |
| w3c-keyname@2.2.8 | MIT | [Source](https://github.com/marijnh/w3c-keyname) |
| yaml@2.9.1 | ISC | [Source](https://github.com/eemeli/yaml) |
| zod@4.6.7 | MIT | [Source](https://github.com/colinhacks/zod) |
