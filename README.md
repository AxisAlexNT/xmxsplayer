# xmxsplayer

A cross-platform desktop workspace for transcription by ear and live MIDI performance.

## Status

M2: live MIDI input and soundfont performance. The hidden engine runs SF2/SF3 synthesis with timed events, a limiter and output/cue routing. New projects find a GM bank and create a piano instrument, MIDI track, full-range zone and patch. The playable keyboard shows held notes; routing supports splits, overlap, layering, transposition, sustain, wheels and pressure, with note-offs retained across routing changes. The instrument picker searches and auditions presets. Audio settings expose output, buffer, sample rate and latency, with project restoration after restart.

Verified on Ubuntu 24.04 with an Arturia KeyLab Essential 61 mk3 in Arturia mode. Playback, recording, note editing, controller function mappings, pad feedback and score linking follow in later milestones. Windows and alternate hardware audio outputs are not yet verified. This is not a release-ready application.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Choose **New project** and select an empty folder, or **Open project** to select an existing project folder. Play the connected MIDI keyboard or tap the keyboard strip. Click an instrument in Patch to search and audition presets; open Audio settings with the gear. Edit the project name or register names, then save with Ctrl+S. Edit `setup.yaml` externally to see live reload; if that file also has unsaved changes, choose **Keep mine** or **Take file**. Ctrl+Z and Ctrl+Y undo and redo document edits, including reloads.

- `npm run build`: compile all process and renderer entries.
- `npm run check`: typecheck, lint, and run unit tests.
- `npm run test`: run Vitest; use `npx vitest run tests/path/to/file.test.ts` for one file.
- `npm run smoke`: build and verify UI mounting and the engine handshake. Linux needs a display or `xvfb-run -a npm run smoke`.
- `npm run dist:linux`: build an AppImage.
- `npm run dist:win`: build Windows x64 portable and zip artifacts.

Packaging configuration and release validation follow in the release milestone.

## Project files

`project.yaml` holds project metadata and tracks; `setup.yaml` holds registers, zones, patches, scenes and cues; `bindings.yaml`, `clips.yaml`, `mappings/*.yaml` and `script.ts` hold their corresponding data. Unlinked or locally modified MIDI tracks are stored as format-0, PPQ-480 `tracks/<id>.mid` files. Zone keys accept MIDI numbers or note names (`C4` = 60); saved zones use note names. Identifiers are stable readable slugs.

Saving rewrites only changed files using temporary files and atomic renames. YAML comments are not preserved when rewritten. Invalid external changes retain the previous document and show a file/path error in Log. `.xmxs/` is disposable cache; `xm.d.ts` supplies script API declarations for the later scripting milestone.

If the system has exhausted its native file-watch quota, launch with `CHOKIDAR_USEPOLLING=1` to use polling.

Settings live in the Electron user-data directory. Set `XMXS_DATA_DIR`, or create `xmxsplayer-data` beside the executable, to use a portable settings directory.

## License

[MIT](LICENSE). Bundled fonts retain their licenses in `src/ui/assets/fonts/`.
