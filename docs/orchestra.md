# Orchestral sets

Open **Orchestra → + Preset** and choose Symphonic, New Age, EDM Trance or Tuned Percussion. Add a General MIDI soundfont directory in Soundfonts first. Each preset adds its instruments to the project and shares one live Orchestra track. Mute other live tracks to hear the set alone.

Use the preset buttons to switch sets. The first four registers enable sections. Each key plays enabled members within their sounding range, with priority given to their comfort range. Set **Max layers** to All for unrestricted layering. New presets use **Nearest octave** across MIDI keys 0–127. Choose **100 keys** or **128 keys** on the keyboard strip for a wider view. **Nearest octave** folds an out-of-range key by octaves. Expand a section to change individual ranges, comfort bands, octave or proportion. A held key releases its original voices after a preset change.

Use **Proportion** to set a member’s level. **Balance by → Volume** changes MIDI expression and keeps the original attack. **Velocity** changes how hard the note strikes. **Volume and velocity** splits the adjustment between them. For example, a proportion of 25% applies half expression and half velocity in this mode. External instruments sharing an output port and channel use velocity so changing one member’s level leaves the other member alone.

New KeyLab projects use bank A pads 1–4 for sections and 5–8 for the four presets in the order above. Add each preset to the project before selecting it from a pad. Bank B shows the beat on its upper row and the bar within a four-bar phrase on its lower row. On existing projects, select **Use orchestra pad layout** in Controls. Audition preset ranges with the installed font. Physical bank-switch LED retention still needs verification.

**Section level** scales the section while keeping each member’s proportion. At 0% the section yields its layer slots to other enabled sections. In the binding editor, choose **Parameter → Section gain** and select the orchestra and section to control it with a fader.
