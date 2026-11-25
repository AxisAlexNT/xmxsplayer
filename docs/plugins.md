# Plugin instruments and effects

On Linux, open an instrument’s preset picker and choose **Plugin instrument…**. Select an installed instrument to assign it to the track. To add an effect to a plugin instrument, choose **FX → Add effect… → Plugin effect…**. **Master FX** can process the mix of plugin instruments. Carla starts when the project needs it. Changing the plugin order reloads the host, so applying the change during playback can cut off sounding notes.

To try a first arrangement on this machine, select **Geonkick Single** and add **Dragonfly Hall Reverb** to the master. The Linux integration test played notes through this chain and measured output from both plugins with a dummy audio driver. For DrumGizmo, select a drum kit in the instrument before testing its sounds.

## Available on the Linux development machine

| Installed | Use |
| --- | --- |
| Geonkick, DrumGizmo | Drum instruments |
| Dragonfly | Hall, room, plate and early reflections |
| LSP | Dynamics, sidechain compression, multiband processing, EQ and limiting |
| x42 | EQ and meters |

Hydrogen and ZynAddSubFX are installed as standalone applications. Start the application, select **External MIDI** in the instrument picker, and choose its MIDI port. Route the standalone application’s audio to the output where you want to hear it.

## Other requested plugins

Use the supplier’s Linux package or build instructions, then choose **Rescan** in the plugin browser. The following plugins were absent from the development machine’s standard plugin directories.

| Plugin | Official source |
| --- | --- |
| Surge XT | [Surge downloads](https://surge-synthesizer.github.io/downloads/index.html) |
| Vitalium | [DISTRHO Ports](https://github.com/DISTRHO/DISTRHO-Ports) |
| Helm | [Helm downloads](https://tytel.org/helm/) |
| sfizz | [sfizz plugin builds and instructions](https://github.com/sfztools/sfizz-ui) |
| Zyn-Fusion / ZynAddSubFX plugin | [ZynAddSubFX downloads](https://zynaddsubfx.sourceforge.io/download.html) |
| Calf Studio Gear | [Calf builds and installation](https://github.com/calf-studio-gear/calf) |

## Moving a project

Portable export records the format and identifier of each required plugin. On another Linux machine, install the same plugin format and use **File → Open portable project…**. The player lists missing plugins after import. The project retains its instrument assignments, effect order, sidechain selections and saved effect parameter values. With the matching system Carla bindings installed, **Instrument window** and **Plugin window** open the native editor. Saving the song writes native state beneath `plugins/`, which portable export includes. Dragonfly’s dry-level setting was verified across a full Carla process restart. Keep external drum-kit sample files available at the locations the plugin expects. On a Carla installation without its matching bindings, use the plugin’s standalone preset-saving workflow. Windows plugin hosting is untested.
