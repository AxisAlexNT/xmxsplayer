# xmxsplayer

A cross-platform desktop workspace for transcription by ear and live MIDI performance.

## Status

M1: application shell and project folders. The UI and hidden engine communicate through a typed message bus; the engine reconnects after a renderer crash. Projects use validated YAML and per-track MIDI files, explicit saving, undo/redo, and live reload with per-file conflict choices. The frame follows the reference design and bundles Inter and Fira Code.

Sound, MIDI controller support, playback, recording, note editing, and score linking are not implemented yet. Import and export menu items remain disabled until their respective milestones. This is not a release-ready application.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Choose **New project** and select an empty folder, or **Open project** to select an existing project folder. Edit the project name or register names, then save with Ctrl+S. Edit `setup.yaml` externally to see live reload; if that file also has unsaved changes, choose **Keep mine** or **Take file**. Ctrl+Z and Ctrl+Y undo and redo document edits, including reloads.

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

Settings live in the Electron user-data directory. Set `XMXS_DATA_DIR`, or create `xmxsplayer-data` beside the executable, to use a portable settings directory.

## License

[MIT](LICENSE). Bundled fonts retain their licenses in `src/ui/assets/fonts/`.
