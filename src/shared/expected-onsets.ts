import type { Id, Project } from './model'
export interface ExpectedNote {
  trackId: Id
  key: number
  tick: number
}
export interface ExpectedOnset {
  tick: number
  keys: number[]
  trackIds: Id[]
  notes: ExpectedNote[]
}
/** Group against the first onset, so a rolled chord cannot absorb the next phrase. */
export function expectedOnsets(
  project: Pick<Project, 'tracks'>,
): ExpectedOnset[] {
  const notes = project.tracks
    .flatMap((track) =>
      track.kind === 'midi' && track.mode === 'live' && track.leads
        ? track.notes.map((note) => ({
            tick: note[0],
            key: note[2],
            trackId: track.id,
          }))
        : [],
    )
    .sort(
      (a, b) =>
        a.tick - b.tick || a.trackId.localeCompare(b.trackId) || a.key - b.key,
    )
  const onsets: ExpectedOnset[] = []
  for (const note of notes) {
    let onset = onsets.at(-1)
    if (!onset || note.tick - onset.tick > 30) {
      onset = { tick: note.tick, keys: [], trackIds: [], notes: [] }
      onsets.push(onset)
    }
    onset.notes.push(note)
    if (!onset.keys.includes(note.key)) onset.keys.push(note.key)
    if (!onset.trackIds.includes(note.trackId))
      onset.trackIds.push(note.trackId)
  }
  for (const onset of onsets) onset.keys.sort((a, b) => a - b)
  return onsets
}
