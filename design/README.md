# Design reference

Static mockups of the xmxsplayer interface. They define the target look: layout, colours, sizes, states and wording. Open `index.html` in a browser (needs internet once for Bootstrap and the icon font), or look at the PNGs in `screens/`.

| File | What it shows |
|---|---|
| `main-window.html` · `screens/main-window.png` | The whole window at 1920×1080: transport bar, left panel, tracks (two staff lanes, piano roll, drum grid, audio), keyboard strip |
| `panels.html` · `screens/panels.png` | Every left-panel section expanded: controller schematic (bank A and B), signal flow, scenes, registers, patch, clips, devices, soundfonts, sources, script, log |
| `dialogs.html` · `screens/dialogs.png` | Binding editor, zone popover, follow popover, clip editor, instrument picker, cue editor, settings, learn wizard, banners, toasts, prompts |
| `states.html` · `screens/states.png` | Follow views, staff themes, transport states, track header states, pad LED states, colour tokens, type scale, buttons |
| `tokens.css` | Design tokens and the Bootstrap 5.3 dark-theme mapping |
| `xm.css` | Component classes (`.xm-*`). The `.mk-*` block at the end is gallery scaffolding and is not part of the app |
| `mockup.js` | Demo drawing only (fake notation, notes, waveform, keyboard). Not app code |

## How to use it when building the app

1. Copy `tokens.css` unchanged to `src/ui/styles/tokens.css`. Copy `xm.css` without its `.mk-*` block to `src/ui/styles/xm.css`. Load order: Bootstrap, `tokens.css`, `xm.css`.
2. Set `data-bs-theme="dark"` on `<html>`.
3. Reuse the markup structure and class names from the HTML pages in the Vue components. Each component should match its mockup at the same width.
4. Do not copy `mockup.js`. Staves come from Verovio, piano rolls and waveforms from canvas lanes, the keyboard from its own component. Only the geometry conventions below carry over.
5. Bundle the fonts (Inter and Fira Code, both OFL) with the app; the mockups use the system copies.

## Layout numbers

| Thing | Value | Token |
|---|---|---|
| Transport bar height | 60 px | `--xm-h-transport` |
| Left panel width | 372 px, resizable 300–560, collapsible | `--xm-w-left` |
| Track header width | 252 px | `--xm-w-header` |
| Ruler / cue lane height | 28 px each | `--xm-h-ruler`, `--xm-h-cues` |
| Keyboard strip height | 138 px (30 zones + 108 keys) | `--xm-h-keys` |
| Lane lead-in gutter | 96 px | `--xm-lane-gutter` |
| Default lane heights | staff 196, piano roll 132, drum grid 112, audio 108 (× lane zoom) | |
| Minimum touch target | 40 px | `--xm-hit` |
| Minimum window | 1280 × 720 | |

## Geometry conventions

- **Shared time axis.** Every lane page begins with the lead-in gutter: clef, key and time signature on staves; the key legend on piano rolls; row names on drum grids; empty on audio. After the gutter, a given bar line is at the same x in all lanes, the ruler and the cue lane.
- **One playhead** (`.xm-playhead`) and one loop tint (`.xm-loop`) span all lanes in an overlay above the track list.
- **Page view:** the playhead moves; over the last 18 % of a page the right edge tints; the next page slides in over 150 ms. **Center view:** playhead fixed at 50 % of the lane width.
- **Keyboard strip:** zones are bars above the keys, aligned to key edges, with 3 px grab handles at both ends. Held keys take the zone colour. The next expected key in a follow mode gets a dashed amber outline.

## Colour meaning

| Colour | Token | Used for |
|---|---|---|
| Blue | `--xm-accent` | focus, selection, playhead, primary button, current beat |
| Green | `--xm-ok`, `--xm-auto` | playing, connected, synced, AUTO mode |
| Orange | `--xm-live` | LIVE mode (the user plays this track) |
| Amber | `--xm-warn` | holding, queued, armed cue, modified here, downbeat, solo |
| Red | `--xm-rec` | record, errors, destructive actions |
| Palette c1–c12 | `--xm-c1` … `--xm-c12` | identity of tracks, instruments, zones, scenes, clips |

Greys carry structure only. Never use a state colour for decoration.

## Shared states

Pads on screen, clip tiles and controller LEDs use the same four states: **off** (unbound, dashed grey), **idle** (bound, colour at about 20 %), **on** (full colour with glow), **queued/armed** (dashed amber, blinking at beat rate).

Track modes: **AUTO** green, **LIVE** orange, **MUTE** grey with the header and lane at 60 % opacity. Link badges: **synced** green, **modified here** amber, **not in score** red.

## Narrow windows

Below 1600 px the transport bar drops, in this order: the "Time · Key" field, the text labels of the status chips, the "Per track" segment (moves into the View menu), then the loop field. Below 1400 px the left panel starts collapsed. The transport buttons, position, beat lamps, speed and follow selector are never hidden.

## Wording

Sentence case everywhere. Buttons say what they do ("Use preset", "Take file", "Discard & re-sync"). Section labels are short nouns in small caps style. Numbers with units use the mono font. Error text names the file or object, then the reason.
