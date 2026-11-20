# First project

1. Choose **New project** and an empty folder. The project opens with a live Piano track and a full keyboard zone. In **Soundfonts**, use **Locate…** if the default font is missing, or **Add soundfont** to add your own SF2/SF3. Fonts are found by filename on each computer; none are bundled.
2. Play the connected controller or the keyboard strip. Open a track's instrument chip, choose **Change preset…**, select a font and preset, then **Use preset**. Choose Built-in, FluidSynth or an external MIDI destination as appropriate. Configure the main output and buffer in **Settings → Audio**; see [latency](latency.md).
3. Import MIDI or reference audio with the File menu. Shift-drag the ruler to define a loop. Turn **Speed** down to hear the passage slowly without changing pitch. Audio headers provide channel isolation, pitch and filter controls. Use the beat-grid controls to align the reference audio with musical bars.
4. Set the track you will play to **LIVE**, arm it and press Record. Recording from stopped starts playback. Notes are captured after zone routing, with sustain and expression. Stop and use Ctrl+Z to undo the whole take. Choose **AUTO** to have the computer play the recorded notes.
5. In **Roll**, select, draw or erase with the lane tools. Drag selected notes to move them, their edge handles to resize, or Alt-drag vertically to edit velocity. Ctrl+D duplicates; Delete removes; arrow keys nudge. Quantize applies the snap grid to selected notes, or the latest recorded take if nothing is selected. Shift-wheel pans; two-finger gestures pan and zoom. Pen input draws notes, not handwritten notation.
6. Choose **Staff** for automatic notation or [link a MuseScore score](musescore-link.md) for engraved parts and watched saves. Page view advances pages at the right edge; Center keeps the playhead in the middle. Choose Staff/Roll globally or per track. Both share the same bars with reference audio.
7. Split or layer the keyboard by editing its zones, and route each track through Patch. Capture a scene for another section, or use registers to gate accompaniment. [Live performance](live-performance.md) explains cues, conditions and held-note behavior. Learn the controls and bindings in [Controllers](controllers.md).
8. Save with Ctrl+S. Close and reopen the project folder to check restoration. To move studios, copy the whole folder, choose the corresponding soundfonts/outputs and configure this computer's settings. Projects do not bundle fonts or external instruments.

Use [clips](clips.md) for independent audio fragments and pad loops, [follow modes](follow-modes.md) for accompaniment that waits or follows your tempo, and [scripts](scripting.md) for conditions beyond the binding editor.

Project edits are explicit-save. External YAML changes apply live when valid; conflicts offer **Keep mine** or **Take file**. Ctrl+Z/Ctrl+Y undo and redo document edits. Log names invalid files and retains the previous working document. YAML comments are not retained after an app save.

## Edit bars and record a replacement

Right-click or long-press a bar number on the ruler. Choose **Insert bars before**, **Insert bars after** or **Delete bars**, enter a count and choose **Apply**. Shift-drag a loop first to make **Delete loop range bars** available. **+ Bars** below the tracks appends a measure. MIDI events and the musical grid move together. Reference audio keeps its absolute position. A linked score owns its bar grid, so edit that grid in MuseScore. Clear tapped beats before inserting, deleting or changing the signature. A manual tempo edit converts earlier taps to tempo entries.

Choose **Time signature from here** or **Tempo from here** on the first affected bar. For example, choose bar 9, then 3/4 to keep bars 1–8 in their original meter. Undo restores the previous grid and track data together.

Arm the part, seek to the punch-in position and choose **Replace** in the recording settings beside the transport buttons. **Shift+R** switches modes. Set **Pre-roll bars** to hear up to four preceding bars, then press Record. Stop at the end of the passage. Silence overwrites existing notes inside the passed range. On a loop the latest pass wins wherever it overlaps. Undo restores the original take.

## Compare a transcription to its spectrum

Import a reference and choose **Spectrum** or **Both** in the audio header. The worker builds a pitch-versus-time image and caches it in the project’s `.xmxs/` folder. Both keeps a waveform strip above the spectrum. Hover over or touch the image to read pitch and frequency. Select **Side** to inspect the difference between channels. Use **Floor** and **Gain** to bring out quieter harmonics.

Select a MIDI track under **Overlay** to draw its note outlines, then choose **Match pitch range** for its automatic piano-roll range. Audio offsets, bar positions and overlays use the same time axis at every playback speed. See [Orchestral sets](orchestra.md) to play a part with range-aware layering.
