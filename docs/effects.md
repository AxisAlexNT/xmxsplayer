# Effects

Choose **FX** next to an instrument in its track header. **Master FX** processes the built-in main mix. For an orchestra, open **Effects chain** or expand a section and choose **Section effects**. An instrument’s own effects run first, followed by its section and orchestra effects.

Choose **Add effect** to insert a processor. The cards run from left to right. The power button bypasses a card. Drag its handle or use the arrows to reorder it. **Presets → Save preset…** keeps settings for that effect on this computer. Saving the project keeps the chain, its order and its current settings.

For a rhythmic synth part, add **Filter**, increase LFO depth and enable tempo sync. Add **Pump** and choose the kick MIDI track as its trigger. Depth sets how far the volume drops. Release sets how long the sound takes to return. **Delay** follows the tempo and playback speed. **Reverb** adds a stereo room tail.

FluidSynth instruments use their own reverb and chorus controls. External MIDI instruments use their device’s effects. Built-in instrument inserts load a dedicated synth for each affected instrument. Master effects share a single graph across the mix.

To bind a controller, choose a parameter action, **Effect param**, then the instrument, effect and knob from the **Effect parameter** list. The mapping range uses the knob’s units. Scripts use the same units, for example `xm.fx("master", "filter").set("cutoff", 1800)`. Use the effect ID stored in the project. Instrument owners can be addressed as `instrument:piano`, orchestras as `orchestra:strings`, and sections as `section:strings:0` (first section).
