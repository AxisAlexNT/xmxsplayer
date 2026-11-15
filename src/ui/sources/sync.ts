import { Midi } from '@tonejs/midi'
import { parseMidi, writeMidi } from 'midi-file'
import { decodeTrack } from '../../shared/project-files'
import { newProject } from '../../shared/defaults'
import { uniqueId } from '../../shared/ids'
import { TRACK_COLORS } from '../../shared/music'
import {
  PPQ,
  type Instrument,
  type MidiTrack,
  type Project,
  type Source,
} from '../../shared/model'
import type { ScoreData } from '../../shared/api'
import { importMidi } from './import-midi'
export interface ScoreTrack {
  key: string
  name: string
  notes: MidiTrack['notes']
  events: MidiTrack['events']
  program: number
  drum: boolean
}
export interface ParsedScore {
  durationTicks?: number
  tracks: ScoreTrack[]
  maps: Pick<Project, 'tempos' | 'timeSigs' | 'keySigs'>
}
export function staffNames(
  parts: { name: string; staves: number }[],
): string[] {
  return parts.flatMap(({ name, staves }) =>
    Array.from({ length: Math.max(1, staves) }, (_, i) =>
      staves > 1 ? `${name} (staff ${i + 1})` : name,
    ),
  )
}
export function namesFromMusicXml(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || !doc.querySelector('score-partwise'))
    throw Error('Invalid MusicXML score')
  return staffNames(
    [...doc.querySelectorAll('part-list > score-part')].map((part) => {
      const body = [...doc.querySelectorAll('score-partwise > part')].find(
        (p) => p.getAttribute('id') === part.getAttribute('id'),
      )
      const values = [...(body?.querySelectorAll('attributes > staves') ?? [])]
        .map((n) => Number(n.textContent))
        .filter(Number.isFinite)
      return {
        name: part.querySelector('part-name')?.textContent?.trim() || 'Part',
        staves: Math.max(1, ...values),
      }
    }),
  )
}
export function parseScore(
  data: ScoreData,
  source: Source,
  names: string[] = data.musicxml ? namesFromMusicXml(data.musicxml) : [],
): ParsedScore {
  const midi = parseMidi(data.midi)
  if (!midi.header.ticksPerBeat)
    throw Error(`${source.file}: unsupported MIDI time division`)
  const maps = importMidi(newProject(), data.midi, source.file)
  const raw =
    source.kind !== 'mid'
      ? midi.tracks.slice(1)
      : midi.tracks.filter((track) =>
          track.some(
            (e) =>
              !('meta' in e) && e.type !== 'sysEx' && e.type !== 'endSysEx',
          ),
        )
  if (source.kind !== 'mid' && names.length !== raw.length)
    throw Error(
      `${source.file}: MIDI has ${raw.length} staves, MusicXML has ${names.length}; cannot match tracks safely`,
    )
  const tracks = raw.map((events, index): ScoreTrack => {
    const bytes = new Uint8Array(
      writeMidi({
        header: { ...midi.header, format: 0, numTracks: 1 },
        tracks: [events],
      }),
    )
    const tone = new Midi(bytes).tracks[0]
    const name =
      names[index] ||
      tone?.name ||
      tone?.instrument.name ||
      `Track ${index + 1}`
    return {
      key: `${index}:${name}`,
      name,
      ...decodeTrack(bytes),
      program: tone?.instrument.number ?? 0,
      drum: tone?.instrument.percussion ?? false,
    }
  })
  return {
    tracks,
    durationTicks:
      (Math.max(
        0,
        ...midi.tracks.map((t) => t.reduce((sum, e) => sum + e.deltaTime, 0)),
      ) *
        PPQ) /
      midi.header.ticksPerBeat,
    maps: {
      tempos: maps.tempos,
      timeSigs: maps.timeSigs,
      keySigs: maps.keySigs,
    },
  }
}
export function mergeScore(
  project: Project,
  source: Source,
  score: ParsedScore,
  discardId?: string,
  timestamp = new Date().toISOString(),
): { project: Project; changed: number; kept: number; orphaned: number } {
  const next = structuredClone(project),
    keys = new Set(score.tracks.map((t) => t.key))
  let changed = 0,
    kept = 0,
    orphaned = 0
  for (const track of next.tracks) {
    if (track.kind !== 'midi' || track.link?.sourceId !== source.id) continue
    if (!keys.has(track.link.key)) {
      track.link.orphaned = true
      orphaned++
    }
  }
  for (const incoming of score.tracks) {
    const old = next.tracks.find(
      (t): t is MidiTrack =>
        t.kind === 'midi' &&
        t.link?.sourceId === source.id &&
        t.link.key === incoming.key,
    )
    if (old) {
      delete old.link!.orphaned
      if (old.link!.state === 'ahead' && old.id !== discardId) {
        kept++
        continue
      }
      old.notes = incoming.notes
      old.events = incoming.events
      old.link = { sourceId: source.id, key: incoming.key, state: 'synced' }
      changed++
      continue
    }
    const id = uniqueId(
        incoming.name,
        next.tracks.map((t) => t.id),
      ),
      color = TRACK_COLORS[next.tracks.length % TRACK_COLORS.length]
    const instrumentId = uniqueId(
      incoming.name,
      next.instruments.map((i) => i.id),
    )
    const instrument: Instrument = {
      id: instrumentId,
      name: incoming.name,
      color,
      backend: 'default',
      soundfontId: next.soundfonts[0]?.id,
      bank: incoming.drum ? 128 : 0,
      program: incoming.program,
      isDrum: incoming.drum,
      volume: 0.8,
      pan: 0,
      reverb: 0.2,
      chorus: 0,
      transpose: 0,
    }
    next.instruments.push(instrument)
    next.tracks.push({
      id,
      name: incoming.name,
      color,
      kind: 'midi',
      mode: 'auto',
      solo: false,
      volume: 1,
      pan: 0,
      height: 196,
      notes: incoming.notes,
      events: incoming.events,
      view: 'roll',
      clef: 'auto',
      quantGrid: 120,
      armed: false,
      leads: false,
      link: { sourceId: source.id, key: incoming.key, state: 'synced' },
    })
    next.base.patch.push({
      id: uniqueId(
        `${id}-${instrumentId}`,
        next.base.patch.map((p) => p.id),
      ),
      trackId: id,
      instrumentId,
    })
    changed++
  }
  const current = next.sources.find((s) => s.id === source.id)
  if (current) {
    current.lastSync = timestamp
    if (score.durationTicks !== undefined)
      current.durationTicks = score.durationTicks
    delete current.error
  } else
    next.sources.push({
      ...source,
      lastSync: timestamp,
      durationTicks: score.durationTicks,
      error: undefined,
    })
  if (next.mapOwner === null) next.mapOwner = source.id
  if (next.mapOwner === source.id && source.kind !== 'mid') {
    Object.assign(next, score.maps)
    next.beatAnchors = []
  }
  for (const t of next.tracks)
    if (t.kind === 'midi')
      next.lengthTicks = Math.max(
        next.lengthTicks,
        t.notes.reduce((end, n) => Math.max(end, n[0] + n[1] + PPQ), 0),
        t.events.reduce((end, e) => Math.max(end, e.tick + PPQ), 0),
      )
  return { project: next, changed, kept, orphaned }
}
export function detachSource(project: Project, sourceId: string): Project {
  const next = structuredClone(project)
  next.sources = next.sources.filter((s) => s.id !== sourceId)
  for (const t of next.tracks)
    if (t.kind === 'midi' && t.link?.sourceId === sourceId) delete t.link
  if (next.mapOwner === sourceId) next.mapOwner = null
  return next
}
