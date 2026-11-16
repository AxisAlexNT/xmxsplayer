# Release verification

Current validation: 0.1.0, Ubuntu Studio 24.04, 2026-11-16. This document separates completed software checks from physical or platform work still required. A passing unit suite does not establish full live-performance readiness.

## Completed checks

- `CHOKIDAR_USEPOLLING=1 npm run check`: typecheck and lint passed; 320 tests passed, one optional native test skipped.
- `XM_FLUID_FILE_TEST=1 CHOKIDAR_USEPOLLING=1 npx vitest run tests/main/fluidsynth-native.test.ts`: passed again with real FluidSynth 2.3.4, SF2/SF3 and file output. No hardware MIDI.
- `npm run smoke`: UI mount and engine handshake passed before packaging; real MIDI disabled.
- Isolated desktop checks: recording/editing, real muted audio processing and five import formats, clips, scenes/cues/registers/scripts, follow modes, linked-score conversion and notation, backend changes/recovery and external MIDI routing.
- External MIDI desktop checks: audition, live and sequenced notes, shared note/pedal ownership, original held destinations, channel change, stop cancellation, reconnect, saved YAML, 40 px picker controls, and 1920/1280 viewports. Real MIDI ports were replaced before app code.
- Actual MuseScore 3.2.3 GUI Ctrl+A/Up/Ctrl+S: copied score saved, first imported pitch changed from 59 to 60, packaged-player playback continued, original score hash unchanged and GUI closed cleanly. Temporary settings disabled MIDI input and first-use tours, with process-local silent ALSA routing. Earlier synthesis-disabled launches crashed with exit 139; normal desktop audio remains untested.
- Copied Expedition score: all 967 engraved attacks matched the unrolled MIDI pitches/ticks through the end. Original scores were not modified.
- Permissioned, muted PipeWire comparison: Built-in readouts and FluidSynth PipeWire startup at quantum 1024 and 256; original 1024 restored and independently read back. No test Electron/FluidSynth processes remained. See [latency observations](latency.md).
- Copied-project portability: two destination folders with spaces restored all three tracks and saved linked notes. Filename-based font lookup, missing-font Locate recovery and persisted lookup in another fresh profile passed with a real muted synthesis signal.
- Physical KeyLab session: piano/strings split, pitch/modulation, chords and sustain release passed. In DAWs mode the owner confirmed project/transport text, pale pad colours, top-row beat chase, uninterrupted chase after pad presses and Stop. Arturia showed no visible feedback. Captured addresses differ between modes; the corrected decoder is regression tested with both address sets, but the new alias routing still needs a physical recheck. See [captured controls](controllers.md#captured-keylab-addresses).
- Production npm license allowlist: passed; 82 dependencies plus the application, with font/runtime notices considered separately.

The latest live-input and portable-path regressions are unit verified. Fresh native switching/recovery checks also passed after fixing preset selection across engine choices. The initial fresh native run caught that regression and timed out; it was corrected and the complete rerun passed.

`CHOKIDAR_USEPOLLING=1 npm run dist:linux -- --publish never` built the AppImage. Its own executable passed hardware-disabled smoke with a fresh temporary profile and the normal sandbox. Packaged ASAR flows passed external MIDI routing and portable settings load/save beside an AppImage path containing spaces; packaged notation/audio flows passed recording, edits, follow highlights, copied-score conversion, embedded notation font, mixed-axis alignment, playback/page/center, cache limits, click seeking, scale and themes. MIDI was simulated and output muted.

Windows x64 portable EXE and ZIP cross-builds also completed on Linux with signing and publication disabled. Both archives passed decompression checks; the application payload is PE32+ x64. The portable EXE has a 32-bit extraction stub with an x64 payload. Neither was executed on Windows. Its NSIS launcher embeds approved StdUtils/Nsis7z helpers; exact source archives, license texts and replacement instructions accompany the build (see [launcher components](windows-launcher.md)). The ZIP has no NSIS launcher. This component check is separate from the npm allowlist audit.

The Linux and Windows packages contain no private sketch/instruction files. Both unpacked Verovio modules match the npm originals byte-for-byte on both platforms; inspected executable fuse settings leave embedded ASAR validation disabled. Electron/Chromium notices are present. Workflow YAML and configured portable-only targets passed local structural checks. The final trace audit and push status are recorded at the end of validation; the tag-triggered workflow remains unexecuted.

## Performance checklist

| Check | Software evidence | Still required |
| --- | --- | --- |
| New project, splits/layers, held scene changes | Routing tests and isolated desktop checks; earlier physical KeyLab split/sustain confirmation | Full current-build keyboard/listening pass |
| Multi-track MIDI, instruments, staff/roll, page/center, reorder, zoom | Import/timing/notation tests and desktop checks | Physical packaged-build interaction pass |
| Four-bar audio loop at 50%, knob speed, filter/isolation, grid/taps, click/cue | Real muted processing and synthetic control checks | Listen for pitch/timing; physical knob and alternate output checks |
| Reduced-speed recording, undo/redo, edits, quantize, updated staves | Desktop recording/editing/notation checks | Physical playing/pen comfort and listening |
| Transport/DAW, Learn, conditions, beat chase, register LEDs/display, hot-plug | Profile/binding/feedback simulations plus physical DAWs display, colours, beat chase and control captures | Recheck corrected mode aliases; seven DAWs bank B pads and Arturia-only gaps; hot-plug and exact timing |
| Reprise scenes/registers/scripts, exclusive groups, wait cue, live YAML/conflict | State/routing/script tests and desktop checks | Perform the arrangement on real hardware |
| Wait any/all, tempo tracking, wrong notes and skip | Synthetic performance and muted audio checks | Tune matching with the performer |
| Clips: all launches/sweeps, groups, speed, pressure, LEDs, WAV/MP3/OGG/M4A/FLAC | Decoder/processing/controller simulations and desktop checks | Actual pad/fader use, sound and LEDs |
| MuseScore save/re-sync, ahead protection, export/discard, repeats | Copied-score headless exports, real GUI Ctrl+S during playback and file watching; notation matches to end | MIDI defaults to VLC on this PC; manual import/association setup; MuseScore 4 |
| Built-in/FluidSynth switching and readouts | Muted built-in signal, native file audio, recovery and quantum comparison | Audible native output and timing under full arrangement load |
| Save/quit/reopen; copied project and missing-font lookup | Folder IO, moved project, filename font lookup, Locate recovery and fresh-profile reopening passed | Separate clean OS account |
| AppImage and portable settings | AppImage startup and packaged portable data read/write passed; launcher-path precedence unit tests | Test a separate clean OS account; Windows launcher remains untested |

## Windows 11: user-run

Unsigned Windows artifacts cross-built successfully on Linux; no Windows runtime operation is verified yet. Launcher source/license review passed; both formats still need runtime testing. Check the portable EXE and ZIP, output/input names, controller capture, all audio formats, 40 px touch targets and actual Wacom pen/eraser/pressure behavior. Verify WASAPI shared/exclusive operation, readouts and audible timing, FluidSynth and MuseScore detection/path quoting, project save/reopen and portable settings. Report the OS build, device/driver, artifact version, settings and failures. The build job's experimental status does not establish runtime support.

## Release gates

AppImage execution, packaged assets, notices, portable settings, final checks and the repository/history trace audit must be reviewed before requesting a tag. Physical checks cannot be replaced by simulated ports. Verify the launcher source attachments and bundled notices against the final EXE before distribution. Tag creation and release publication require separate explicit approval. A draft release may omit Windows artifacts if that experimental job failed; inspect the workflow before publishing.
