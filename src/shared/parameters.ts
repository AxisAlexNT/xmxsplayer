import { editTempo } from './bar-edit'
import { TimeMap } from './time-map'
import type { TempoMode } from './model'
import { orchestraSections } from './orchestra'
import { effectParameterPatch, findEffect } from './effect-targets'
import { orchestraDefaults, unsupportedMembers } from './orchestra-controls'
import type { Action, Project, OrchestraControl } from './model'
export type ParamAction = Extract<Action, { type: 'param' }>
export function parameterValue(
  project: Project,
  action: ParamAction,
  tick = 0,
): number | undefined {
  const track = project.tracks.find((t) => t.id === action.id),
    instrument = project.instruments.find((i) => i.id === action.id)
  if (action.target.startsWith('orchestra.')) {
    const o = project.orchestras?.find(o => o.id === action.id)
    const key = action.target.slice(10) as OrchestraControl
    return o && !unsupportedMembers(project,o,key).length ? o.fx?.[key] ?? orchestraDefaults[key] : undefined
  }
  switch (action.target) {
    case 'tempo':
      return project.mapOwner === null && !project.beatAnchors.length ? new TimeMap(project).tempoAt(tick) : undefined
    case 'member.gain':
      return orchestraSections(project).find(s => s.id === action.id)?.section.members.find(m => m.instrumentId === action.param)?.gain
    case 'section.gain': {
      const target = orchestraSections(project).find(s => s.id === action.id)
      return target ? target.section.gain ?? 1 : undefined
    }
    case 'effect.param':
      return action.param
        ? findEffect(project, action.id, action.effectId)?.effect.params[
            action.param
          ]
        : undefined
    case 'track.volume':
      return track?.volume
    case 'track.pan':
      return track?.pan
    case 'instrument.pluginParam': {
      const control = instrument?.plugin?.parameters?.find(p => p.input && String(p.index) === action.param)
      return instrument?.backend === 'plugin' && control
        ? instrument.pluginParams?.[control.index] ?? control.initial : undefined
    }
    case 'instrument.cc':
      return instrument && action.cc !== undefined && instrument.backend !== 'plugin'
        ? instrument.initCc?.[action.cc] ?? 0 : undefined
    case 'instrument.volume':
      return instrument?.volume
    case 'instrument.reverb':
      return instrument?.reverb
    case 'instrument.chorus':
      return instrument?.chorus
    case 'audio.semitones':
      return track?.kind === 'audio' ? track.semitones : undefined
    case 'audio.filterFreq':
      return track?.kind === 'audio' ? track.filter.freq : undefined
  }
}
export function parameterPatch(
  project: Project,
  action: ParamAction,
  value: number,
  tick = 0, mode: TempoMode = 'scale',
): Partial<Project> | undefined {
  const unit = Math.max(0, Math.min(1, value)),
    raw = action.min + (action.max - action.min) * unit,
    clamped = (min: number, max: number) => Math.max(min, Math.min(max, raw))
  if (action.target.startsWith('orchestra.')) {
    if (parameterValue(project,action) === undefined) return
    const key = action.target.slice(10)
    return {orchestras:project.orchestras?.map(o => o.id === action.id ? {...o,fx:{...o.fx,[key]:clamped(0,1)}} : o)}
  }
  if (action.target === 'tempo') {
    if (project.mapOwner !== null || project.beatAnchors.length) return
    return { tempos: editTempo(project,tick,clamped(20,400),mode).tempos }
  }
  if (action.target === 'member.gain') {
    const target = orchestraSections(project).find(s => s.id === action.id)
    if (!target || !target.section.members.some(m=>m.instrumentId===action.param)) return
    return {orchestras:project.orchestras?.map(o => o!==target.orchestra ? o : {...o, sections:o.sections.map(s =>
      s!==target.section ? s : {...s,members:s.members.map(m=>m.instrumentId===action.param?{...m,gain:clamped(0,2)}:m)})})}
  }
  if (action.target === 'section.gain') {
    const target = orchestraSections(project).find(s => s.id === action.id)
    if (!target) return
    return { orchestras: project.orchestras?.map(o => o === target.orchestra ? {
      ...o, sections: o.sections.map(s => s === target.section ? {...s, gain: clamped(0, 1)} : s),
    } : o) }
  }
  if (action.target === 'effect.param')
    return effectParameterPatch(
      project,
      action.id,
      action.effectId,
      action.param,
      raw,
    )
  if (
    action.target.startsWith('track.') ||
    action.target.startsWith('audio.')
  ) {
    const track = project.tracks.find((t) => t.id === action.id)
    if (!track) return
    const next =
      action.target === 'track.volume'
        ? { ...track, volume: clamped(0, 1) }
        : action.target === 'track.pan'
          ? { ...track, pan: clamped(-1, 1) }
          : track.kind !== 'audio'
            ? undefined
            : action.target === 'audio.semitones'
              ? { ...track, semitones: clamped(-48, 48) }
              : {
                  ...track,
                  filter: { ...track.filter, freq: clamped(20, 20000) },
                }
    return next
      ? { tracks: project.tracks.map((t) => (t.id === track.id ? next : t)) }
      : undefined
  }
  if (action.target.startsWith('instrument.')) {
    const instrument = project.instruments.find((i) => i.id === action.id)
    if (!instrument) return
    if (action.target === 'instrument.pluginParam') {
      const control = instrument.plugin?.parameters?.find(p => p.input && String(p.index) === action.param)
      if (instrument.backend !== 'plugin' || !control) return
      const pluginParams = { ...instrument.pluginParams, [control.index]: clamped(control.min, control.max) }
      return { instruments: project.instruments.map(i => i.id === instrument.id ? { ...i, pluginParams } : i) }
    }
    if (action.target === 'instrument.cc') {
      if (action.cc === undefined || instrument.backend === 'plugin') return
      const initCc = { ...instrument.initCc, [action.cc]: Math.round(clamped(0, 127)) }
      return { instruments: project.instruments.map(i => i.id === instrument.id ? { ...i, initCc } : i) }
    }
    const property = action.target.slice(11) as 'volume' | 'reverb' | 'chorus'
    return {
      instruments: project.instruments.map((i) =>
        i.id === instrument.id ? { ...i, [property]: clamped(0, 1) } : i,
      ),
    }
  }
}
