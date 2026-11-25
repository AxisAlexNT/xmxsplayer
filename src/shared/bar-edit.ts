import { produce } from 'immer'
import { PPQ, type Project, type TempoMode } from './model'
import { fitAudioLength } from './beat-grid'
import { TimeMap } from './time-map'

export type BarOperation =
  'append' | 'insert' | 'delete' | 'signature' | 'tempo'

export function barEditReason(
  project: Project,
  operation: BarOperation,
): string {
  if (operation === 'append') return ''
  if (project.mapOwner !== null)
    return 'The linked score owns the bar grid — edit bars in MuseScore'
  if (operation !== 'tempo' && project.beatAnchors.length)
    return 'Clear the tapped beat map first'
  return ''
}

function check(project: Project, operation: BarOperation, ...counts: number[]) {
  const reason = barEditReason(project, operation)
  if (reason) throw Error(reason)
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 1))
    throw Error('Enter a positive whole number')
  return new TimeMap(project)
}

function uniqueTicks<T extends { tick: number }>(entries: T[]): T[] {
  return [
    ...new Map(entries.map((entry) => [entry.tick, entry])).values(),
  ].sort((a, b) => a.tick - b.tick)
}

export function appendBars(project: Project, count: number): Project {
  const map = check(project, 'append', count)
  const { num, den } = map.signatureAt(project.lengthTicks)
  return {
    ...project,
    lengthTicks: project.lengthTicks + (count * PPQ * 4 * num) / den,
  }
}

function shift(
  project: Project,
  start: number,
  end: number,
  delta: number,
): Project {
  const inside = (tick: number) => tick >= start && tick < end
  const move = (tick: number) =>
    tick < start ? tick : inside(tick) ? start : tick + delta
  return produce(project, (draft) => {
    for (const track of draft.tracks) {
      if (track.kind !== 'midi') continue
      const changed =
        track.notes.some(
          ([tick, dur]) => tick >= start || (delta < 0 && tick + dur > start),
        ) || track.events.some((e) => e.tick >= start)
      if (!changed) continue
      track.notes = track.notes
        .filter(([tick]) => !inside(tick))
        .map(([tick, dur, key, vel]) => [
          move(tick),
          delta < 0 && tick < start ? Math.min(dur, start - tick) : dur,
          key,
          vel,
        ])
      track.events = track.events.filter((e) => !inside(e.tick))
      for (const event of track.events) event.tick = move(event.tick)
      if (track.link) track.link.state = 'ahead'
    }
    draft.cues = draft.cues.filter((c) => !inside(c.tick))
    for (const cue of draft.cues) cue.tick = move(cue.tick)
    for (const entries of [draft.tempos, draft.timeSigs, draft.keySigs]) {
      for (const entry of entries) entry.tick = move(entry.tick)
    }
    draft.tempos = uniqueTicks(draft.tempos)
    draft.timeSigs = uniqueTicks(draft.timeSigs)
    draft.keySigs = uniqueTicks(draft.keySigs)
    draft.loop.startTick = move(draft.loop.startTick)
    draft.loop.endTick = move(draft.loop.endTick)
    if (draft.loop.startTick === draft.loop.endTick) {
      draft.loop.enabled = false
      draft.loop.endTick = draft.loop.startTick + 1
    }
    draft.lengthTicks = move(draft.lengthTicks)
  })
}

export function insertBars(
  project: Project,
  bar: number,
  count: number,
  sig?: { num: number; den: number },
): Project {
  const map = check(project, 'insert', bar, count)
  const tick = map.barToTick(bar)
  if (tick > project.lengthTicks) throw Error('Choose a bar in the project')
  const previous = map.signatureAt(tick)
  const { num, den } = sig ?? previous
  const delta = (count * PPQ * 4 * num) / den
  const next = shift(project, tick, tick, delta)
  if (sig || project.timeSigs.some((s) => s.tick === tick)) {
    return {
      ...next,
      timeSigs: uniqueTicks([
        ...next.timeSigs,
        { tick, num, den },
        { tick: tick + delta, num: previous.num, den: previous.den },
      ]),
    }
  }
  return next
}

