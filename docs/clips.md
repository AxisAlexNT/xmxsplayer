# Audio clips

Clips play fragments of project audio independently of the track lanes. Expand **Clips**, choose **+ From file**, and select WAV, MP3, OGG, FLAC or M4A. The file is copied into the project’s `audio/` folder. To reuse reference audio, select its track, enable the transport loop, then choose **From loop**. This uses the overlap between that loop and the selected track.

In the editor, drag the waveform edges to select the fragment. Scroll or pinch to zoom; drag the background to pan; Fit shows the whole file. Focus either edge and use arrow keys for 1 ms steps, Shift+arrow for 10 ms, or Home/End. Released edges snap to a nearby zero crossing, within 5 ms. An explicit project beat map for the same audio file instead supplies bar snapping. Start and End also accept exact seconds without snapping.

**Audition** plays the current draft once, without tempo sync, on its chosen main/cue output. Stop audition stops it. **Done** saves all editor changes as one undo step; **Cancel** discards them. Delete clip removes its bindings and cue references but keeps the audio file. Save the project to persist changes to `clips.yaml`. External valid YAML edits reload through the project’s usual conflict handling.

Tap a clip tile to launch it, or use its pencil to edit. Tiles are tinted when stopped, bright with a progress bar when playing, and dashed amber while a start or stop is queued. Drag a tile onto a control in **Controls**: pads/buttons get Launch on press; knobs, faders and relative encoders get Sweep on change. The Controls scope determines where the binding is stored. Unlearned controls open Learn after the drop. Click the control afterward to adjust its action, condition or timing. Clip colours supply the binding’s feedback colour unless another feedback layer overrides them.

## A four-bar drum loop on a pad

1. Add the recording, select exactly four bars and name the clip **Break A**. Set **Launch (pads)** to **Toggle** and enable **Loop**.
2. Enable **Tempo sync** and enter **16 beats** for four bars of 4/4. Detect estimates the beat count from fragment length at the tempo under the playhead; check it against the recording.
3. Choose **Bar** under Start / stop on. Use an exclusive group such as `breaks` for loops that should replace each other. Choose a short fade, such as 10 ms.
4. Done, then drag Break A onto a learned pad. Press during playback: it starts at fragment position zero on the next bar. Press again to stop on a bar. A second clip in `breaks` replaces the first at its launch boundary.

Sync changes the playback rate to fit the fragment’s declared beat count at the current tempo and transport speed, while preserving pitch. Written tempo changes and the follow factor also affect sync. A transport hold freezes synced clips; release resumes their phase. When the transport is stopped, launches happen immediately at the tempo under the playhead. Unsynced clips keep their original speed and continue through transport holds. Transport Stop does not stop independent clips; bind **Clip → Stop all** or use Panic when needed.

Other pad launch modes are **Hold** (press starts, release stops at the selected boundary), **One-shot** (plays once and stops itself; ignores Loop), and **Retrigger** (each press restarts at zero). With **Pad pressure → gain**, velocity and aftertouch scale the clip’s gain. A held pad retains its original release and pressure target even if a scene changes its binding.

## A riser on a fader

1. Add a suitable sound and name it **Riser**. In On a fader or knob choose **While moving**, range **−12 to +12 st**, release **300 ms**. Set a fade such as 20 ms.
2. Done, then drag it onto a learned fader. This creates a Sweep action on Change.
3. Moving the fader starts a loop immediately and changes its pitch. Each actual movement extends the 300 ms release timer. Leaving the fader still fades and stops the clip after that time. Repeated identical absolute values do not extend it.

Sweep starts bypass Now/Beat/Bar quantization, but retain sync, exclusive groups, output choice and fades. Sweep always loops the fragment, including a clip whose pad mode is One-shot. Relative encoders accumulate changes into a virtual position and clamp at the ends. Sweep bindings do not use soft takeover.

## A drone on a knob

1. Add a sustained fragment named **Drone**. Choose **Position, bottom = off**, range **−12 to +12 st**, and **Off below 0.02**.
2. Done, then drag Drone onto a learned knob. Above 2% it starts immediately and keeps sounding while the knob stays still. Turning it to 2% or lower fades and stops it.
3. The pitch range spans the useful portion above the off threshold: just above 2% is approximately −12 st; fully up is +12 st.

For a loop launched from a pad, choose **Pitch only** and bind a knob to Sweep. The knob bends its pitch, including the pitch of the next launch, without starting or stopping it. A separate Clip → Pitch action maps the control to the configured semitone range; Clip → Gain sets its level. **Keep tempo** shifts pitch without changing speed. **Tape (pitch + speed)** changes both and is disabled while tempo sync is on.

## Scripts and limits

```ts
const drone = xm.clip('drone')
xm.on('control', e => {
  if (e.id !== 'context.1' || e.edge !== 'press') return
  if (drone.playing) drone.stop()
  else drone.launch()
})
```

`launch()` uses the clip’s pad mode and quantization. `stop()` uses its stop quantization. `playing` reflects actual playback, so a queued start is false and a queued stop stays true until its boundary. `semitones` and `gain` are live read/write properties and do not rewrite the saved clip. Disable/reload releases clips owned by the script; clips subsequently launched from another control retain that ownership. See [Scripting](scripting.md).

Each used clip has its own stereo stretch node; decoded source audio is shared with audio tracks and other clips using the same file. Long files and many simultaneous clips consume memory. An imported file remains in the project even if its new clip editor is cancelled. Changing a fragment or its output stops that clip and prepares a new voice on the next launch.

The build adds an atomic clip-plan message to the MIT Signalsmith worklet so future start/stop segments are installed together. Its normal scheduling API remains available to audio tracks. The [upstream MIT notice](licenses/signalsmith-stretch.txt) ships beside the worklet. Separate-device cue timing is approximate. Linux Electron decoding has been verified for all five formats; Windows codecs, physical controller timing, pad colours and separate outputs still need hardware checks.
