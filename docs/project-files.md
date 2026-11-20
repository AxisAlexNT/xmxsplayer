# Project folders

`project.yaml` holds project metadata and tracks; `setup.yaml` holds registers, zones, patches, scenes and cues; `bindings.yaml`, `clips.yaml`, `mappings/*.yaml` and `script.ts` hold their corresponding data. Unlinked or locally modified MIDI tracks are stored as format-0, PPQ-480 `tracks/<id>.mid` files. Zone keys accept MIDI numbers or note names (`C4` = 60); saved zones use note names. Identifiers are stable readable slugs.

Saving rewrites only changed files using temporary files and atomic renames. YAML comments are not preserved when rewritten. Invalid external changes retain the previous document and show a file/path error in Log. `.xmxs/` is disposable cache; `xm.d.ts` supplies standalone script API declarations.

If the system has exhausted its native file-watch quota, launch with `CHOKIDAR_USEPOLLING=1` to use polling.

Settings live in the Electron user-data directory. Set `XMXS_DATA_DIR`, or create `xmxsplayer-data` beside the executable, to use a portable settings directory.


On Windows the normal settings path is `%APPDATA%\xmxsplayer\settings.json`; on Linux it is normally `~/.config/xmxsplayer/settings.json`. `XMXS_DATA_DIR` takes precedence over a portable data folder. Settings contain computer-specific devices, executable paths and script trust; they are separate from the project. Projects keep soundfont filenames and MIDI destination names so each studio can resolve its own installations.

Portability verification opened a saved project from two copied folders with spaces in their paths, restored all three tracks and the edited linked notes, and resolved a renamed SF2 by filename in another configured directory. A fresh instance with that directory absent showed the missing-font state; Locate restored muted synthesis and saved the directory in computer settings. Another fresh instance reopened without asking again. These checks used packaged code, simulated MIDI and muted output; they do not establish operation on another OS account or studio computer.

Recording mode and pre-roll are stored in `project.yaml`. Installed orchestras and member settings are stored in `orchestras.yaml`. Projects saved before these fields existed open with overdub, zero pre-roll and no orchestras. Audio spectra are disposable binary cache files under `.xmxs/`.
