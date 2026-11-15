import type { AudioTrack, Project } from './model'
import { TimeMap, anchorTempos } from './time-map'
export class TapTempo {
  private taps: number[] = []
  tap(sec: number): number | null {
    if (
      this.taps.length &&
      (sec - this.taps.at(-1)! > 3 || sec <= this.taps.at(-1)!)
    )
      this.taps = []
    this.taps.push(sec)
    this.taps = this.taps.slice(-8)
    if (this.taps.length < 4) return null
    return (60 * (this.taps.length - 1)) / (this.taps.at(-1)! - this.taps[0])
  }
  reset(): void {
    this.taps = []
  }
}
export function applyBeatMap(
  project: Project,
  trackId: string,
  anchors: Project['beatAnchors'],
  songSec: number,
): { patch: Partial<Project>; tick: number } {
  if (project.mapOwner !== null)
    throw Error('The linked score owns the bar grid')
  const track = project.tracks.find(
    (t): t is AudioTrack => t.kind === 'audio' && t.id === trackId,
  )
  if (!track) throw Error('Select an audio track first')
  if (anchors.length < 2)
    throw Error('Tap at least two beats to create a beat map')
  const tempos = anchorTempos(anchors),
    map = new TimeMap({ ...project, beatAnchors: anchors, tempos })
  const offsetSec = map.tickToSec(anchors[0].tick) - anchors[0].sec,
    inputSec = songSec - track.offsetSec
  const tracks = project.tracks.map((t) =>
    t.id === trackId ? { ...t, offsetSec } : t,
  )
  const lengthTicks = Math.max(
    project.lengthTicks,
    ...tracks.map((t) =>
      t.kind === 'audio'
        ? Math.ceil(map.secToTick(t.offsetSec + t.durationSec))
        : t.notes.reduce((end, n) => Math.max(end, n[0] + n[1]), 0),
    ),
  )
  return {
    patch: { beatAnchors: anchors, tempos, tracks, lengthTicks },
    tick: Math.max(0, map.secToTick(inputSec + offsetSec)),
  }
}
export function snapLoop(map: TimeMap, loop: Project['loop']): Project['loop'] {
  const start = map.barToTick(map.tickToBarBeat(loop.startTick).bar),
    end = map.nextBar(loop.endTick, true)
  return {
    ...loop,
    startTick: start,
    endTick: Math.max(map.nextBar(start), end),
  }
}

export function fitAudioLength(project: Project): number {
  const map = new TimeMap(project)
  return Math.max(
    project.lengthTicks,
    ...project.tracks.map((t) =>
      t.kind === 'audio'
        ? Math.ceil(map.secToTick(t.offsetSec + t.durationSec))
        : 0,
    ),
  )
}
