# Live performance

Capture the current zones, patch, track modes and register choices as a scene. Click a scene to activate it; choose Now, Beat or Bar for the activation boundary. The Base / scene switch chooses where routing edits are stored. Use a scene’s menu to rename, recolour, duplicate, reset its overrides or delete it. Held notes finish on their original sound when routing changes.

Registers 1–8 toggle from their buttons, number keys or controller bindings. Right-click, hold or press F2 on a register to edit its name, mode and group. Exclusive registers in the same group replace each other; momentary bindings restore the underlying register choices when released.

Drag either end of a zone above the keyboard, or click its label to edit the note range, target tracks, transpose and velocity curve. Double-click empty space in the zone strip to add a zone. Learn range collects the lowest and highest keys you play. Each edge drag is one undo step.

Patch lists one row per MIDI track. Click + to add another instrument connection, then choose its instrument, condition and transpose. Connections can be always active, gated by a register or use a custom condition. Change preset opens the soundfont picker; New instrument creates an independent sound. The same connection editor opens from a track header’s instrument chip.

Add a cue at the playhead with + in the cue lane, or double-click empty lane space. Drag a cue to move it with the current snap; each drag is one undo step. Click a marker to edit its name, bar/beat, trigger, control, firing boundary and ordered actions. Learn captures an already learned controller control while suspending its normal binding.

Automatic cues run when playback reaches them. Armed cues accept their assigned control until fired or replaced by the next cue. Wait cues freeze the transport and audio at their marker; release with the assigned control, a live-zone key when no control is assigned, or Skip hold in Cue options. Then fire can defer the actions to the next beat or bar after release. Automatic cues already on that boundary run there. Cue note actions tap a note for one quarter beat. Seeking cancels queued actions; Chase cues on seek, enabled by default in Cue options, applies the scene/register/track-mode actions of the last scene-affecting cue before the destination without replaying note hits.

Expand Signal flow to inspect Inputs → Zones → Tracks → Instruments → Outputs. Scroll horizontally to follow a route across the panel. Dashed connections show their condition, including closed gates; active boxes and wires show live, sequenced and audio-track activity. A Held connection keeps the original destination visible after a scene change. Click a box to open its editor, or a condition label to edit the connection in the active scene. The diagram does not move or edit routing by dragging.

Edit TypeScript in Script, then Apply or press Ctrl+Enter. A new version needs approval before it runs; external edits reload through the same trust check. Disable stops hooks and script-created notes. Scripts can transform live notes, react to controls and musical boundaries, change runtime routing and registers, and update pad/display feedback. See [Scripting](scripting.md) for the API, limits and three examples.

See [Follow modes](follow-modes.md) for lead tracks, chord matching, tempo tracking, timing settings and skip controls.
