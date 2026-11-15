import type { AudioTrack, Clip, ControlDef, Project } from '../../shared/model'
import { uniqueId } from '../../shared/ids'
import { TimeMap } from '../../shared/time-map'
import { effectiveSetup, isUnbound, unbound } from '../../shared/overlay'
import { sentence } from '../bindings/labels'
import { writeBinding, type BindingScope } from '../bindings/edit'
export const CLIP_DRAG_TYPE = 'application/x-xmxs-clip'
export function newClip(
  project: Project,
  file: string,
  duration: number,
): Clip {
  const name = file
      .split('/')
      .at(-1)!
      .replace(/\.[^.]+$/, ''),
    map = new TimeMap(project)
  return {
    id: uniqueId(
      name,
      project.clips.map((c) => c.id),
    ),
    name,
    color: '#ff9f43',
    file,
    startSec: 0,
    endSec: duration,
    loop: true,
    sync: false,
    beats: Math.max(
      0.25,
      Math.round(((duration * map.tempoAt(0)) / 60) * 4) / 4,
    ),
    launch: 'toggle',
    quantize: 'now',
    gain: 0.8,
    pan: 0,
    toCue: false,
    pressureToGain: false,
    semitones: 0,
    pitchMode: 'keepTempo',
    fadeMs: 10,
    sweep: { mode: 'moving', range: [-12, 12], releaseMs: 300, offBelow: 0.02 },
  }
}
export function clipFromLoop(project: Project, track: AudioTrack): Clip {
  const map = new TimeMap(project),
    start = map.tickToSec(project.loop.startTick) - track.offsetSec,
    end = map.tickToSec(project.loop.endTick) - track.offsetSec
  if (!project.loop.enabled || end <= 0 || start >= track.durationSec)
    throw Error('The loop range does not overlap the selected audio track')
  const clip = newClip(project, track.file, track.durationSec)
  clip.startSec = Math.max(0, start)
  clip.endSec = Math.min(track.durationSec, end)
  clip.name = `${track.name} loop`
  clip.id = uniqueId(
    clip.name,
    project.clips.map((c) => c.id),
  )
  clip.sync = true
  clip.quantize = 'bar'
  clip.beats = Math.max(
    1 / 480,
    (map.secToTick(clip.endSec + track.offsetSec) -
      map.secToTick(clip.startSec + track.offsetSec)) /
      480,
  )
  return clip
}
export function snapClipBar(
  project: Project,
  file: string,
  seconds: number,
): number | null {
  const track = project.tracks.find(
    (t): t is AudioTrack => t.kind === 'audio' && t.file === file,
  )
  if (!track || project.beatAnchors.length < 2) return null
  const map = new TimeMap(project),
    tick = map.secToTick(seconds + track.offsetSec),
    bar = map.tickToBarBeat(tick).bar
  const left = map.tickToSec(map.barToTick(bar)) - track.offsetSec,
    right = map.tickToSec(map.barToTick(bar + 1)) - track.offsetSec
  return Math.abs(seconds - left) <= Math.abs(seconds - right) ? left : right
}
export function clipBindings(
  project: Project,
  clipId: string,
  sceneId: string | null,
  profiles: string[],
): string[] {
  const result = new Set<string>()
  for (const profile of profiles.length ? profiles : [''])
    for (const binding of effectiveSetup(
      project,
      sceneId,
      profile ? [profile] : [],
    ).bindings)
      if (
        !isUnbound(binding) &&
        binding.action.type === 'clip' &&
        binding.action.clipId === clipId
      )
        result.add(`${sentence(binding.control)} (${binding.action.cmd})`)
  return [...result]
}
export function bindClip(
  project: Project,
  scope: BindingScope,
  clipId: string,
  control: ControlDef,
): void {
  if (!project.clips.some((clip) => clip.id === clipId))
    throw Error('The dragged clip no longer exists')
  writeBinding(project, scope, {
    control: control.id,
    edge: control.mode === 'momentary' ? 'press' : 'change',
    action: {
      type: 'clip',
      cmd: control.mode === 'momentary' ? 'launch' : 'sweep',
      clipId,
    },
  })
}
export function deleteClip(project: Project, clipId: string): void {
  project.clips = project.clips.filter((clip) => clip.id !== clipId)
  const layers = [
    project.base,
    ...project.scenes,
    ...Object.values(project.mappings).flatMap((mapping) => [
      mapping,
      ...Object.values(mapping.scenes),
    ]),
  ]
  for (const layer of layers)
    if (layer.bindings)
      layer.bindings = layer.bindings.map((binding) =>
        binding.action.type === 'clip' && binding.action.clipId === clipId
          ? unbound(binding.control, binding.edge)
          : binding,
      )
  for (const cue of project.cues)
    cue.actions = cue.actions.filter(
      (action) => action.type !== 'clip' || action.clipId !== clipId,
    )
}
