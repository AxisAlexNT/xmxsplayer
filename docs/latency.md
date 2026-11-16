# Audio latency

Configure each performance computer separately in **Settings → Audio**. Save the project before using **Restart now**. Keep the output, sample rate and test passage consistent when comparing settings.

Built-in displays **measured** buffer plus output latency reported by Chromium. This is an estimate, not a physical keyboard-to-speaker measurement. FluidSynth displays **configured** latency: period size × periods ÷ sample rate. Its number does not measure the device or operating-system queues. Neither figure includes every source of live performance delay.

## Ubuntu Studio 24.04

1. Choose **Built-in**, the intended **Main output**, and **48000** Hz. Try **Buffer size 256**, then use **Restart now** when shown; this saves the settings and restarts the app. Repeat with **128**. Record the buffer/output breakdown after several updates. A smaller requested buffer does not guarantee a smaller output queue. Compare while playing a representative project before keeping a setting.

2. Inspect PipeWire without changing it:

   ```sh
   pw-metadata -n settings
   ```

   This command succeeded on the verification computer. Its settings were `clock.rate = 48000`, `clock.quantum = 1024` and `clock.force-quantum = 1024`. A forced quantum fixes the graph's processing block size until changed; 1024 frames at 48 kHz is one 21.3 ms processing period. It is not total audio latency. [PipeWire runtime settings](https://docs.pipewire.org/1.4/page_man_pipewire_1.html), [pw-top documentation](https://docs.pipewire.org/devel/page_man_pw-top_1.html).