export function deleteBars(
  project: Project,
  bar: number,
  count: number,
): Project {
  const map = check(project, 'delete', bar, count)
  const start = map.barToTick(bar)
  const end = Math.min(project.lengthTicks, map.barToTick(bar + count))
  if (end <= start) throw Error('Choose a bar in the project')
  return shift(project, start, end, start - end)
}

export function setTempoFrom(
  project: Project,
  bar: number,
  bpm: number,
): Project {
  const map = check(project, 'tempo', bar)
  const tick = map.barToTick(bar)
  if (!(bpm > 0 && Number.isFinite(bpm))) throw Error('Enter a positive tempo')
  // Retain the timing of preceding taps when converting to a manual tempo map.
  const tempos =
    project.beatAnchors.length >= 2
      ? map.tempos
          .filter((t) => t.tick < tick)
          .map(({ tick, bpm }) => ({ tick, bpm }))
      : project.tempos
  return {
    ...project,
    beatAnchors: [],
    tempos: uniqueTicks([...tempos, { tick, bpm }]),
  }
}

export function setTimeSigFrom(
  project: Project,
  bar: number,
  num: number,
  den: number,
): Project {
  const map = check(project, 'signature', bar, num, den)
  const tick = map.barToTick(bar)
  let previous = { tick, bar, num, den }
  const timeSigs = [
    ...project.timeSigs.filter((s) => s.tick < tick),
    { tick, num, den },
  ]
  for (const entry of map.signatures.filter((s) => s.tick > tick)) {
    const anchored =
      previous.tick +
      ((entry.bar - previous.bar) * PPQ * 4 * previous.num) / previous.den
    timeSigs.push({ tick: anchored, num: entry.num, den: entry.den })
    previous = { ...entry, tick: anchored }
  }
  return { ...project, timeSigs }
}

function writtenTempoMap(project: Project) {
  if (project.mapOwner !== null)
    throw Error('Detach the linked score to edit tempo')
  if (project.beatAnchors.length)
    throw Error('Clear the tapped beat map to edit tempo')
  return new TimeMap(project)
}

function withTempos(project: Project, entries: Project['tempos']): Project {
  const tempos = uniqueTicks(entries).filter((entry, i, sorted) => {
    if (!Number.isFinite(entry.bpm) || entry.bpm < 20 || entry.bpm > 400)
      throw Error('Every tempo must be between 20 and 400 BPM')
    return !i || Math.abs(entry.bpm - sorted[i - 1].bpm) > 1e-8
  })
  const next = { ...project, tempos }
  next.lengthTicks = fitAudioLength(next)
  return next
}

export function scaleTempos(project: Project, factor: number): Project {
  const map = writtenTempoMap(project)
  return withTempos(
    project,
    map.tempos.map(({ tick, bpm }) => ({ tick, bpm: bpm * factor })),
  )
}

export function flattenTempo(project: Project, bpm: number): Project {
  writtenTempoMap(project)
  return withTempos(project, [{ tick: 0, bpm }])
}

export function setSectionTempo(
  project: Project,
  tick: number,
  bpm: number,
): Project {
  const map = writtenTempoMap(project)
  if (!Number.isFinite(tick) || tick < 0) throw Error('Invalid tempo position')
  const { enabled, startTick, endTick } = project.loop
  if (enabled && endTick <= startTick) throw Error('Invalid loop range')
  const start = enabled
    ? startTick
    : map.tempos.filter((t) => t.tick <= tick).at(-1)!.tick
  const end = enabled
    ? endTick
    : (map.tempos.find((t) => t.tick > tick)?.tick ?? Infinity)
  const entries = map.tempos
    .filter((t) => t.tick < start || t.tick >= end)
    .map(({ tick, bpm }) => ({ tick, bpm }))
  entries.push({ tick: start, bpm })
  if (enabled) entries.push({ tick: end, bpm: map.tempoAt(end) })
  return withTempos(project, entries)
}

export function editTempo(
  project: Project,
  tick: number,
  bpm: number,
  mode: TempoMode,
): Project {
  if (mode === 'rewrite') return flattenTempo(project, bpm)
  if (mode === 'section') return setSectionTempo(project, tick, bpm)
  return scaleTempos(project, bpm / new TimeMap(project).tempoAt(tick))
}
