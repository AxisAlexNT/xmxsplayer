# MuseScore link

Choose **File → Link Score** or **+ Link score** in Sources. Select an `.mscz`, `.mscx`, `.mid`, `.musicxml` or `.mxl` file. A file outside the project is copied into `scores/`; a file already inside the project stays in place. Edit the project copy in MuseScore. The original outside the project is not watched or changed.

Open **Settings → Files** to Detect MuseScore or enter its executable path and Test it. Apply saves the path for this computer. Detection includes MuseScore 3 and 4 names, common Windows installation paths and MuseScore AppImages in `~/Applications`. An explicit invalid path produces an error instead of silently choosing another installation.

MuseScore scores convert headlessly to MIDI and MusicXML in `.xmxs/<source-id>/`. Each conversion has a 60-second limit. Warnings alone do not make an export fail; a successful exit and both output files are required. Conversion failures appear in Sources and leave the current notes intact. **Re-sync** retries. MuseScore 3.2.3 is verified on Ubuntu; MuseScore 4 and Windows still require testing.

Save the project copy in MuseScore to re-sync it. File watching waits for the save to settle, then converts it. Playback continues at its existing position. Each staff becomes one linked track in score order; multi-staff instruments use names such as “Piano (staff 1)” and “Piano (staff 2)”, including empty staves. Changes replace notes and expression on synced tracks while preserving their names, colours, modes, mixer settings, instruments, patch connections and zones.

The first successfully linked source owns the project's maps. A MuseScore source supplies tempo, time and key signatures; linked MIDI supplies notes only. Other sources do not replace the owner's maps. Unlinking the map owner releases map ownership and keeps the current maps. A staff removed or renamed in the score is retained with a red **not in score** badge. Its notes are saved locally; new staff keys append tracks. Review routing after changing the score's staff structure.

## Editing both ways

Editing or recording notes on a linked track changes its badge to amber **modified here**. Its notes are saved in `tracks/<id>.mid`. Later MuseScore saves leave these notes untouched; the sync message reports how many modified tracks were kept.

Use the track's **…** menu:

- **Export MIDI for MuseScore** writes that track with the project's tempo, time and key maps to `scores/export/<track-id>.mid` and asks the operating system to open it. Configure MIDI files to open in MuseScore. Merge the exported notes into your score there; exporting leaves the track protected until you explicitly re-sync it.
- **Discard & re-sync** replaces the local notes with the current score and returns the track to synced. This is one undoable document edit. A vanished staff must be detached to retain it as a local track.
- **Detach** keeps the notes and settings as an independent track.

**File → Export MIDI for MuseScore**, or the Sources export button, exports all modified and unlinked MIDI tracks together. **Unlink** removes a source and detaches its tracks without deleting the score file or notes. Source errors and last-sync times are visible in Sources. Save the project explicitly after changes.

## Current limits

MusicXML and compressed MusicXML note import report **needs staves milestone** until the notation milestone is implemented. MuseScore scores play as piano-roll tracks for now. Their exported MIDI expands repeats; the cached MusicXML retains written repeats. Staff rendering and repeat alignment follow in the notation milestone.

An installed MIDI-file association is needed for the exported MIDI to open in MuseScore. OS launch requests and exported MIDI contents are tested separately; desktop association behavior and an actual MuseScore GUI Ctrl+S workflow still need a user check. The automated desktop check edits a private copied score on disk, then verifies watched conversion during playback, protected in-app edits and undoable discard.
