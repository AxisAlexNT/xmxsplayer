# First project

1. Choose **New project** and an empty folder. The project opens with a live Piano track and a full keyboard zone. In **Soundfonts**, use **Locate…** if the default font is missing, or **Add soundfont** to add your own SF2/SF3. Fonts are found by filename on each computer; none are bundled.
2. Play the connected controller or the keyboard strip. Open a track's instrument chip, choose **Change preset…**, select a font and preset, then **Use preset**. Choose Built-in, FluidSynth or an external MIDI destination as appropriate. Configure the main output and buffer in **Settings → Audio**; see [latency](latency.md).
3. Import MIDI or reference audio with the File menu. Shift-drag the ruler to define a loop. Turn **Speed** down to hear the passage slowly without changing pitch. Audio headers provide channel isolation, pitch and filter controls. Use the beat-grid controls to align the reference audio with musical bars.
4. Set the track you will play to **LIVE**, arm it and press Record. Recording from stopped starts playback. Notes are captured after zone routing, with sustain and expression. Stop and use Ctrl+Z to undo the whole take. Choose **AUTO** to have the computer play the recorded notes.
5. In **Roll**, select, draw or erase with the lane tools. Drag selected notes to move them, their edge handles to resize, or Alt-drag vertically to edit velocity. Ctrl+D duplicates; Delete removes; arrow keys nudge. Quantize applies the snap grid to selected notes, or the latest recorded take if nothing is selected. Shift-wheel pans; two-finger gestures pan and zoom. Pen input draws notes, not handwritten notation.
6. Choose **Staff** for automatic notation or [link a MuseScore score](musescore-link.md) for engraved parts and watched saves. Page view advances pages at the right edge; Center keeps the playhead in the middle. Choose Staff/Roll globally or per track. Both share the same bars with reference audio.
7. Split or layer the keyboard by editing its zones, and route each track through Patch. Capture a scene for another section, or use registers to gate accompaniment. [Live performance](live-performance.md) explains cues, conditions and held-note behavior. Learn the controls and bindings in [Controllers](controllers.md).
8. Save with Ctrl+S. Close and reopen the project folder to check restoration. To move the arrangement and its referenced soundfonts to another computer, use **File → Export portable project…**. On the destination computer choose **File → Open portable project…**, select the archive, then choose an empty project folder. Select the local audio and MIDI outputs and install any required plugins.

Use [clips](clips.md) for independent audio fragments and pad loops, [follow modes](follow-modes.md) for accompaniment that waits or follows your tempo, and [scripts](scripting.md) for conditions beyond the binding editor.

Project edits are explicit-save. External YAML changes apply live when valid; conflicts offer **Keep mine** or **Take file**. Ctrl+Z/Ctrl+Y undo and redo document edits. Log names invalid files and retains the previous working document. YAML comments are not retained after an app save.

## Practice slowly or change the written tempo

For a reference recording at roughly one-third speed, set **Speed** to **33%**, record along with it, then click the percentage to return to **100%**. The recorded notes keep their positions on the musical grid. Use **File → Export MIDI for MuseScore** after quantizing the take.

To change the written tempo, click the **BPM** value in the transport. **Scale all** adjusts every tempo proportionally and preserves tempo changes. **Rewrite all** sets one tempo for the song. **This section** shows the affected bars and uses the enabled loop, or the current tempo segment when looping is off. Double-click the BPM value to type a number. A linked score or a tapped beat map controls its own tempo.

## Find an instrument sound

In **Soundfonts → Manage sound library…**, open **Folders**, choose **Add folder…**, and **Rescan**. Open **All found**, search for a font, then choose **Add**. Enable **Copy added soundfonts into this project** when you want a local copy. In a track’s instrument picker, audition the preset and choose **Use preset**.

## Record beyond the last bar and read a piano part

