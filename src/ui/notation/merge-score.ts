import { PPQ, type MidiTrack, type Project } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import {
  generatedPart,
  measureGrid,
  xmlEscape,
  type ScoreMeasure,
} from './notes-to-musicxml'
import { unrollScore } from './unroll'
import {
  append,
  child,
  children,
  descendants,
  parseXml,
  serializeXml,
  text,
  type XmlElement,
} from './xml'
export interface MergedNotation {
  musicxml: string
  staffTrackIds: string[]
  grid: ScoreMeasure[]
  warnings: string[]
  excludedTrackIds: string[]
}
export function musicXmlGrid(xml: string, project: Project): ScoreMeasure[] {
  const root = parseXml(xml).documentElement,
    parts = children(root, 'part'),
    first = children(parts[0] ?? root, 'measure'),
    result: ScoreMeasure[] = []
  const divisions = parts.map(() => 1)
  let num = 4,
    den = 4,
    tick = 0
  for (let index = 0; index < first.length; index++) {
    const m = first[index],
      sig = child(child(m, 'attributes') ?? m, 'time')
    if (sig) {
      num =
        Number(
          text(sig, 'beats')
            .split('+')
            .reduce((sum, n) => sum + Number(n), 0),
        ) || num
      den = Number(text(sig, 'beat-type')) || den
    }
    let actual = 0
    parts.forEach((part, p) => {
      const measure = children(part, 'measure')[index]
      if (!measure) return
      let cursor = 0,
        end = 0
      for (const el of children(measure)) {
        if (el.localName === 'attributes') {
          divisions[p] = Number(text(el, 'divisions')) || divisions[p]
          continue
        }
        const dur = (Number(text(el, 'duration')) * PPQ) / divisions[p]
        if (el.localName === 'backup') cursor -= dur
        else if (el.localName === 'forward') {
          cursor += dur
          end = Math.max(end, cursor)
        } else if (
          el.localName === 'note' &&
          !child(el, 'chord') &&
          !child(el, 'grace')
        ) {
          cursor += dur
          end = Math.max(end, cursor)
        }
      }
      actual = Math.max(actual, end)
    })
    const implicit = m.getAttribute('implicit') === 'yes',
      length =
        implicit && actual > 0
          ? actual
          : Math.max(actual, (PPQ * 4 * num) / den)
    result.push({
      start: tick,
      end: tick + length,
      num,
      den,
      ...(implicit ? { implicit: true } : {}),
    })
    tick += length
  }
  return result.length ? result : measureGrid(project)
}
function splitStaves(xml: string): { name: string; part: XmlElement }[] {
  const root = parseXml(xml).documentElement,
    partList = child(root, 'part-list'),
    parts = children(root, 'part'),
    result: { name: string; part: XmlElement }[] = []
  for (const part of parts) {
    const name = partList
        ? text(
            children(partList, 'score-part').find(
              (p) => p.getAttribute('id') === part.getAttribute('id'),
            ) ?? part,
            'part-name',
          ) || 'Part'
        : 'Part',
      count = Math.max(
        1,
        ...descendants(part, 'staves').map((n) => Number(n.textContent) || 1),
      )
    for (let staff = 1; staff <= count; staff++) {
      const out = parseXml('<part/>').documentElement
      for (const measure of children(part, 'measure')) {
        const clone = measure.cloneNode(false) as XmlElement
        out.appendChild(clone)
        let input = 0,
          output = 0,
          lastOnset = 0,
          lastOutputOnset = -Infinity,
          lastOutputVoice = ''
        for (const el of children(measure)) {
          const kind = el.localName,
            duration = Number(text(el, 'duration')) || 0
          if (kind === 'backup') {
            input -= duration
            continue
          }
          if (kind === 'forward') {
            input += duration
            continue
          }
          if (kind === 'attributes') {
            const attrs = el.cloneNode(true) as XmlElement
            for (const staves of children(attrs, 'staves'))
              attrs.removeChild(staves)
            for (const name of [
              'key',
              'time',
              'clef',
              'staff-details',
              'transpose',
            ])
              for (const item of children(attrs, name)) {
                const n = item.getAttribute('number')
                if (n && Number(n) !== staff) attrs.removeChild(item)
                else item.removeAttribute('number')
              }
            clone.appendChild(attrs)
            continue
          }
          const target = Number(text(el, 'staff')) || 1
          if (kind === 'note') {
            const chord = !!child(el, 'chord'),
              grace = !!child(el, 'grace'),
              onset = chord ? lastOnset : input
            if (!chord) lastOnset = input
            if (target === staff) {
              const voice = text(el, 'voice') || '1',
                outputChord =
                  chord &&
                  lastOutputOnset === onset &&
                  lastOutputVoice === voice
              if (!outputChord && Math.abs(onset - output) > 1e-7) {
                const move = append(
                  clone,
                  onset > output ? 'forward' : 'backup',
                )
                append(move, 'duration', Math.abs(onset - output))
                output = onset
              }
              const note = el.cloneNode(true) as XmlElement
              if (!outputChord) {
                const c = child(note, 'chord')
                if (c) note.removeChild(c)
              }
              for (const s of children(note, 'staff')) note.removeChild(s)
              clone.appendChild(note)
              if (!outputChord && !grace) output += duration
              lastOutputOnset = onset
              lastOutputVoice = voice
            }
            if (!chord && !grace) input += duration
          } else if (kind === 'direction' || kind === 'harmony') {
            if (target !== staff) continue
            const copy = el.cloneNode(true) as XmlElement
            for (const s of children(copy, 'staff')) copy.removeChild(s)
            const offset = (Number(text(copy, 'offset')) || 0) + input - output
            const old = child(copy, 'offset')
            if (old) copy.removeChild(old)
            if (offset) append(copy, 'offset', offset)
            clone.appendChild(copy)
          } else if (kind !== 'print' && kind !== 'sound')
            clone.appendChild(el.cloneNode(true))
        }
      }
      result.push({
        name: count > 1 ? `${name} (staff ${staff})` : name,
        part: out,
      })
    }
  }
  return result
}
export function mergeNotation(
  project: Project,
  ownerXml?: string,
): MergedNotation {
  const warnings: string[] = [],
    excludedTrackIds: string[] = [],
    midi = project.tracks.filter((t): t is MidiTrack => t.kind === 'midi'),
    owner = project.sources.find((s) => s.id === project.mapOwner)
  const linked = owner
    ? midi.filter((t) => t.link?.sourceId === owner.id && !t.link.orphaned)
    : []
  let grid = measureGrid(project),
    original: { name: string; part: XmlElement }[] = [],
    baseValid = false
  if (ownerXml && owner) {
    const unrolled = unrollScore(ownerXml)
    if (unrolled.warning) warnings.push(unrolled.warning)
    original = splitStaves(unrolled.musicxml)
    grid = musicXmlGrid(unrolled.musicxml, project)
    const indices = linked.map((t) => Number(t.link!.key.split(':')[0])),
      unique = new Set(indices)
    baseValid =
      unique.size === original.length &&
      indices.length === original.length &&
      indices.every((i) => Number.isInteger(i) && i >= 0 && i < original.length)
    if (!baseValid)
      warnings.push(
        'Score staff count does not match linked tracks; showing this source as piano roll',
      )
    const last = grid.at(-1)!.end,
      sourceEnd =
        owner.durationTicks ??
        linked.reduce(
          (end, t) =>
            t.notes.reduce((end, n) => Math.max(end, n[0] + n[1]), end),
          0,
        ),
      map = new TimeMap(project),
      sig = map.signatureAt(last)
    if (
      Math.abs(last - sourceEnd) > ((sig.num * 4) / sig.den) * PPQ &&
      !unrolled.warning
    )
      warnings.push(
        'Repeat/jump structure not understood — staff may be misaligned; use Unroll Repeats in MuseScore',
      )
  }
  // Keep generated parts and long accompaniment on the same complete measure grid.
  const end = grid.at(-1)?.end ?? 0
  if (end < project.lengthTicks) {
    const map = new TimeMap(project)
    for (const m of map.measures(end, project.lengthTicks)) {
      if (m.end <= end) continue
      grid.push({
        start: Math.max(end, m.start),
        end: m.end,
        num: m.num,
        den: m.den,
      })
    }
  }
  const included = midi.filter((t) => {
    const drum = project.base.patch.some(
      (p) =>
        p.trackId === t.id &&
        project.instruments.some((i) => i.id === p.instrumentId && i.isDrum),
    )
    const other = !!t.link && t.link.sourceId !== project.mapOwner
    const invalid =
      !!t.link &&
      t.link.state === 'synced' &&
      !t.link.orphaned &&
      owner?.kind !== 'mid' &&
      (!ownerXml || !baseValid)
    if (drum || other || invalid) {
      excludedTrackIds.push(t.id)
      return false
    }
    return true
  })
  const parts = included.map((track, index) => {
    const id = `P${index + 1}`,
      source =
        track.link?.state === 'synced' && !track.link.orphaned && baseValid
          ? original[Number(track.link.key.split(':')[0])]?.part
          : undefined
    if (!source) return generatedPart(track, project, grid, id)
    const copy = source.cloneNode(true) as XmlElement
    copy.setAttribute('id', id)
    const generated = parseXml(
        generatedPart(track, project, grid, id),
      ).documentElement,
      existing = children(copy, 'measure')
    for (const m of children(generated, 'measure').slice(existing.length))
      copy.appendChild(m.cloneNode(true))
    for (const m of children(copy, 'measure'))
      for (const el of [m, ...Array.from(m.getElementsByTagName('*'))]) {
        el.removeAttribute('id')
        el.removeAttribute('xml:id')
      }
    return serializeXml(copy)
  })
  if (midi.some((t) => t.link && t.link.sourceId !== project.mapOwner))
    warnings.push(
      'Other linked scores are shown as piano roll; only the map-owner score renders as staves',
    )
  return {
    musicxml: `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list>${included.map((t, i) => `<score-part id="P${i + 1}"><part-name>${xmlEscape(t.name)}</part-name></score-part>`).join('')}</part-list>${parts.join('')}</score-partwise>`,
    staffTrackIds: included.map((t) => t.id),
    grid,
    warnings,
    excludedTrackIds,
  }
}
