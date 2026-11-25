# xmxsplayer

A desktop workspace for transcribing music by ear and performing arrangements with MIDI controllers. Loop and slow reference audio, record the parts you hear, then combine live keyboard splits/layers with sequenced instruments, clips and scene changes.

## Status

The native menus and file-conflict messages share an English translation catalogue.

Audio tracks offer Wave, Spectrum and Both views with channel isolation, note overlays and a project-local analysis cache.

The Orchestra panel provides four range-aware presets, section registers and configurable layers. See [Orchestral sets](docs/orchestra.md).

Right-click or long-press the timeline ruler to insert or delete measures or change the tempo or signature from a bar. Use **+ Bars** below the tracks to extend the project. Each edit supports Undo.

Click **Tempo** to change the whole tempo map proportionally, set one BPM throughout, or edit the current section or loop. Double-click to type directly. **Speed** controls playback independently.

Generated piano parts default to a grand staff. The track header lets you choose a hand split, enable a second voice and show sustain pedal marks. These settings affect notation only.

With the loop off, recording can start at the end and continue into new bars. The piano roll shows held notes as you play. The staff updates as bars finish. Stop keeps one empty bar after the last recorded note, and Undo restores the notes and song length together.

Choose Replace in the transport to re-record from the playhead through Stop, including silence. Shift+R switches between Replace and Overdub. Recording settings also offer up to four bars of pre-roll.

Version 0.1.0 is in release validation. The software is implemented; it is not yet a fully verified release. Ubuntu 24.04 checks cover built-in SF2/SF3 synthesis, MIDI/audio import, recording/editing, shared staff/roll/audio timing, clips, scenes/registers/cues, scripted routing, follow modes, linked MuseScore 3 conversion, FluidSynth recovery and external MIDI routing. Tests use muted audio and simulated ports where physical interaction is unnecessary.

The approved PipeWire comparison reduced the Built-in buffer-128 median estimate from 82.7 ms at quantum 1024 to 18.7 ms at 256; the original 1024 setting was restored. FluidSynth's muted PipeWire driver started at both sizes and displayed configured 10.7 ms. These are different kinds of readouts, not physical latency measurements. See [latency observations](docs/latency.md).

On the earlier controller layout, physical KeyLab splits, wheels, chords and sustain release passed; display text, pad colours and beat chase passed in DAWs mode. Verified mode-specific control addresses are included; all DAWs bank B addresses were captured, and pad 2/Register 2 sync passed without piano-note leakage. Arturia mode showed no visible feedback; select DAWs manually and leave automatic Arturia selection off. Some control variants, Axiom capture, audible native/external output, alternate cue devices and performance tuning remain unverified. Windows, physical pen behavior, MuseScore 4 and clean-account operation remain untested. This PC reports VLC as its MIDI handler; MuseScore import/association setup is described in its guide. A real MuseScore 3 GUI Ctrl+S save re-synced during packaged-player playback in an isolated silent setup. Linux AppImage startup, packaged notation/audio assets, external routing, moved-project/font recovery and portable settings loading/saving passed. Physical and platform gates in the [release checklist](docs/release-checklist.md) remain. No release has been tagged or published.

## Start

On Linux, run `./run-xmxsplayer.sh` from the checkout to build and launch the current version. To open a saved song directly, pass its project folder, for example `./run-xmxsplayer.sh "/path/to/song"`.

Use your own SF2/SF3 fonts and MIDI controller; the on-screen keyboard also works. FluidSynth and MuseScore are optional, separately installed programs.

With Node.js 24 and npm:

```sh
npm ci
npm run dev
```

Choose **New project**, select an empty folder, and locate a soundfont in **Soundfonts** if needed. Play the keyboard, import a MIDI/reference audio file, set a loop and reduce Speed. Arm a LIVE track to record, or set it to AUTO for computer playback. Save with Ctrl+S. Follow [First project](docs/quick-start.md) for the complete flow.

Portable targets are Linux x64 AppImage and Windows x64 portable EXE/ZIP. Linux startup and packaged flows are verified on the development computer; see [Portable builds](docs/portable-builds.md). Windows cross-builds passed, but runtime support is experimental. The portable EXE includes approved LGPL launcher helpers with bundled sources and [replacement instructions](docs/windows-launcher.md); the ZIP has no NSIS launcher. The tag-triggered workflow creates drafts only and has not been run for a release.

## Controllers