Turn looping off, arm a live MIDI track, and keep recording past the final bar. Stop after releasing the last note. The timeline extends to fit the recorded notes. Use **+ Bars** if you want to add empty measures ahead of time.

For a recorded piano part, switch the track to **Staff** and choose **Grand**. Under **Hands split**, start with **Auto**, select **At C4**, or choose **Pick…** and press the desired split key. Enable **2 voices** for overlapping rhythms and **Pedal marks** to display recorded sustain.

## Edit bars and record a replacement

Right-click or long-press a bar number on the ruler. Choose **Insert bars before**, **Insert bars after** or **Delete bars**, enter a count and choose **Apply**. Shift-drag a loop first to make **Delete loop range bars** available. **+ Bars** below the tracks appends a measure. MIDI events and the musical grid move together. Reference audio keeps its absolute position. A linked score owns its bar grid, so edit that grid in MuseScore. Clear tapped beats before inserting, deleting or changing the signature. A manual tempo edit converts earlier taps to tempo entries.

Choose **Time signature from here** or **Tempo from here** on the first affected bar. For example, choose bar 9, then 3/4 to keep bars 1–8 in their original meter. Undo restores the previous grid and track data together.

Arm the part, seek to the punch-in position and choose **Replace** in the recording settings beside the transport buttons. **Shift+R** switches modes. Set **Pre-roll bars** to hear up to four preceding bars, then press Record. Stop at the end of the passage. Silence overwrites existing notes inside the passed range. On a loop the latest pass wins wherever it overlaps. Undo restores the original take.

## Compare a transcription to its spectrum

Import a reference and choose **Spectrum** or **Both** in the audio header. The worker builds a pitch-versus-time image and caches it in the project’s `.xmxs/` folder. Both keeps a waveform strip above the spectrum. Hover over or touch the image to read pitch and frequency. Select **Side** to inspect the difference between channels. Use **Floor** and **Gain** to bring out quieter harmonics.

Select a MIDI track under **Overlay** to draw its note outlines, then choose **Match pitch range** for its automatic piano-roll range. Audio offsets, bar positions and overlays use the same time axis at every playback speed. See [Orchestral sets](orchestra.md) to play a part with range-aware layering.

## Try a guided tutorial

Press **F1** or choose **Help → Tutorials**. Choose **First project** for a walkthrough of naming, playing, recording and saving. The **?** buttons in Orchestra, Controls and Effects open the picker with a related tour selected.

Choose **Continue**, leave **Practice copy** selected and choose **Start tutorial**. If your open project has unsaved edits, the app asks whether to save them before making the copy. At the end, choose **Save as project…** and enter a new folder name to keep your arrangement, or choose **Discard practice copy** to return to where you started. If you close the window during practice, choose **Save as project…**, **Discard practice copy**, or **Cancel quit** to continue playing. Choose **Current project** at the start if you want the tutorial edits in your open arrangement.

Use the highlighted control to try the step. **Next** moves on, **Back** revisits the previous step, and **Esc** opens the exit confirmation. The pad, drum roll and filter sweep tours provide an on-screen controller when a mapped controller is unavailable.

## Read PDF sheet music while playing

Choose **File → Import PDF sheet music…** in an open project. The app copies the score into the project’s `scores/pdf/` folder. Scroll inside the score to move through its pages independently of the timeline. Drag the lane’s lower edge to change its height, or Tab to the resize handle and use the Up and Down arrows. The project saves the height. Select **2 across** for a two-page spread. **Night mode** switches between a dark sheet and the original paper colors.

Choose **View → PDF placement → Right pane** to keep the score beside the tracks. Select a score by name, drag the divider to adjust its width, or choose **Sheet only**. Press **Ctrl+P** to hide the sheets or bring them back.

To follow playback, seek to a bar and scroll the desired passage about a quarter of the way down the score viewport. Choose **Add marker here**, repeat for later bars, then enable **Follow bars**. For manual turns, choose a PDF action in the controller binding editor and select **Next** or **Prev**.
