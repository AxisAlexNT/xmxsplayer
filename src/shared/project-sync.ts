import type { Project } from './model'
import type { Bus } from './bus'

export function syncProject(
  bus: Bus,
  project: Project,
  previous?: Project,
  force = false,
): void {
  if (project === previous && !force) return
  // Scrolling or annotating the sheet only changes renderer state.
  if (!force && previous && previous.documents !== project.documents) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(project)] as (keyof Project)[])
    if ([...keys].every(key => key === 'documents' || previous[key] === project[key])) return
  }
  bus.send('project:meta', {
    ...project,
    tracks: project.tracks.filter(track => track.kind !== 'pdf').map((t) =>
      t.kind === 'midi' ? { ...t, notes: [] } : t,
    ),
  })
  for (const track of project.tracks) {
    const old = previous?.tracks.find((t) => t.id === track.id)
    if (
      track.kind === 'midi' &&
      (force || old?.kind !== 'midi' || old.notes !== track.notes)
    )
      bus.send('track:notes', { trackId: track.id, notes: track.notes })
  }
}
export function applyMetadata(meta: Project, previous?: Project): Project {
  return {
    ...meta,
    tracks: meta.tracks.map((track) => {
      const old = previous?.tracks.find((t) => t.id === track.id)
      return track.kind === 'midi' && old?.kind === 'midi'
        ? { ...track, notes: old.notes }
        : track
    }),
  }
}