- **Arturia KeyLab Essential 61 mk3:** main MIDI input, transport, learning, banks, bindings and pad/display feedback. DAWs display/colours/beat chase and the captured controls are verified; see the mode-specific address table in [Controllers](docs/controllers.md). Remaining variants need Learn. Automatic Arturia program selection is off by default.
- **M-Audio Axiom 61 mk2:** profile and default register mappings are included; run Learn once on the actual controller. Physical verification remains pending.
- **Other Web MIDI controllers:** use the generic profile and Learn. Unknown controls remain unassigned until captured.

Bindings can vary by controller and scene, with conditions and beat/bar timing. Registers, zones and patches route virtual tracks independently of incoming MIDI channels. External destinations use physical port/channel assignments and share the receiver's channel-wide controls. See [Controllers](docs/controllers.md) and [External MIDI](docs/external-midi.md).

## Guides

- [First project](docs/quick-start.md), [Project folders and portable settings](docs/project-files.md)
- [Live performance: zones, patches, scenes and cues](docs/live-performance.md)
- [Controllers and feedback](docs/controllers.md), [Audio clips](docs/clips.md)
- [Follow modes](docs/follow-modes.md), [Scripting and examples](docs/scripting.md)
- [MuseScore linking and staves](docs/musescore-link.md)
- [FluidSynth](docs/fluidsynth.md), [External MIDI](docs/external-midi.md), [Audio latency](docs/latency.md)
- [Portable builds](docs/portable-builds.md), [Release verification](docs/release-checklist.md)

## Known limits

- The new orchestra pad layout needs a physical KeyLab pass in DAWs mode, including bank B beat retention across bank switches. Preset ranges need listening checks on FluidR3_GM and MuseScore_General.
- Linux Chromium may print `inotify_init failed: Too many open files` while the player still starts. It can indicate exhaustion of the per-user inotify instance limit or the process file-descriptor limit. Check `/proc/sys/fs/inotify/max_user_instances` and `ulimit -n`. Close unused watcher-heavy applications. For project file watching on a constrained workstation, launch with `CHOKIDAR_USEPOLLING=1`.


- Recorded/edited staves use automatic single-voice notation. Polished engraving comes from the linked score. Only the map-owner score renders as staves; other linked scores use the piano roll. D.C./D.S./Coda jumps are not unrolled.
- App-to-MuseScore transfer uses exported MIDI that you open/import in MuseScore; it does not reload an already open MuseScore document. YAML comments are lost when rewritten.
- FluidSynth sequenced events use a 1 ms due timer and can incur roughly 1–4 ms scheduling jitter; this is not a measured hardware guarantee. Live events dispatch immediately to its managed stdin path. Its tested stdin interface lacks instrument aftertouch; use Built-in for pressure-sensitive synth parts.
- Separate-device cue audio has approximate sync and realigns every five seconds. Neither software latency readout measures keyboard-to-speaker delay. High output latency can put audible-beat pad feedback behind the on-screen transport lamps.
- External MIDI routes sharing a channel cannot have independent programs or expression. Conflicting-program notes are skipped while another program has held/sustained notes. Use separate channels for overlapping sounds.
- Axiom needs Learn; Windows behavior and MuseScore 4 await physical testing. There is no editable node graph or handwriting recognition; pen input draws in the piano roll.
- Scripts require trust for each changed source version. They run without Node access, but synchronous loops can still stall the engine; this is not a hard CPU/memory sandbox.

## Development

| Command | Purpose |
| --- | --- |
| `npm run check` | Typecheck, lint and unit tests |
| `npm run test` | Vitest; append a file path for a focused run |
| `npm run build` | Compile all processes and renderers |
| `npm run smoke` | Build, mount UI and handshake with the engine; real MIDI disabled |
| `npm run dist:linux -- --publish never` | Build Linux x64 AppImage locally |
| `npm run dist:win -- --publish never` | Build Windows x64 portable EXE and ZIP on Windows |

Linux smoke needs a display, or `xvfb-run -a npm run smoke`. If the host exhausts its file-watch quota, use `CHOKIDAR_USEPOLLING=1`. See [Portable builds](docs/portable-builds.md) for packaging and notice regeneration.

## License

Application code and original icon: [MIT](LICENSE). Dependencies, fonts and desktop runtime retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md). Verovio is shipped unmodified as separate replaceable LGPL-3.0 modules. Soundfonts, recordings and scores are not bundled.
