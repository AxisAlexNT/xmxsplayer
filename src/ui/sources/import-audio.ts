import type { Project, AudioTrack } from '../../shared/model'
import { TimeMap } from '../../shared/time-map'
import { uniqueId } from '../../shared/ids'
import { TRACK_COLORS } from '../../shared/music'
export function importedAudio(
  project: Project,
  file: string,
  durationSec: number,
): { track: AudioTrack; lengthTicks: number } {
  const name = file.split('/').at(-1)!,
    id = uniqueId(
      name.replace(/\.[^.]+$/, ''),
      project.tracks.map((t) => t.id),
    )
  return {
    track: {
      id,
      name,
      kind: 'audio',
      color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length],
      mode: 'auto',
      solo: false,
      volume: 0.8,
      pan: 0,
      height: 108,
      file,
      offsetSec: 0,
      durationSec,
      semitones: 0,
      cents: 0,
      toCue: false,
      channelMode: 'stereo',
      filter: { enabled: false, type: 'lowpass', freq: 1200, q: 1 },
    },
    lengthTicks: Math.max(
      project.lengthTicks,
      Math.ceil(new TimeMap(project).secToTick(durationSec)),
    ),
  }
}
