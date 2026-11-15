# xmxsplayer

A cross-platform desktop workspace for transcription by ear and live MIDI performance.

## Status

M0–M5 are implemented. M6 is in progress: device profiles, MIDI control decoding, learning and scoped bindings are available; pad/display feedback remains to be added. Projects support explicit saves, undo/redo and live YAML reload with conflict handling. The hidden engine provides SF2/SF3 synthesis, live MIDI splits and layers, sustain and controller expression, and retained note-offs across routing changes.

The transcription workspace imports MIDI and audio, shares a transport and timeline, loops sections, changes playback speed without changing pitch, and provides beat-grid anchors, time/key maps, a metronome and count-in. Armed MIDI tracks record post-zone notes and expression with latency compensation and loop overdub. Each take is one undo step. The piano roll supports snapped drawing, selection, moving, resizing, velocity edits, duplication, deletion and quantization, with mouse, touch and pen input. Two-finger gestures pan and zoom; double-click a MIDI track header to expand its lane.

Verified on Ubuntu 24.04, including live input from an Arturia KeyLab Essential 61 mk3. Automated desktop checks cover recording at 60% speed over looping audio, take undo/redo, native pointer editing, simulated pen pressure and touch zoom. Physical Windows pen/eraser behavior, Windows audio codecs and alternate hardware outputs remain unverified. Some KeyLab pad, knob, fader and encoder messages still require physical capture; Windows port names remain unverified. Pad feedback, scene scripting, score linking and staff rendering follow in later milestones. This is not a release-ready application.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Choose **New project** and select an empty folder, or **Open project** to select an existing project folder. Play the connected MIDI keyboard or tap the keyboard strip. Click an instrument in Patch to search and audition presets; open Audio settings with the gear. Edit the project name or register names, then save with Ctrl+S. Edit `setup.yaml` externally to see live reload; if that file also has unsaved changes, choose **Keep mine** or **Take file**. Ctrl+Z and Ctrl+Y undo and redo document edits, including reloads.

Import MIDI or reference audio from the menu. Shift-drag the ruler to set a loop and use Speed to slow playback. Arm a MIDI track and press Record; recording while stopped starts playback. In Roll view, use the lane toolbar to select, draw or erase notes and choose the snap grid. Drag selected notes to move them, drag their edge handles to resize, or Alt-drag vertically to change velocity. Ctrl+D duplicates, Delete removes and arrow keys nudge the selection. Quantize uses the current snap grid on the selection, or on the last recorded take when nothing is selected. Hold Shift and use the mouse wheel to pan horizontally.

- `npm run build`: compile all process and renderer entries.
- `npm run check`: typecheck, lint, and run unit tests.
- `npm run test`: run Vitest; use `npx vitest run tests/path/to/file.test.ts` for one file.
- `npm run smoke`: build and verify UI mounting and the engine handshake. Linux needs a display or `xvfb-run -a npm run smoke`.
- `npm run dist:linux`: build an AppImage.
- `npm run dist:win`: build Windows x64 portable and zip artifacts.

Packaging configuration and release validation follow in the release milestone.

## Controllers

Devices lists the main MIDI ports and their assigned profiles. Use **Learn…** to capture missing controls, or click an unlearned element in Controls to learn it individually. Press and release buttons and pads; sweep absolute controls across their full range and turn relative encoders in both directions. Review each capture, correct its mode if necessary, then finish to save the profile on this PC. Unknown hardware messages remain unassigned until learned.

Click a learned control to edit its binding. Choose its edge, action, condition and timing; edits apply immediately. Store bindings in Shared, This controller, This scene, or a controller's scene override. Unbind disables that edge in the selected scope. Absolute parameter controls use soft takeover: move to the parameter's current value before they take control. Relative encoders apply changes from the current value.

New projects include transport and DAW bindings, speed on knob 1, track volumes by fader order and master volume on fader 9. The KeyLab mapping assigns bank B pads to registers 1–8; the Axiom mapping uses buttons 1–8. Scene, register, cue, clip and script execution is added in the subsequent performance milestones.

## Project files

`project.yaml` holds project metadata and tracks; `setup.yaml` holds registers, zones, patches, scenes and cues; `bindings.yaml`, `clips.yaml`, `mappings/*.yaml` and `script.ts` hold their corresponding data. Unlinked or locally modified MIDI tracks are stored as format-0, PPQ-480 `tracks/<id>.mid` files. Zone keys accept MIDI numbers or note names (`C4` = 60); saved zones use note names. Identifiers are stable readable slugs.

Saving rewrites only changed files using temporary files and atomic renames. YAML comments are not preserved when rewritten. Invalid external changes retain the previous document and show a file/path error in Log. `.xmxs/` is disposable cache; `xm.d.ts` supplies script API declarations for the later scripting milestone.

If the system has exhausted its native file-watch quota, launch with `CHOKIDAR_USEPOLLING=1` to use polling.

Settings live in the Electron user-data directory. Set `XMXS_DATA_DIR`, or create `xmxsplayer-data` beside the executable, to use a portable settings directory.

## License

[MIT](LICENSE). Bundled fonts retain their licenses in `src/ui/assets/fonts/`.
