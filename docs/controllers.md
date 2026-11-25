# Controllers

Devices lists the main MIDI ports and their assigned profiles. Use **Learn…** to capture missing controls, or click an unlearned element in Controls to learn it individually. Press and release buttons and pads; sweep absolute controls across their full range and turn relative encoders in both directions. Review each capture, correct its mode if necessary, then finish to save the profile on this PC. Unknown hardware messages remain unassigned until learned. Relearning a control replaces its complete address set, including factory aliases; use it for custom hardware presets.

Click a learned control to edit its binding. Choose its edge, action, condition and timing; edits apply immediately. Store bindings in Shared, This controller, This scene, or a controller's scene override. Unbind disables that edge in the selected scope. Absolute parameter controls use soft takeover: move to the parameter's current value before they take control. Relative encoders apply changes from the current value.

New projects include transport and DAW bindings, speed on knob 1, track volumes by fader order and master volume on fader 9. New projects use the orchestra layout below. Existing projects keep their saved mappings. Use **Controls → Use orchestra pad layout** to update the selected profile, then save the project. Undo restores the previous layout. Scene and register actions update the live routing. Cues can run actions automatically or wait for a control; script functions can extend the live setup; clip actions launch or sweep audio fragments.

KeyLab feedback uses only its paired main MIDI output. Mapping colours, binding state, beat chase, hit flashes and queued-cue blinking share the same states on the screen and keyboard. Turn **Visual pads** off in Bar grid to disable beat chase. The display shows the project or scene name, position, speed and follow state. Feedback reinitializes after a program change and refreshes after pad release. **Select Arturia program on connect** is off by default; enabling it changes the keyboard's active program. For the tested KeyLab, select **DAWs** manually for pad colours and display text. In **Arturia** mode the same feedback messages were accepted by Web MIDI but had no visible effect. Leave **Select Arturia program on connect** off when using feedback. The option still explicitly selects Arturia and does not select DAWs.

On 2026-11-16 the connected KeyLab passed live piano/strings splits, pitch/modulation wheels, chords and sustain release in DAWs mode. The owner confirmed project/transport text, coloured pads, top-row beat chase, continued chase after pad presses and Stop ending playback. Precise audible/visual timing, all individual RGB ids, full arrangements, cue output, hot-plug and host-forced program selection remain unverified.

| KeyLab control | Axiom control | New project assignment |
| --- | --- | --- |
| Bank A pads 1–4 | Buttons 1–4 | Toggle section registers 1–4 |
| Bank A pads 5–8 | Buttons 5–8 | Select Symphonic, New Age, EDM Trance or Tuned Percussion |
| Bank B upper row | — | Beat within the bar |
| Bank B lower row | — | Bar within a four-bar phrase |

Install the presets from **Orchestra → + Preset**. Registers 5–8 remain available on screen, on number keys and in scripts. Hardware verification of bank B LED retention when switching banks is pending.

## Captured KeyLab addresses

The profile accepts the verified addresses below as the same logical controls. Bindings keep their control ids when switching programs. CC channels are accepted independently of the keyboard channel; pad channels are exact. Channels in this table are numbered 1–16.

| Controls | Arturia program | DAWs program |
| --- | --- | --- |
| Bank A pads, top row then bottom | Pads 1, 2, 8: notes 40, 41, 39 on channel 10; others need Learn | Notes 40–43, 36–39 on channel 11 |
| Bank B pads, top row then bottom | Notes 48–51, 44–47 on channel 10 | Notes 48–51, 44–47 on channel 11 |
| Knobs 1–9 | Knobs 1, 2, 9: CC74, CC71, CC17; others need Learn | CC96–104 |
| Sliders 1–9 | Sliders 1, 9: CC73, CC85; others need Learn | CC105–113 |
| Main encoder / press | CC114 / CC115 | CC116 / CC117 |
| Save, Quantize, Undo, Redo | CC52, CC41, CC54, CC55 | CC40–43 |
| Four display buttons | CC30, CC31, CC86, CC87 | CC44–47 |
| Play, Stop, Rewind, Forward, Loop, Metronome | CC21, CC20, CC25, CC26, CC24, CC27 | Same six CC numbers |

The encoder uses values above/below 64 for clockwise/counterclockwise movement; 64 is neutral. DAWs captures also included accelerated values 66/62. Absolute knobs/sliders report 0–127. Buttons send 127/0 for press/release; pads also send poly pressure. Arturia bank A pad 3–7 addresses have not been inferred from neighbouring pads. All eight DAWs bank B addresses were subsequently captured in order; with the earlier mapping the owner confirmed that pad 2 toggled on-screen Register 2 and that bank B pads stay silent rather than playing keyboard instruments.

Unmatched notes in the reserved KeyLab pad range (36–51 on channels 10–11) are suppressed, including pressure and releases, so an unlearned pad cannot unexpectedly play a keyboard instrument. Keep the keyboard itself on another MIDI channel when using those reserved pad addresses. Learned messages override that suppression.

Electron 45 lacks `MIDIOutput.clear()`, so future LED messages remain in a cancellable engine queue until their deadlines. Isolated Linux checks measured up to 2.5 ms of dispatch lateness; this is not physical MIDI or audio latency. At high audio output latency, pad feedback aligned to the audible beat can trail the transport's on-screen beat lamps; visual alignment remains a release QA item.

### Play a drum roll with a fader or encoder

Open the control’s binding editor and choose **Drum roll**. Select the MIDI track that plays your drum instrument and enter its kick or snare note. The recipe starts with note 36 and a 60 ms auto-release. Move the control through three MIDI steps for each hit. Choose **Up** or **Down** to play on just one stroke. **Movement speed** makes a quick stroke louder. Choose **Fixed** for even hits.
