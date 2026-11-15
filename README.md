# xmxsplayer

A cross-platform desktop workspace for transcription by ear and live MIDI performance.

## Status

M0–M5 are implemented. M7 now provides scenes, registers, editable zones, conditional patching, timeline cues, a live signal-flow view and trusted TypeScript scripts with a CodeMirror editor. M6 software includes device profiles, MIDI control decoding, learning, scoped bindings and KeyLab pad/display feedback; physical controller capture and feedback verification remain pending. Projects support explicit saves, undo/redo and live YAML reload with conflict handling. The hidden engine provides SF2/SF3 synthesis, live MIDI splits and layers, sustain and controller expression, and retained note-offs across routing changes.

M7b software provides audio clips with waveform fragment editing, audition, four launch modes, quantized starts/stops, exclusive groups, tempo/speed sync, fades, hold-freeze, pad pressure, three sweep modes, drag-to-bind and script controls. Clip data saves and reloads through `clips.yaml`. Muted Electron checks cover real audio processing, all five audio formats and simulated controller feedback; physical clip/controller checks remain pending. See [Audio clips](docs/clips.md) for setup and examples.

The transcription workspace imports MIDI and audio, shares a transport and timeline, loops sections, changes playback speed without changing pitch, and provides beat-grid anchors, time/key maps, a metronome and count-in. Armed MIDI tracks record post-zone notes and expression with latency compensation and loop overdub. Each take is one undo step. The piano roll supports snapped drawing, selection, moving, resizing, velocity edits, duplication, deletion and quantization, with mouse, touch and pen input. Two-finger gestures pan and zoom; double-click a MIDI track header to expand its lane.

Verified on Ubuntu 24.04, including live input from an Arturia KeyLab Essential 61 mk3. Automated desktop checks cover recording at 60% speed over looping audio, take undo/redo, native pointer editing, simulated pen pressure and touch zoom. Physical Windows pen/eraser behavior, Windows audio codecs and alternate hardware outputs remain unverified. Some KeyLab pad, knob, fader and encoder messages still require physical capture; Windows port names remain unverified. M8 wait-for-notes is implemented locally, including any/all chord matching, early notes, lead controls and expected-note highlights. Tempo tracking, score linking and staff rendering remain in development. This is not a release-ready application.

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
- `npm run smoke`: build and verify UI mounting and the engine handshake. Linux needs a display or `xvfb-run -a npm run smoke`. Hardware MIDI access is disabled during smoke tests.
- `npm run dist:linux`: build an AppImage.
- `npm run dist:win`: build Windows x64 portable and zip artifacts.

Packaging configuration and release validation follow in the release milestone.

## Controllers

Devices lists the main MIDI ports and their assigned profiles. Use **Learn…** to capture missing controls, or click an unlearned element in Controls to learn it individually. Press and release buttons and pads; sweep absolute controls across their full range and turn relative encoders in both directions. Review each capture, correct its mode if necessary, then finish to save the profile on this PC. Unknown hardware messages remain unassigned until learned.

Click a learned control to edit its binding. Choose its edge, action, condition and timing; edits apply immediately. Store bindings in Shared, This controller, This scene, or a controller's scene override. Unbind disables that edge in the selected scope. Absolute parameter controls use soft takeover: move to the parameter's current value before they take control. Relative encoders apply changes from the current value.

New projects include transport and DAW bindings, speed on knob 1, track volumes by fader order and master volume on fader 9. The KeyLab mapping assigns bank B pads to registers 1–8; the Axiom mapping uses buttons 1–8. Scene and register actions update the live routing. Cues can run actions automatically or wait for a control; script functions can extend the live setup; clip playback follows in the next milestone.

KeyLab feedback uses only its paired main MIDI output. Mapping colours, binding state, beat chase, hit flashes and queued-cue blinking share the same states on the screen and keyboard. Turn **Visual pads** off in Bar grid to disable beat chase. The display shows the project or scene name, position, speed and follow state. Feedback reinitializes after a program change and refreshes after pad release. **Select Arturia program on connect** is off by default; enabling it changes the keyboard's active program. Physical colours, release repainting, program-selection display and timing still need confirmation on the keyboard.

