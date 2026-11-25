import { computed } from 'vue'
import type { Project, Note } from '../../shared/model'
import type { RecordingProgress } from '../../shared/recording'
import { useProjectStore } from './project'
import { useRuntimeStore } from './runtime'

export function displayProject(project: Project, length: number, take?: RecordingProgress): Project {
  if (!take && length <= project.lengthTicks) return project
  return {
    ...project,
    lengthTicks: Math.max(project.lengthTicks, length),
    tracks: take ? project.tracks.map(track => {
      if (track.kind !== 'midi' || !track.armed) return track
      const recorded = take.tracks.find(t => t.trackId === track.id)
      if (!recorded) return track
      const notes = recorded.closed.filter(n => n[0] < take.barEnd)
        .map(([tick, dur, key, vel]): Note => [tick, Math.min(dur, take.barEnd - tick), key, vel])
      if (!notes.length) return track
      return { ...track, link: track.link && { ...track.link, state: 'ahead' as const }, notes: [...track.notes, ...notes].sort((a,b) => a[0]-b[0]) }
    }) : project.tracks,
  }
}

export function useDisplayProject() {
  const doc = useProjectStore()
  const runtime = useRuntimeStore()
  return computed(() => displayProject(doc.project, runtime.liveLengthTicks, runtime.liveTake))
}
