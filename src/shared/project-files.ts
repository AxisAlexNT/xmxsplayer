import { parse, stringify } from 'yaml'
import { parseMidi, writeMidi, type MidiEvent } from 'midi-file'
import type { FileMap } from './api'
import type { MidiTrack, Project } from './model'
import { PPQ } from './model'
import { noteName, projectSchema } from './schema'

export class ProjectFileError extends Error {
  constructor(
    public file: string,
    public detail: string,
  ) {
    super(`${file}: ${detail}`)
  }
}
const text = (value: unknown): string => stringify(value, { lineWidth: 100 })
export function encodeTrack(track: MidiTrack): Uint8Array {
  const events: { tick: number; order: number; event: MidiEvent }[] = []
  for (const [tick, dur, key, vel] of track.notes) {
    events.push({
      tick: Math.round(tick),
      order: 1,
      event: {
        deltaTime: 0,
        type: 'noteOn',
        channel: 0,
        noteNumber: key,
        velocity: vel,
      },
    })
    events.push({
      tick: Math.round(tick + dur),
      order: 0,
      event: {
        deltaTime: 0,
        type: 'noteOff',
        channel: 0,
        noteNumber: key,
        velocity: 0,
      },
    })
  }
  for (const event of track.events)
    events.push({
      tick: Math.round(event.tick),
      order: 0,
      event:
        event.type === 'cc'
          ? {
              deltaTime: 0,
              type: 'controller',
              channel: 0,
              controllerType: event.num,
              value: event.value,
            }
          : {
              deltaTime: 0,
              type: 'pitchBend',
              channel: 0,
              value: event.value - 8192,
            },
    })
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  let previous = 0
  const data = events.map(({ tick, event }) => {
    const deltaTime = tick - previous
    previous = tick
    return { ...event, deltaTime }
  })
  data.push({ deltaTime: 0, meta: true, type: 'endOfTrack' })
  return new Uint8Array(
    writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: PPQ },
      tracks: [data],
    }),
  )
}
export function decodeTrack(
  bytes: Uint8Array,
): Pick<MidiTrack, 'notes' | 'events'> {
  const midi = parseMidi(bytes)
  if (!midi.header.ticksPerBeat)
    throw new Error('SMPTE time division is unsupported')
  const factor = PPQ / midi.header.ticksPerBeat
  const notes: MidiTrack['notes'] = []
  const events: MidiTrack['events'] = []
  for (const track of midi.tracks) {
    let tick = 0
    const held = new Map<string, { tick: number; vel: number }[]>()
    for (const event of track) {
      tick += event.deltaTime * factor
      if (event.type === 'noteOn' || event.type === 'noteOff') {
        const key = `${event.channel}:${event.noteNumber}`
        const queue = held.get(key) ?? []
        if (event.type === 'noteOn' && event.velocity > 0)
          queue.push({ tick, vel: event.velocity })
        else {
          const on = queue.shift()
          if (on && tick > on.tick)
            notes.push([on.tick, tick - on.tick, event.noteNumber, on.vel])
        }
        held.set(key, queue)
      } else if (event.type === 'controller')
        events.push({
          tick,
          type: 'cc',
          num: event.controllerType,
          value: event.value,
        })
      else if (event.type === 'pitchBend')
        events.push({ tick, type: 'bend', num: 0, value: event.value + 8192 })
    }
  }
  return {
    notes: notes.sort((a, b) => a[0] - b[0] || a[2] - b[2]),
    events: events.sort((a, b) => a.tick - b.tick),
  }
}
export function toFiles(project: Project): FileMap {
  const p = projectSchema.parse(project)
  const {
    registers,
    base,
    scenes,
    cues,
    clips,
    orchestras,
    mappings,
    script,
    ...meta
  } = p
  const files: FileMap = {}
  const tracks = meta.tracks.map((track) => {
    if (track.kind !== 'midi') return track
    const rest = { ...track }
    delete (rest as Partial<MidiTrack>).notes
    delete (rest as Partial<MidiTrack>).events
    if (!track.link || track.link.state === 'ahead' || track.link.orphaned)
      files[`tracks/${track.id}.mid`] = encodeTrack(track)
    return rest
  })
  files['project.yaml'] = text({ ...meta, tracks })
  const { bindings, ...setup } = base
  const readable = (s: Partial<Project['base']>) => ({
    ...s,
    ...(s.zones
      ? {
          zones: s.zones.map((z) => ({
            ...z,
            lo: noteName(z.lo),
            hi: noteName(z.hi),
          })),
        }
      : {}),
  })
  files['setup.yaml'] = text({
    registers,
    base: readable(setup),
    scenes: scenes.map(readable),
    cues,
  })
  files['bindings.yaml'] = text({ bindings })
  files['orchestras.yaml'] = text({ orchestras })
  files['clips.yaml'] = text({ clips })
  files['script.ts'] = script
  for (const [id, mapping] of Object.entries(mappings))
    files[`mappings/${id}.yaml`] = text(mapping)
  return files
}
export function fromFiles(files: FileMap, previous?: Project): Project {
  const read = (file: string): unknown => {
    try {
      const value = files[file]
      if (typeof value !== 'string') throw new Error('Missing text file')
      return parse(value, { maxAliasCount: 100 })
    } catch (error) {
      throw new ProjectFileError(file, String(error))
    }
  }
  const obj = (file: string): Record<string, unknown> => {
    const v = read(file)
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new ProjectFileError(file, 'Expected an object')
    return v as Record<string, unknown>
  }
  const onlyKeys = (
    file: string,
    value: Record<string, unknown>,
    allowed: string[],
  ): void => {
    const unexpected = Object.keys(value).find((key) => !allowed.includes(key))
    if (unexpected)
      throw new ProjectFileError(file, `${unexpected}: Unrecognized key`)
  }
  const meta = obj('project.yaml')
  onlyKeys(
    'project.yaml',
    meta,
    Object.keys(projectSchema.shape).filter(
      (k) =>
        ![
          'registers',
          'base',
          'scenes',
          'cues',
          'clips',
          'orchestras',
          'mappings',
          'script',
        ].includes(k),
    ),
  )
  const setup = obj('setup.yaml')
  onlyKeys('setup.yaml', setup, ['registers', 'base', 'scenes', 'cues'])
  const shared = obj('bindings.yaml')
  onlyKeys('bindings.yaml', shared, ['bindings'])
  const clips = obj('clips.yaml')
  onlyKeys('clips.yaml', clips, ['clips'])
  const mappings: Record<string, unknown> = {}
  for (const [file] of Object.entries(files))
    if (/^mappings\/[a-z0-9]+(?:-[a-z0-9]+)*\.yaml$/.test(file))
      mappings[file.slice(9, -5)] = read(file)
  const rawTracks = Array.isArray(meta.tracks) ? meta.tracks : []
  const tracks = rawTracks.map((track: Record<string, unknown>) => {
    if (!track || track.kind !== 'midi') return track
    const file = `tracks/${track.id}.mid`
    const old = previous?.tracks.find((t) => t.id === track.id)
    let data: Pick<MidiTrack, 'notes' | 'events'> =
      old?.kind === 'midi'
        ? { notes: old.notes, events: old.events }
        : { notes: [], events: [] }
    const link = track.link as MidiTrack['link']
    if (!link || link.state === 'ahead' || link.orphaned) {
      const bytes = files[file]
      if (!(bytes instanceof Uint8Array))
        throw new ProjectFileError(file, 'Missing MIDI file')
      try {
        data = decodeTrack(bytes)
      } catch (error) {
        throw new ProjectFileError(file, String(error))
      }
    }
    return { ...track, ...data }
  })
  const result = projectSchema.safeParse({
    ...meta,
    tracks: Array.isArray(meta.tracks) ? tracks : meta.tracks,
    ...setup,
    base: { ...(setup.base as object), bindings: shared.bindings },
    orchestras:
      files['orchestras.yaml'] === undefined
        ? []
        : obj('orchestras.yaml').orchestras,
    clips: clips.clips,
    mappings,
    script: files['script.ts'],
  })
  if (!result.success) {
    const issue = result.error.issues[0]
    const root = issue.path[0]
    const file = ['registers', 'base', 'scenes', 'cues'].includes(String(root))
      ? 'setup.yaml'
      : root === 'clips'
        ? 'clips.yaml'
        : root === 'mappings'
          ? `mappings/${String(issue.path[1])}.yaml`
          : 'project.yaml'
    throw new ProjectFileError(
      root === 'base' && issue.path[1] === 'bindings' ? 'bindings.yaml' : file,
      result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    )
  }
  for (const track of result.data.tracks) {
    const old = previous?.tracks.find((t) => t.id === track.id)
    if (track.kind !== 'midi' || old?.kind !== 'midi') continue
    if (JSON.stringify(track.notes) === JSON.stringify(old.notes))
      track.notes = old.notes
    if (JSON.stringify(track.events) === JSON.stringify(old.events))
      track.events = old.events
  }
  return result.data
}
export function sameContent(
  a: FileMap[string] | undefined,
  b: FileMap[string] | undefined,
): boolean {
  if (a === b) return true
  return (
    a instanceof Uint8Array &&
    b instanceof Uint8Array &&
    a.length === b.length &&
    a.every((v, i) => v === b[i])
  )
}