Electron 45 lacks `MIDIOutput.clear()`, so future LED messages remain in a cancellable engine queue until their deadlines. Isolated Linux checks measured up to 2.5 ms of dispatch lateness; this is not physical MIDI or audio latency. At high audio output latency, pad feedback aligned to the audible beat can trail the transport's on-screen beat lamps; visual alignment remains a release QA item.

## Live setup

Capture the current zones, patch, track modes and register choices as a scene. Click a scene to activate it; choose Now, Beat or Bar for the activation boundary. The Base / scene switch chooses where routing edits are stored. Use a scene’s menu to rename, recolour, duplicate, reset its overrides or delete it. Held notes finish on their original sound when routing changes.

Registers 1–8 toggle from their buttons, number keys or controller bindings. Right-click, hold or press F2 on a register to edit its name, mode and group. Exclusive registers in the same group replace each other; momentary bindings restore the underlying register choices when released.

Drag either end of a zone above the keyboard, or click its label to edit the note range, target tracks, transpose and velocity curve. Double-click empty space in the zone strip to add a zone. Learn range collects the lowest and highest keys you play. Each edge drag is one undo step.

Patch lists one row per MIDI track. Click + to add another instrument connection, then choose its instrument, condition and transpose. Connections can be always active, gated by a register or use a custom condition. Change preset opens the soundfont picker; New instrument creates an independent sound. The same connection editor opens from a track header’s instrument chip.

Add a cue at the playhead with + in the cue lane, or double-click empty lane space. Drag a cue to move it with the current snap; each drag is one undo step. Click a marker to edit its name, bar/beat, trigger, control, firing boundary and ordered actions. Learn captures an already learned controller control while suspending its normal binding.

Automatic cues run when playback reaches them. Armed cues accept their assigned control until fired or replaced by the next cue. Wait cues freeze the transport and audio at their marker; release with the assigned control, a live-zone key when no control is assigned, or Skip hold in Cue options. Then fire can defer the actions to the next beat or bar after release. Automatic cues already on that boundary run there. Cue note actions tap a note for one quarter beat. Seeking cancels queued actions; Chase cues on seek, enabled by default in Cue options, applies the scene/register/track-mode actions of the last scene-affecting cue before the destination without replaying note hits.

Expand Signal flow to inspect Inputs → Zones → Tracks → Instruments → Outputs. Scroll horizontally to follow a route across the panel. Dashed connections show their condition, including closed gates; active boxes and wires show live, sequenced and audio-track activity. A Held connection keeps the original destination visible after a scene change. Click a box to open its editor, or a condition label to edit the connection in the active scene. The diagram does not move or edit routing by dragging.

Edit TypeScript in Script, then Apply or press Ctrl+Enter. A new version needs approval before it runs; external edits reload through the same trust check. Disable stops hooks and script-created notes. Scripts can transform live notes, react to controls and musical boundaries, change runtime routing and registers, and update pad/display feedback. See [Scripting](docs/scripting.md) for the API, limits and three examples.

See [Follow modes](docs/follow-modes.md) for lead tracks, chord matching, early timing and skip controls.

## Project files

`project.yaml` holds project metadata and tracks; `setup.yaml` holds registers, zones, patches, scenes and cues; `bindings.yaml`, `clips.yaml`, `mappings/*.yaml` and `script.ts` hold their corresponding data. Unlinked or locally modified MIDI tracks are stored as format-0, PPQ-480 `tracks/<id>.mid` files. Zone keys accept MIDI numbers or note names (`C4` = 60); saved zones use note names. Identifiers are stable readable slugs.

Saving rewrites only changed files using temporary files and atomic renames. YAML comments are not preserved when rewritten. Invalid external changes retain the previous document and show a file/path error in Log. `.xmxs/` is disposable cache; `xm.d.ts` supplies standalone script API declarations.

If the system has exhausted its native file-watch quota, launch with `CHOKIDAR_USEPOLLING=1` to use polling.

Settings live in the Electron user-data directory. Set `XMXS_DATA_DIR`, or create `xmxsplayer-data` beside the executable, to use a portable settings directory.

## License

[MIT](LICENSE). Bundled fonts retain their licenses in `src/ui/assets/fonts/`.
