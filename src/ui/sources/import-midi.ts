import { Midi } from '@tonejs/midi'
import { PPQ, type MidiTrack, type Project, type Note } from '../../shared/model'
import { uniqueId } from '../../shared/ids'
import { TRACK_COLORS } from '../../shared/music'

export function importMidi(
  project: Project,
  bytes: Uint8Array,
  fileName: string,
): Project {
  const midi = new Midi(bytes)
  const factor = PPQ / midi.header.ppq
  if (!Number.isFinite(factor) || factor <= 0)
    throw Error(`${fileName}: unsupported MIDI time division`)
  const next = structuredClone(project)
  let added = 0
  for (const source of midi.tracks) {
    const events: MidiTrack['events'] = []
    for (const cc of [64, 1, 7, 10] as const)
      for (const event of source.controlChanges[cc] ?? [])
        events.push({
          tick: Math.round(event.ticks * factor),
          type: 'cc',
          num: cc,
          value: Math.round(event.value * 127),
        })
    for (const event of source.pitchBends)
      events.push({
        tick: Math.round(event.ticks * factor),
        type: 'bend',
        num: 0,
        value: Math.max(
          0,
          Math.min(16383, Math.round(event.value * 8192 + 8192)),
        ),
      })
    if (!source.notes.length && !events.length) continue
    const name =
      source.name ||
      source.instrument.name ||
      `${fileName.replace(/\.mid[i]?$/i, '')} ${++added}`
    const id = uniqueId(
      name,
      next.tracks.map((t) => t.id),
    )
    const color = TRACK_COLORS[next.tracks.length % TRACK_COLORS.length]
    const instrumentId = uniqueId(
      source.instrument.name || name,
      next.instruments.map((i) => i.id),
    )
    const track: MidiTrack = {
      id,
      name,
      color,
      kind: 'midi',
      mode: 'auto',
      solo: false,
      volume: 1,
      pan: 0,
      height: 132,
      notes: source.notes.map<Note>((n) => [
        Math.round(n.ticks * factor),
        Math.max(1, Math.round(n.durationTicks * factor)),
        n.midi,
        Math.max(1, Math.round(n.velocity * 127)),
      ]).sort((a,b)=>a[0]-b[0]||a[2]-b[2]),
      events: events.sort((a, b) => a.tick - b.tick),
      view: 'roll',
      clef: 'auto',
      quantGrid: 120,
      armed: false,
      leads: false,
    }
    next.tracks.push(track)
    next.instruments.push({
      id: instrumentId,
      name: source.instrument.name || name,
      color,
      backend: 'default',
      soundfontId: next.soundfonts[0]?.id,
      bank: source.instrument.percussion ? 128 : 0,
      program: source.instrument.number,
      isDrum: source.instrument.percussion,
      volume: 0.8,
      pan: 0,
      reverb: 0.2,
      chorus: 0,
      transpose: 0,
    })
    next.base.patch.push({
      id: uniqueId(
        `${id}-${instrumentId}`,
        next.base.patch.map((p) => p.id),
      ),
      trackId: id,
      instrumentId,
    })
    const end = Math.max(
      track.notes.reduce((end, n) => Math.max(end, n[0] + n[1]), 0),
      track.events.reduce((end, e) => Math.max(end, e.tick), 0),
    )
    next.lengthTicks = Math.max(next.lengthTicks, end + PPQ)
  }
  if (next.mapOwner === null) {
    next.tempos = midi.header.tempos.map((t) => ({
      tick: t.ticks * factor,
      bpm: t.bpm,
    }))
    if (!next.tempos.length || next.tempos[0].tick > 0)
      next.tempos.unshift({ tick: 0, bpm: 120 })
    next.timeSigs = midi.header.timeSignatures.map((t) => ({
      tick: t.ticks * factor,
      num: t.timeSignature[0],
      den: t.timeSignature[1],
    }))
    if (!next.timeSigs.length || next.timeSigs[0].tick > 0)
      next.timeSigs.unshift({ tick: 0, num: 4, den: 4 })
    const names = [
      'Cb',
      'Gb',
      'Db',
      'Ab',
      'Eb',
      'Bb',
      'F',
      'C',
      'G',
      'D',
      'A',
      'E',
      'B',
      'F#',
      'C#',
    ]
    next.keySigs = midi.header.keySignatures.map((k) => ({
      tick: k.ticks * factor,
      fifths: Math.max(
        -7,
        Math.min(7, names.indexOf(k.key) - 7),
      ),
      minor: k.scale === 'minor',
    }))
    next.beatAnchors = []
  }
  return next
}
