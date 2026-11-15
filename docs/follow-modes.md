# Follow modes

Open **Follow** in the transport bar to choose who controls the timing. The selection and follow settings save with the project. A controller binding or script can change the active mode at runtime. Changing the saved mode from the popover also replaces a runtime override.

## Written tempo

The computer follows the project's tempo map and Speed. A rate binding or taps during playback nudge that speed. Wait cues remain available.

## Wait for my notes

Choose the MIDI tracks you will play, set their mode to **LIVE**, and enable the magnet button in each track header. The Follow popover also lists live tracks as selectable lead chips. Put the guide notes in those tracks; the computer plays tracks in AUTO mode.

The transport holds at each expected onset in the lead tracks. Notes within 30 ticks of the first note form a chord at PPQ 480. The first onset anchors the group, so a long rolled phrase does not merge into one chord. Duplicate pitches form one expected pitch. The keyboard outlines the physical keys that reach the expected notes through the current zones, including zone transposition. Dashed amber outlines identify the guide notes in piano-roll lanes.

Choose **Any expected note** to advance when one expected pitch arrives, or **All notes of the chord** to require the chord. All means the expected keys must be down together, with their presses inside **Chord window**; the default is 150 ms. Releasing and pressing an older key again can complete a chord that was spread too widely.

**Early notes count** accepts notes played before the onset, by default up to 200 ms early. A completed early chord remains satisfied even if released before the playhead reaches it. A held key from much earlier does not automatically complete the next onset. Wrong notes still sound through the normal routing and do not advance playback.

Only live, post-zone notes reaching a lead track count. On-screen keys and script-transformed live keys use the same path. Manually played controller bindings with Note actions also count on their assigned lead track. Sequenced accompaniment, preset audition and automated cue/script note actions do not satisfy the follower. Input latency compensation applies to the live timestamp. Sustain does not turn a released key into a key that is still down for chord matching.

Between onsets, accompaniment runs at written tempo × Speed. During a hold, the position freezes; reference audio and synced clips freeze with it. Unsynced clips continue. Existing sounding MIDI notes retain their destinations and releases.

The transport shows **HOLDING**, an amber hourglass and the expected pitches. **Fast-forward** skips the current hold; the popover's **Skip hold**, a Transport → Skip hold binding and script release can also advance it. Otherwise Fast-forward keeps its normal navigation function. Looping re-arms the expected notes on each pass. Seeking clears earlier matches and starts from the next onset at or after the new position. Pause and resume require a fresh match at an unsatisfied onset.

Wait cues keep their own controls. A melody note cannot release a cue that explicitly waits for a button. At a shared tick, the cue runs first, then the note wait. A cue without an assigned control can still release on a live-zone key according to its cue settings.

Changing to Written tempo or removing the active lead releases a note wait. Project edits and scene changes rebuild the expected list from the effective live tracks. Lead selection, chord window and early timing are undoable project edits; runtime matches are not saved.

The default timing values have automated coverage with synthetic MIDI. Physical keyboard tuning, wrong-note tolerance in a real performance, Windows input latency and touch/pen handling still need user verification.

## Track my tempo

This mode keeps the accompaniment moving and adjusts it to your live notes. Use the same live lead tracks as Wait for my notes. It looks for a matching pitch and track among the next eight and previous two expected onsets. Notes that do not match that window are ignored. Repeated pitches and mistakes that resemble a nearby expected note can be ambiguous; use a cue or seek to establish a new position after a large jump.

Each successive forward match estimates tempo from the written interval, its tempo-map duration, your elapsed playing time and the current Speed setting. The estimate is smoothed and constrained to **Tempo range**, by default 50–150% of Speed. For example, Speed 75% with that range permits estimates of 37.5–112.5% of written tempo. **Smoothing** defaults to 0.35: lower values react more gently, 1 uses the latest interval directly, and 0 retains the estimate.

A separate phase correction helps accompaniment catch up or fall back toward the played note. **Phase gain** defaults to 0.5. The correction lasts one beat and is limited to ±25% of the estimated rate; this temporary correction can extend beyond Tempo range. A forward jump is caught gradually rather than changing the playhead abruptly. The Tempo field shows effective BPM, including Speed and the live factor; the small multiplier shows the factor including phase correction.

After two beats without a match at an expected onset, the next-note pointer catches up with the running position. The tempo estimate stays in place and playback continues through missing notes or a silent bar. A cue hold freezes position, reference audio and synced clips. Notes played during that hold do not update the estimate; the first match after release starts a fresh interval. Changing Speed also starts a fresh interval while retaining the learned estimate.

Leaving Track my tempo eases the live factor back to 1 over two bars of musical time. Holds pause that return. Stop clears the estimate; seeking in tracking mode retains the estimate but clears the interval and phase history. A new matching note establishes the next interval. Reference audio and synced clips share this effective transport speed and retain pitch; unsynced clips keep their own speed.

Tempo range, smoothing and phase gain save in `project.yaml` alongside the other follow settings. Automated synthetic performances cover steady faster/slower playing, accelerando, exactly 20% wrong-note replacements, a silent bar, a forward bar jump, loops, tempo-map changes, user Speed changes and cue holds. The sub-beat error checks apply to the continuous performances; the forward-jump check allows time for the bounded phase correction to recover. These checks do not replace physical performance tuning.
