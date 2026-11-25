import { orchestraSections } from '../../shared/orchestra'
import type { Action, Project } from '../../shared/model'
export const sentence = (text: string): string =>
  text
    .replace(/([A-Z])/g, ' $1')
    .replaceAll('.', ' ')
    .toLowerCase()
    .replace(/^./, (s) => s.toUpperCase())
export function actionLabel(
  action: Action,
  project: Project,
  control = '',
): string {
  switch (action.type) {
    case 'orchestra':
      return (
        project.orchestras?.find((o) => o.id === action.orchestraId)?.name ??
        'Orchestra ' + action.cmd
      )
    case 'param': {
      const names = {
        rate: 'Speed',
        masterVolume: 'Master',
        'track.volume': 'Volume',
        'section.gain': 'Section level',
        'effect.param': action.param ?? 'Effect',
        'track.pan': 'Pan',
        'instrument.pluginParam': project.instruments.find(i => i.id === action.id)?.plugin?.parameters?.find(p => String(p.index) === action.param)?.name ?? 'Plugin parameter',
        'instrument.cc': `MIDI CC ${action.cc ?? ''}`,
        'instrument.volume': 'Volume',
        'instrument.reverb': 'Reverb',
        'instrument.chorus': 'Chorus',
        'audio.semitones': 'Pitch',
        'audio.filterFreq': 'Filter',
      }
      const fader = /^fader\.(\d+)$/.exec(control),
        name =
          (action.target === 'section.gain' ? orchestraSections(project).find(s => s.id === action.id)?.name : undefined) ??
          project.tracks.find((t) => t.id === action.id)?.name ??
          project.instruments.find((i) => i.id === action.id)?.name ??
          (fader && action.target.startsWith('track.')
            ? project.tracks[Number(fader[1]) - 1]?.name
            : undefined)
      return name ? `${name} · ${names[action.target]}` : names[action.target]
    }
    case 'note':
      return `Note ${action.key} → ${project.tracks.find((t) => t.id === action.trackId)?.name ?? action.trackId}`
    case 'register':
      return `${sentence(action.cmd)} R${action.index + 1}`
    case 'trackMode':
      return `${project.tracks.find((t) => t.id === action.trackId)?.name ?? action.trackId} · ${sentence(action.mode)}`
    case 'scene':
      return `Scene: ${project.scenes.find((s) => s.id === action.sceneId)?.name ?? sentence(action.cmd)}`
    case 'cue':
      return `Cue: ${project.cues.find((c) => c.id === action.cueId)?.name ?? sentence(action.cmd)}`
    case 'clip':
      return `${sentence(action.cmd)}: ${project.clips.find((c) => c.id === action.clipId)?.name ?? action.group ?? 'clips'}`
    case 'follow':
      return `Follow: ${sentence(action.mode)}`
    case 'script':
      return action.fn + '()'
    case 'app':
      return sentence(action.cmd)
    case 'transport':
      return action.cmd === 'toggle' ? 'Play / pause' : sentence(action.cmd)
  }
}
export const palette = [
  '#4cc2ff',
  '#7c8cff',
  '#b07cff',
  '#ff7ac8',
  '#ff6b6b',
  '#ff9f43',
  '#ffd43b',
  '#a3e635',
  '#3ddc97',
  '#2dd4bf',
  '#38bdf8',
  '#94a3b8',
]
