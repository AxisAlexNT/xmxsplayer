# Project scripts

Each project contains `script.ts` and a standalone `xm.d.ts` API declaration file. Open the Script section to edit TypeScript with highlighting, bracket matching, line numbers and local undo. **Apply** or **Ctrl+Enter** uses the draft; saving the project also applies and saves it. Collapsing the section retains your draft. **Disable** stops hooks, script-created notes and script-owned clips. Apply re-enables a disabled script.

A new script version asks **Enable this project's script?** before compilation or execution. Approval records a SHA-256 hash of its exact UTF-8 bytes in local settings. Opening another copy of the same approved source does not ask again. Changed external `script.ts` files reload through the normal file watcher and need fresh approval. Keep disabled leaves keyboard routing available without the script; Apply can ask again. Unsaved file conflicts still use Keep mine / Take file. If an external version replaces the document while you have an unapplied editor draft, a banner lets you use the project version or apply your draft explicitly.

Scripts run in the hidden engine renderer with no Node integration, no remote content and the app's restricted file capabilities. They can change the live rig and MIDI feedback. Trust is permission to execute code, not a hard CPU or memory sandbox: synchronous loops can block the engine. Keep handlers short. Calls taking more than 5 ms produce warnings after returning. Errors appear in Script's log and the main Log, with `script.ts` line numbers when available. A failed handler leaves other hooks working; an invalid note result preserves its input. A failed top-level script is disabled. Unsupported imports fail during compilation; use the supplied `xm` API.

## Events

`xm.on(event, handler)` returns an unsubscribe function. Hooks run synchronously in registration order. Re-entering the same event from its own handler is suppressed. An external reload or Apply replaces hooks and `xm.state`; old API references stop making changes.

| Event | Payload | When |
| --- | --- | --- |
| `note` | `{deviceId, channel, key, vel, on, timestamp?}` | Live physical or on-screen keys, before zones; excludes sequencer, note actions and preset audition |
| `control` | `{id, controlId, deviceId, value, pressed, edge, delta?, timestamp?}` | A decoded control, before cue matching and normal bindings; suppressed during control capture |
| `beat` | `{bar, beat}` | A written beat boundary, including the first beat on playback |
| `bar` | `{bar}` | A bar boundary |
| `cue` | `{id}` | A cue fires its actions; excludes seek chasing |
| `scene` | `{id}` | A scene activates; `null` is Base |
| `transport` | `{playing, holding, rate, tick}` | Play/pause, hold or rate state changes |

Bars and beats start at 1. MIDI channels use 0–15. Timestamps, when present, use the engine’s performance clock in milliseconds. Control values are 0–1; `id` aliases `controlId`. Beat and bar hooks execute at the musical boundary, before the scheduler sends subsequent notes. They repeat through loops and are reset on seek; seeks do not replay missed beats. At a shared tick, cue actions run before beat/bar hooks. A wait cue defers those hooks until release.

A note hook returns an event, an array of up to 128 events, or `null` to drop it. Change `key` and `vel`; retain the original device, channel and `on` identity. Return an event for every input, including releases:

```ts
xm.on('note', e => e.key < 48 ? null : { ...e, key: Math.min(127, e.key + 12) })
```

Press-time output notes own their releases. Release hooks receive the physical note-off as notification, but their return values cannot reroute that release. This keeps notes safe through scene changes, script edits, dropped notes and transposition. Sustain and expression retain the originating device/channel. Preset audition bypasses scripts.

Control hooks do not consume events. A matching binding still runs afterward. Remove its action in Controls when a hook should handle that control alone, including applicable controller and scene overrides. Learned MIDI messages are required before their abstract control hooks can fire.

## API

