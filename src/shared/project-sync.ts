import type { Project } from './model'
import type { Bus } from './bus'

export function syncProject(bus: Bus, project: Project, previous?: Project, force = false): void {
  if (project === previous && !force) return
  bus.send('project:meta', { ...project, tracks: project.tracks.map(t => t.kind === 'midi' ? { ...t, notes: [] } : t) })
  for (const track of project.tracks) {
    const old = previous?.tracks.find(t => t.id === track.id)
    if (track.kind === 'midi' && (force || old?.kind !== 'midi' || old.notes !== track.notes)) bus.send('track:notes', { trackId: track.id, notes: track.notes })
  }
}
export function applyMetadata(meta: Project, previous?: Project): Project {
  return { ...meta, tracks: meta.tracks.map(track => {
    const old = previous?.tracks.find(t => t.id === track.id)
    return track.kind === 'midi' && old?.kind === 'midi' ? { ...track, notes: old.notes } : track
  }) }
}
