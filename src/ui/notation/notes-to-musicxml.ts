import { PPQ, type MidiTrack, type Project } from '../../shared/model'
import { staffSettings, voiceNotes } from './voicing'
import { TimeMap } from '../../shared/time-map'
import { append, parseXml, serializeXml } from './xml'
export interface ScoreMeasure {
  start: number
  end: number
  num: number
  den: number
  implicit?: boolean
}
const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  )
export function measureGrid(project: Project): ScoreMeasure[] {
  return new TimeMap(project)
    .measures(0, Math.max(1, project.lengthTicks))
    .map((m) => ({ start: m.start, end: m.end, num: m.num, den: m.den }))
}
export function spelling(
  key: number,
  fifths: number,
): { step: string; alter: number; octave: number } {
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'],
    flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'],
    natural: Record<string, number> = {
      C: 0,
      D: 2,
      E: 4,
      F: 5,
      G: 7,
      A: 9,
      B: 11,
    }
  const candidates = Object.entries(natural)
    .flatMap(([step, pc]) =>
      [-1, 0, 1].flatMap((alter) => {
        const octave = (key - pc - alter) / 12 - 1
        if (!Number.isInteger(octave)) return []
        const expected =
          fifths > 0 && sharps.indexOf(step) < fifths
            ? 1
            : fifths < 0 && flats.indexOf(step) < -fifths
              ? -1
              : 0
        return [
          {
            step,
            alter,
            octave,
            cost:
              Math.abs(alter - expected) * 3 +
              ((fifths < 0 && alter > 0) || (fifths >= 0 && alter < 0)
                ? 1
                : 0) +
              Math.abs(alter) * 0.1,
          },
        ]
      }),
    )
    .sort((a, b) => a.cost - b.cost)
  const { step, alter, octave } = candidates[0]
  return { step, alter, octave }
}
function durations(
  ticks: number,
  triplet: boolean,
): { ticks: number; type: string; triplet: boolean }[] {
  const types = [
      'whole',
      'half',
      'quarter',
      'eighth',
      '16th',
      '32nd',
      '64th',
      '128th',
    ],
    result: ReturnType<typeof durations> = []
  for (let i = 0; i < types.length; i++) {
    const value = ((PPQ * 4) / 2 ** i) * (triplet ? 2 / 3 : 1)
    while (ticks >= value - 1e-7) {
      result.push({ ticks: value, type: types[i], triplet })
      ticks -= value
    }
  }
  if (ticks > 1e-7) result.push({ ticks, type: '128th', triplet: false })
  return result
}
export function generatedPart(
  track: MidiTrack,
  project: Project,
  grid: ScoreMeasure[],
  partId: string,
  warnings?: string[],
): string {
  const doc = parseXml(`<part id="${escape(partId)}"/>`),
    part = doc.documentElement,
    map = new TimeMap(project),
    quant = Math.max(1, track.quantGrid)
  const settings = staffSettings(track, project)
  const { staves, truncated } = voiceNotes(track, settings)
  if (truncated)
    warnings?.push(
      `${track.name}: overlapping lines exceed the selected voice count.`,
    )
  const pitches = track.notes.map((n) => n[2]).sort((a, b) => a - b),
    clef =
      track.clef === 'auto'
        ? (pitches[Math.floor(pitches.length / 2)] ?? 60) >= 60
          ? 'treble'
          : 'bass'
        : track.clef
  const triplet = [320, 160, 80, 40, 20, 10].includes(quant)
  let previousKey = '',
    previousSig = ''
  let pedalDown = false
  for (let index = 0; index < grid.length; index++) {
    const measure = grid[index],
      m = append(part, 'measure', undefined, {
        number: index + 1,
        ...(measure.implicit ? { implicit: 'yes' } : {}),
      }),
      key = map.keyAt(measure.start),
      keyId = `${key.fifths}:${key.minor}`,
      sigId = `${measure.num}/${measure.den}`
    const attrs = append(m, 'attributes')
    append(attrs, 'divisions', PPQ)
    if (index === 0 || keyId !== previousKey) {
      const k = append(attrs, 'key')
      append(k, 'fifths', key.fifths)
      append(k, 'mode', key.minor ? 'minor' : 'major')
    }
    if (index === 0 || sigId !== previousSig) {
      const t = append(attrs, 'time')
      append(t, 'beats', measure.num)
      append(t, 'beat-type', measure.den)
    }
    if (index === 0) {
      if (staves.length === 2) append(attrs, 'staves', 2)
      for (let i = 0; i < staves.length; i++) {
        const bass = staves.length === 2 ? i === 1 : clef === 'bass'
        const c = append(attrs, 'clef', undefined, { number: i + 1 })
        append(c, 'sign', bass ? 'F' : 'G')
        append(c, 'line', bass ? 4 : 2)
      }
    }
    previousKey = keyId
    previousSig = sigId
    if (settings.pedal) {
      for (const event of track.events) {
        if (
          event.type !== 'cc' ||
          event.num !== 64 ||
          event.tick < measure.start ||
          event.tick > measure.end ||
          (event.tick === measure.end && index < grid.length - 1)
        )
          continue
        const down = event.value >= 64
        if (pedalDown === down) continue
        pedalDown = down
        const direction = append(m, 'direction', undefined, {
          placement: 'below',
        })
        append(append(direction, 'direction-type'), 'pedal', undefined, {
          type: down ? 'start' : 'stop',
        })
        append(direction, 'offset', event.tick - measure.start)
        append(direction, 'staff', staves.length)
      }
    }
    let first = true
    for (const [staff, voices] of staves.entries()) {
      const active = voices.map((voice) =>
        voice.filter((g) => g.end > measure.start && g.tick < measure.end),
      )
      for (const [v, onsets] of active.entries()) {
        if (!onsets.length && (v > 0 || active.some((groups) => groups.length)))
          continue
        if (!first)
          append(append(m, 'backup'), 'duration', measure.end - measure.start)
        first = false
        const voice = 1 + staff * 2 + v
        let cursor = measure.start
        const rest = (until: number): void => {
          for (const duration of durations(until - cursor, triplet)) {
            const n = append(m, 'note')
            append(n, 'rest')
            append(n, 'duration', duration.ticks)
            append(n, 'voice', voice)
            append(n, 'type', duration.type)
            if (duration.triplet) {
              const tm = append(n, 'time-modification')
              append(tm, 'actual-notes', 3)
              append(tm, 'normal-notes', 2)
            }
            append(n, 'staff', staff + 1)
          }
          cursor = until
        }
        for (const group of onsets) {
          if (group.end <= measure.start || group.tick >= measure.end) continue
          const start = Math.max(measure.start, group.tick),
            end = Math.min(measure.end, group.end)
          if (start > cursor) rest(start)
          const beat =
            ((PPQ * 4) / measure.den) *
            (measure.den === 8 && measure.num % 3 === 0 ? 3 : 1)
          const offset = (start - measure.start) % beat
          const split = offset ? Math.min(end, start + beat - offset) : end
          const segments = [
            ...durations(split - start, triplet),
            ...durations(end - split, triplet),
          ]
          let at = start
          for (const segment of segments) {
            const continues = at + segment.ticks < group.end - 1e-7,
              from = at > group.tick + 1e-7
            group.notes.forEach((note, i) => {
              const n = append(m, 'note')
              if (i) append(n, 'chord')
              const p = append(n, 'pitch'),
                s = spelling(note[2], key.fifths)
              append(p, 'step', s.step)
              if (s.alter) append(p, 'alter', s.alter)
              append(p, 'octave', s.octave)
              append(n, 'duration', segment.ticks)
              if (from) append(n, 'tie', undefined, { type: 'stop' })
              if (continues) append(n, 'tie', undefined, { type: 'start' })
              append(n, 'voice', voice)
              append(n, 'type', segment.type)
              if (segment.triplet) {
                const tm = append(n, 'time-modification')
                append(tm, 'actual-notes', 3)
                append(tm, 'normal-notes', 2)
              }
              if (
                active.every((groups) => groups.length) &&
                active.length === 2
              )
                append(n, 'stem', v === 0 ? 'up' : 'down')
              append(n, 'staff', staff + 1)
              if (from || continues) {
                const nt = append(n, 'notations')
                if (from) append(nt, 'tied', undefined, { type: 'stop' })
                if (continues) append(nt, 'tied', undefined, { type: 'start' })
              }
            })
            at += segment.ticks
          }
          cursor = end
        }
        if (cursor < measure.end) rest(measure.end)
      }
    }
  }
  return serializeXml(part)
}
export function notesToMusicXml(track: MidiTrack, project: Project): string {
  const part = generatedPart(track, project, measureGrid(project), 'P1')
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>${escape(track.name)}</part-name></score-part></part-list>${part}</score-partwise>`
}
export const xmlEscape = escape
