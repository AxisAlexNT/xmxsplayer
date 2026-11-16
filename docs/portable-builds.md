# Portable builds

The configured targets are Linux x64 AppImage and Windows x64 portable EXE plus ZIP. The application does not bundle FluidSynth, MuseScore, soundfonts, recordings or scores. Install the optional programs and choose paths/fonts separately on each computer.

## Run

1. Use an artifact from a verified release when one is available. No release has been tagged or published during current validation. Windows runtime support is experimental and untested. Cross-builds completed on Linux; launcher notices and corresponding sources are bundled.
2. On Linux, make the AppImage executable and launch it. AppImage startup passed on Ubuntu Studio 24.04 with a fresh temporary profile and the normal sandbox; a separate clean OS account remains untested. Do not assume the development checkout's system dependencies are present on another computer.
3. On Windows, launch the portable EXE, or extract the ZIP and launch `xmxsplayer.exe`. Keep the extracted ZIP directory together. No installer is configured. Executables are unsigned; Windows signing and operation remain untested.
4. To keep settings portable, create `xmxsplayer-data` beside the AppImage or portable launcher before starting it. For the ZIP, create it beside `xmxsplayer.exe`. If absent, settings use the normal per-user directory. `XMXS_DATA_DIR` overrides both. AppImage and portable EXE launchers extract internally; settings lookup uses the outer launcher's directory rather than the temporary extraction path.
5. Projects live in folders you choose, independently of the application and its settings. Copy the entire project folder between studios, locate fonts by name and choose the destination ports/output devices on that computer. See [Project folders](project-files.md).

## Build locally

Use Node.js 24 and npm:

```sh
npm ci
npm run check
npm run dist:linux -- --publish never
```

On Windows, replace the last command with:

```sh
npm run dist:win -- --publish never
```

Artifacts go into `release/`. Linux has only the AppImage target; Windows has only portable EXE and ZIP, all x64. Building is separate from publishing. Linux AppImage startup and packaged asset flows passed on the verification computer; Unsigned Windows EXE and ZIP cross-builds succeeded on Linux; packaging on Windows and all Windows runtime behavior remain untested. Archive decompression and x64 payload checks passed. The portable EXE uses a 32-bit extraction stub around the x64 application.

The original icon's SVG and export assets are in `build/`. Worklets and the unmodified Verovio modules are unpacked under `resources/app.asar.unpacked/out/renderer/`. Electron/Chromium and dependency notices accompany the packaged application; [Third-party notices](../THIRD_PARTY_NOTICES.md) explains source access and library replacement.

## Portable EXE components

The portable EXE includes approved NSIS launcher helpers under zlib/libpng and LGPL terms. Exact source archives, full license texts, binary hashes and replacement/rebuild instructions are supplied in [Windows launcher components](windows-launcher.md). These licenses accompany the MIT application; the ZIP has no NSIS launcher. Review these components separately from the npm dependency audit whenever packaging versions change.

## License audit and notices

The auditor runs without adding an application dependency:

```sh
npm exec --yes --package=license-checker@25.0.1 -- license-checker --production --summary
npm exec --yes --package=license-checker@25.0.1 -- license-checker --production --json > production-licenses.json
node scripts/update-notices.mjs production-licenses.json
npm exec --yes --package=license-checker@25.0.1 -- license-checker --production --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0;MPL-2.0;0BSD;CC0-1.0;Unlicense;BlueOak-1.0.0;Python-2.0;LGPL-3.0-only"
```

Use the temporary audit JSON only as input; it contains local installation paths and is not a distributable notice. The script writes the package table and dependency license texts, preserving available NOTICE files. Fonts, the separately retained Verovio license texts/source reference, and Electron's runtime notices also require review when versions change. The production allowlist passed for the current dependency tree.

## Release workflow

An explicitly approved `v*` tag triggers Linux and Windows builds on their respective runners. Each runs `npm ci`, checks and packaging with publication disabled, then uploads artifacts. A separate job creates a **draft** release from the results. It does not publish the draft. The Windows job is marked experimental and may fail without blocking the Linux draft; inspect its status and artifacts explicitly.

The workflow has not run for a release tag. Review the [verification checklist](release-checklist.md) before approving any tag, then review the draft and platform evidence before publishing. No auto-updater, signing identity or installer is configured.
