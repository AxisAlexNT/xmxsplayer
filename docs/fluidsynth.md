# FluidSynth

Open **Settings → Audio**, choose **FluidSynth (native)**, then Detect its executable or enter a path and Test it. Choose an audio driver, period size, periods and gain, then Apply. This changes the default synth while playback continues; sounding notes are released before the switch. Built-in remains available without an external executable.

Each instrument can override the default. Click its instrument chip, choose **Change preset…**, then select Default, Built-in or FluidSynth in the preset picker. **Use preset** saves that choice. Preset audition uses the selected engine. Normal instrument changes retain held notes on their original destinations until release; changing the global default releases notes and resumes sequencing at the current position.

The transport names the default engine. Instruments with overrides may use another engine at the same time. Audio clips, reference tracks and the metronome continue through the built-in audio graph regardless of the selected synth.

## Drivers and latency

Linux defaults to PipeWire. JACK, PulseAudio and ALSA are also available when the installed FluidSynth build includes them. JACK enables output auto-connect and uses the client name `xmxsplayer`. Windows defaults to WASAPI, with DirectSound as another choice; Windows operation remains untested.

FluidSynth owns its audio output. The app's Main output, Cue output and limiter controls apply to built-in synthesis and audio tracks. Configure the native device through its driver. Advanced driver settings can be supplied in the `fluid.extraArgs` array in `settings.json`, using separate arguments such as `"-o", "audio.wasapi.exclusive-mode=1"`. WASAPI exclusive mode is untested here. Arguments that disable the managed shell, start a server, load a command file or select fast rendering are rejected.

FluidSynth latency is labelled **configured**: `period size × periods ÷ sample rate`. For example, 256 × 2 at 48 kHz is 10.7 ms. It does not measure the device, operating-system buffering, MIDI input or acoustic round trip. Built-in figures come from Chromium's AudioContext buffer/output readouts and also are not physical keyboard-to-speaker measurements. Native driver timing must be checked on the performance computer.

For manual sequencer alignment, `audio.compensationMs` in `settings.json` stores separate `web`, `fluid` and `midi` timing offsets. Positive values delay that path; negative values advance it within the available scheduling lookahead. Late events play immediately. Offsets apply to sequenced notes, controllers and pitch bend; note releases retain the offset of their original note. Live key input stays immediate. Defaults are zero; these offsets are not an automatic latency measurement.

## Fonts and recovery

Both engines load SF2 and SF3 fonts through the project's usual soundfont lookup. Missing fonts can be located in Soundfonts. The native process receives only issued file capabilities; font paths containing quotes, control characters or POSIX backslashes are rejected. Fonts remain loaded while their sounding or releasing slots still need them.

The app manages a separate FluidSynth child with hardware MIDI input disabled. It uses piped stdin without opening a TCP server. Unexpected exits release queued notes and retry with bounded exponential back-off. After restart, fonts and channel settings are restored, and sequencing resumes at the current position. Held live keys must be released and played again. Errors appear in Log. Quitting closes the child after engine shutdown.

The stdin interface in FluidSynth 2.3.4 has no channel or polyphonic aftertouch commands. Native instruments report this limitation once; use Built-in for pressure-sensitive synth parts. Pad pressure controlling clips remains independent of the synth engine.

Ubuntu verification used FluidSynth 2.3.4 with file audio output and disabled hardware MIDI. It covered SF2/SF3 loading, simultaneous live/sequenced slots, engine switches during playback, held-note/sustain release, preset overrides, process restart and zero remaining synthesis voices after release. Real PipeWire/JACK/ALSA/PulseAudio output, hardware timing and Windows drivers still require performance checks.
