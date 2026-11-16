# xmxsplayer

A desktop workspace for transcribing music by ear and performing arrangements with MIDI controllers. Loop and slow reference audio, record the parts you hear, then combine live keyboard splits/layers with sequenced instruments, clips and scene changes.

## Status

Version 0.1.0 is in release validation. The software is implemented; it is not yet a fully verified release. Ubuntu 24.04 checks cover built-in SF2/SF3 synthesis, MIDI/audio import, recording/editing, shared staff/roll/audio timing, clips, scenes/registers/cues, scripted routing, follow modes, linked MuseScore 3 conversion, FluidSynth recovery and external MIDI routing. Tests use muted audio and simulated ports where physical interaction is unnecessary.

The approved PipeWire comparison reduced the Built-in buffer-128 median estimate from 82.7 ms at quantum 1024 to 18.7 ms at 256; the original 1024 setting was restored. FluidSynth's muted PipeWire driver started at both sizes and displayed configured 10.7 ms. These are different kinds of readouts, not physical latency measurements. See [latency observations](docs/latency.md).

Physical KeyLab splits, wheels, chords and sustain release passed; display text, pad colours and beat chase passed in DAWs mode. Verified mode-specific control addresses are included. Arturia mode showed no visible feedback; select DAWs manually and leave automatic Arturia selection off. Some control variants, Axiom capture, audible native/external output, alternate cue devices and performance tuning remain unverified. Windows, physical pen behavior, MuseScore 4 and clean-account operation remain untested. This PC reports VLC as its MIDI handler; MuseScore import/association setup is described in its guide. A real MuseScore 3 GUI Ctrl+S save re-synced during packaged-player playback in an isolated silent setup. Linux AppImage startup, packaged notation/audio assets, external routing, moved-project/font recovery and portable settings loading/saving passed. Physical and platform gates in the [release checklist](docs/release-checklist.md) remain. No release has been tagged or published.

## Start

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