3. For a temporary comparison, first record the previous `clock.force-quantum` value. The following documented change affects other applications using the graph too. **This temporary change and restoration were tested with permission on the verification computer.**

   ```sh
   pw-metadata -n settings 0 clock.force-quantum 256
   pw-metadata -n settings
   ```

   At 48 kHz, 256 frames represent 5.3 ms per graph period. Repeat the Built-in and FluidSynth checks below, then restore the previous value. The verification computer was restored with:

   ```sh
   pw-metadata -n settings 0 clock.force-quantum 1024
   ```

   Restore `0` only if the original value was `0`: that releases the forced size and lets graph negotiation resume. These write commands come from the [official runtime metadata interface](https://docs.pipewire.org/1.4/page_man_pipewire_1.html); both values were read back successfully during verification.

4. Monitor the active output while playing:

   ```sh
   pw-top -b -n 2
   ```

   This batch command succeeded. Use `pw-top` interactively for longer monitoring. Inspect the output driver row's `QUANT`, `RATE` and changes in `ERR`; the latter includes xruns and other errors. If errors increase or audio breaks up, raise the quantum or period size and repeat the same passage. A quiet two-sample observation does not establish performance under load. [Column definitions and options](https://docs.pipewire.org/devel/page_man_pw-top_1.html).

5. To compare native synthesis, choose **FluidSynth (native)**, Detect/Test its executable, and choose `pipewire` or `jack` if supported by the installed build. Begin with period size **256**, periods **2**, then try **128** or **64**. At 48 kHz, the expected configured readouts are **10.7**, **5.3** and **2.7 ms**, respectively. The driver and graph may impose additional buffering; a smaller configured figure does not prove lower physical latency. PipeWire driver startup was exercised with gain zero in the comparison below; audible output timing and JACK operation remain untested. [FluidSynth driver settings](https://www.fluidsynth.org/api/settings_audio.html).

   FluidSynth owns its output device. Main/Cue output selectors and the app limiter affect built-in synthesis, reference audio, clips and clicks. See [FluidSynth configuration](fluidsynth.md) for native device arguments, instrument overrides and sequencer alignment offsets. Keep compensation offsets at zero until you have a repeatable timing comparison; they do not reduce live key latency.

6. Check real-time permissions if the graph reports scheduling problems:

   ```sh
   id -nG
   ulimit -r
   ```

   Both commands succeeded: the verification account belongs to `audio` and reports a real-time priority limit of `95`. This does not verify the priority of a particular audio thread. PipeWire can obtain scheduling through an adequate resource limit or the Realtime portal/RTKit fallback; distribution configuration determines availability. No permission changes were made. [PipeWire real-time module](https://docs.pipewire.org/1.6/page_module_rt.html).

7. Persist a chosen default only after testing it. **Untested configuration example:** create a new user drop-in at `~/.config/pipewire/pipewire.conf.d/20-xmxsplayer-clock.conf` containing the following. Choose another filename if that file already exists, so an existing configuration is preserved.

   ```text
   context.properties = {
     default.clock.quantum = 256
   }
   ```

   Restart the audio session when other audio work can be interrupted, then repeat steps 2 and 4. This sets a default used when clients do not suggest a size; a runtime forced value can still override it. To undo, remove only this newly created drop-in and restart the session again. No drop-in or service restart was performed in verification. [PipeWire configuration and user drop-ins](https://docs.pipewire.org/1.4/page_man_pipewire_conf_5.html).

8. Choose the engine by actual results on the performance machine. Built-in requires no separate synth executable and supports pressure-sensitive instrument parts. FluidSynth provides a separate native driver path but its managed stdin interface lacks instrument aftertouch on the tested 2.3.4 build. Use the same font, arrangement and output when comparing; neither engine is guaranteed to be faster.

9. For a private click or reference track, set **Cue output → Channels 3–4** on an output exposing at least four channels. Otherwise the app logs a warning and mixes cue into Main. **Separate device · approximate sync** uses another audio clock; reference audio realigns every five seconds. Test routing and audible alignment before performance. Physical multichannel/separate-device output is untested. Native FluidSynth instruments bypass this cue graph.

10. For external instruments, choose **External MIDI port…** in the instrument picker, then select the receiver's port, channel, bank and program. Qsynth or hardware handles its own synthesis, audio driver and output latency. The app does not measure that receiver's delay. See [External MIDI](external-midi.md) for numbered setup steps and shared-channel limits. Software routing is verified with simulated ports; Qsynth and hardware operation remain untested.

## Verification observations

Ubuntu Studio 24.04, PipeWire 1.0.5, FluidSynth 2.3.4, 48 kHz. Each row uses a fresh hidden app instance, muted audio, simulated MIDI ports and five readouts approximately two seconds apart. Built-in runs used an empty project. FluidSynth runs opened the native PipeWire driver with gain zero and loaded a soundfont; they sent no notes to hardware. Figures are rounded to one decimal place. They are idle software estimates, not a listening test, round-trip measurement or performance benchmark.

| Graph quantum | Built-in buffer request | Buffer readout | Output readout range | Median total readout |
| --- | --- | --- | --- | --- |
| 1024 | 128 | 2.7 ms | 72.0–96.0 ms | 82.7 ms |
| 1024 | 256 | 2.7 ms | 72.0–96.0 ms | 74.7 ms |
| 256 | 128 | 2.7 ms | 16.0–32.0 ms | 18.7 ms |
| 256 | 256 | 2.7 ms | 24.0–32.0 ms | 26.7 ms |

| Graph quantum | FluidSynth period size × periods | Native driver startup | FluidSynth displayed latency |
| --- | --- | --- | --- |
| 1024 | 256 × 2 | PipeWire, muted gain; passed | Configured 10.7 ms |
| 256 | 256 × 2 | PipeWire, muted gain; passed | Configured 10.7 ms |

The FluidSynth column is calculated configuration, not measured native output latency. It must not be treated as a direct performance ranking against Chromium's estimate. The accompanying Web Audio graph remained active for reference audio/clips/clicks during native tests; its median buffer-plus-output estimate was 90.7 ms at quantum 1024 and 26.7 ms at 256. Those values do not measure FluidSynth's output.

The comparison temporarily changed `clock.force-quantum` from 1024 to 256 with permission, read back both settings, and restored 1024. A separate final metadata check confirmed the restoration. No test Electron or FluidSynth processes remained. A pre-comparison two-sample `pw-top` check showed the active output at 1024/48000 with `ERR = 0`; representative performance load, physical latency, listening and persistent configuration still require testing.

## Windows 11

**All Windows procedures below are documentation-based and untested.** There are no measured Windows latency figures for this release.

1. Start with **Built-in**, the intended **Main output**, **48000** Hz and buffer **256**. Save the project, then use **Restart now** when shown. Repeat at **128**, recording the in-app buffer/output estimate and checking the same passage for dropouts. Keep the chosen USB interface connected and select its output explicitly for consistent comparisons; check its manufacturer's supported driver and format settings. Do not infer Windows timing from the Ubuntu table.

2. For FluidSynth, follow the Windows binary link on the [official download page](https://www.fluidsynth.org/download/). Extract the Windows x64 release ZIP into a permanent folder, retaining its accompanying libraries. Enter the extracted executable's full path in **Settings → Audio**, then Test. The official release list included a Windows x64 ZIP when checked; its archive layout and operation have not been tested here. The Linux-tested executable is 2.3.4, which may differ from the downloaded Windows build.

3. Choose **FluidSynth (native)** and driver **wasapi**. Start in shared mode with period size **256**, periods **2**, at **48000** Hz. The expected configured display is **10.7 ms**; try 128 or 64 only if the driver accepts them and playback remains stable. Shared mode permits other applications to use the endpoint. Driver buffering and device capabilities determine actual timing. [FluidSynth settings](https://www.fluidsynth.org/api/settings_audio.html), [Microsoft shared/exclusive stream behavior](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams).

4. To try WASAPI exclusive mode, close the app and add the following separate arguments to `fluid.extraArgs` in its `settings.json`, preserving unrelated settings. The normal Windows location is `%APPDATA%\xmxsplayer\settings.json`. If an `xmxsplayer-data` folder exists beside the executable, that folder takes precedence; an explicit `XMXS_DATA_DIR` environment variable takes precedence over both.

   ```json
   ["-o", "audio.wasapi.exclusive-mode=1"]
   ```

   Restart, Test and Apply. The requested format, rate and period must be supported by the endpoint; initialization can fail. Exclusive access can prevent other applications, including the app's built-in reference/click output, from using that device. Remove these two arguments to return to shared mode. This setting and recovery procedure are untested on Windows. [FluidSynth WASAPI settings](https://www.fluidsynth.org/api/settings_audio.html), [Microsoft exclusive-mode behavior](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams).

5. If playback crackles, try disabling output enhancements in **Settings → System → Sound → the output device → Audio enhancements → Off**, then repeat the test. This is a troubleshooting comparison, not a promised latency reduction. Record the previous setting to restore it if it does not help. [Microsoft audio troubleshooting](https://support.microsoft.com/en-us/windows/hardware/audio/fix-distorted-or-crackling-audio-in-windows).

6. While connected to power, compare **Settings → System → Power & battery → Power mode → Best performance**, where available. Record the previous mode and account for the power/thermal tradeoff. Repeat the same project rather than assuming the setting resolves dropouts. [Microsoft power-mode instructions](https://support.microsoft.com/en-us/windows/experience/change-the-power-mode-for-your-windows-pc).

7. Test the complete performance: live keys, sustain, instrument changes, reference audio, clips and cue output. Save, quit and reopen to confirm the selected configuration persists. Record driver/build, interface, sample rate, buffer/period settings, app readouts and audible failures separately. Windows device selection, exclusive-mode coexistence and physical timing still require this verification.
