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

MusicXML (`.musicxml`) and compressed MusicXML (`.mxl`) import directly, without an installed MuseScore executable. The score must use MusicXML partwise format. Archives must declare their root score in `META-INF/container.xml`; score XML is limited to 64 MiB. Invalid saves retain the previous notes and show an error in Sources.

## Reading staves

Choose **Staff**, **Roll** or **Per track** in the transport. In Per track, each MIDI header has its own view switch. Staff lanes share one engraved system and one time axis with the ruler, piano rolls and audio. Page view advances by system; Center view keeps the playhead fixed. Click notation to seek. Staff scale and Dark/Paper controls sit below the lanes; Ctrl+Shift+wheel also changes staff scale.

The map owner's score supplies the notation. Forward/backward repeats and first/second endings are written out in playback order. Other linked scores and drum tracks use piano roll. A staff-count mismatch disables notation for that source and shows a warning. D.C., D.S., Coda and segno remain written as supplied, with a warning; expand those structures in MuseScore before performing. An unrolled score whose duration differs from its MIDI by more than one bar also warns about alignment.

Unlinked and locally modified tracks generate notation from their notes. Generation quantizes to the track grid, groups equal-onset/equal-length notes as chords, uses one voice, cuts overlaps at the next onset, and ties notes across barlines. This is a reading view: use the piano roll or MuseScore for editing. Complex independent voices are preserved only on synced score staves. Sounding notes use track colours; follow modes outline the expected notes in amber.

## Remaining verification

A real MuseScore 3.2.3 GUI save was verified on Ubuntu: Ctrl+A/Up changed pitches in a disposable copied score, and Ctrl+S saved it. The packaged player watched the save and imported the changed first pitch from 59 to 60 while looping playback continued. The original score hash was unchanged, and MuseScore closed cleanly. This complements the existing headless export, protected-edit and undoable-discard checks.

The GUI test used temporary settings, disabled MIDI input, a process-local silent ALSA configuration and disabled first-use tours. Earlier isolated launches with synthesis disabled crashed with exit 139; the successful setup kept the internal synthesizer available without hardware audio I/O. This does not verify MuseScore audio playback or a normal desktop audio configuration.

An installed MIDI-file association is needed for exported MIDI to open in MuseScore. OS launch requests and exported contents are tested separately; actual desktop association behavior, MuseScore 4 and Windows still require a user check.

Read-only checks on the verification computer identified saved MIDI as `audio/midi` and reported `vlc.desktop` as its default handler. Automatic opening in MuseScore is therefore not configured there. Import the exported file from MuseScore, or choose MuseScore as the desktop MIDI handler. No association was changed, and the default application was not launched by this check.