| Member | Behaviour |
| --- | --- |
| `xm.transport.play()`, `.stop()` | Play or stop the transport |
| `.seekBar(bar)` | Seek to a bar's start, using the project's cue-chase setting |
| `.bar`, `.beat`, `.playing`, `.rate` | Current position/state; rate is the user speed, 0.25–2 |
| `.setRate(rate)` | Change user speed |
| `.hold()`, `.release()` | Hold at the current position; release a script hold or the current wait cue |
| `xm.scene.activate(id, at = 'now')`, `.current` | Activate a scene or `null` for Base; timing `now`, `beat`, `bar` |
| `xm.registers.get(index)`, `.set(index, on)`, `.toggle(index)` | Registers **0–7**; exclusive groups are enforced |
| `xm.zones.set(zones)` | Replace runtime zones with complete Zone objects, validated against existing MIDI tracks |
| `xm.patch.set(trackId, instrumentIds)` | Replace that MIDI track's runtime connections; `[]` closes the track; IDs must exist |
| `xm.track(id).mode` | Read/write `auto`, `live`, `mute`; audio supports `auto`/`mute` |
| `xm.track(id).playNote(key, vel, beats)` | A bounded note action through a MIDI track's current patch; key 0–127, velocity 1–127, duration 1/480–4096 quarter beats |
| `xm.clip(id).launch()`, `.stop()`, `.playing` | Launch with the clip’s pad mode and timing, stop at its boundary, read actual playing state |
| `xm.clip(id).semitones`, `.gain` | Read/write runtime pitch and nonnegative gain; saved clip values remain unchanged |
| `xm.follow.mode`, `.set(mode)` | Select `written`, `waitNotes` or `tempoTrack`; the follower itself arrives in M8 |
| `xm.pad(n).color` | Read/write a `#rrggbb` override for pad **1–16** on connected controllers supporting feedback |
| `xm.display(line1, line2)` | Override the supported controller display; at most 32 input characters per line; KeyLab feedback clips each line to 16 ASCII characters |
| `xm.state` | Per-script in-memory object; resets on reload/Apply/project change |
| `xm.log(message)` | Add a Script log entry |

Complete types are available in the editor's API pane and in `xm.d.ts`. Zone note limits use MIDI numbers (`C4 = 60`). IDs are case-sensitive. Invalid API arguments log an error and leave that operation unapplied. Calls in later handlers can still run.

Zones, patch connections, track modes, follow selection and feedback overrides are runtime state; they do not rewrite project YAML. When the Scene editing scope is selected, the keyboard strip displays script-owned zones; clicking one opens Script. Select Base to edit the saved base zones. Scene activation clears script routing/mode/follow overrides. Script reload/Disable clears all script overrides and releases script-created notes and script-owned clips; it preserves normal register choices and notes still held on your keyboard. Project document edits remain in the UI's normal undo/save path.

Scripted `playNote` durations use tempo and effective speed at the instant of the call, then run in elapsed time, including while the transport is stopped or held. These are one-shot gestures; use a track's written notes for accompaniment that must follow later speed changes and holds. Stop, Disable, reload and project changes release outstanding script notes. Programs and routing variants are prepared for every MIDI track/instrument pair in projects containing scripts, so `patch.set` can take effect without an asynchronous preset load in a handler. Large scripted rigs therefore allocate more synth slots.

Pad colours sit above binding colours and below beat, press-flash and queued-cue layers. Display overrides replace the normal scene/position text until reload or Disable. The LED manager retains its global rate limit; this API does not send arbitrary SysEx.

A binding or cue action with `type: script` and `fn: selectStrings` calls a top-level `function selectStrings() { ... }` declared in the script. Supply a function name, not a JavaScript expression. Functions receive no arguments; use event hooks for control values.

## Examples

Copy one example into a project's `script.ts`, supply the named tracks/instruments, then Apply and approve it. The files are independent examples.

- [Pad 2 before and after the reprise](examples/reprise-pad.ts): requires MIDI tracks `drums` and `horn`, patched to a kit and a French horn, plus scene `reprise`. Pad 2 taps a drum before bar 33 and a horn from bar 33; the bar hook activates the scene. Set Pad 2's binding action to None in every applicable scope.
- [Button and bar range change the split](examples/reprise-split.ts): requires tracks `lower` and `upper`, and instruments `harpsichord`, `glockenspiel`, `lead`. Between bars 17 and 32, Context 1 changes the lower zone to C2–B5 (48 keys), the upper to C6–B6 (12 keys), layers the lower instruments and updates the display. Learn Context 1 if its message is unknown and give it no binding action.
- [Exclusive accompaniment registers](examples/accompaniment-registers.ts): set registers 1–3 to Exclusive with group `accompaniment`, gate each accompaniment patch on its corresponding register, and assign bank B pads 9, 10, 11 to Script functions `selectBrass`, `selectStrings`, `selectChoir` in the controller mapping. Those bindings replace the default register toggles. Only one accompaniment register remains enabled; the script updates pad colours and display.
