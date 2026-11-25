import type { Instrument, Orchestra, OrchestraControl, Project } from './model'

export const orchestraDefaults = {
  volume: 1,
  reverb: 0.2,
  chorus: 0,
  brightness: 64 / 127,
}
export const orchestraControls = Object.keys(
  orchestraDefaults,
) as OrchestraControl[]
const pluginNames = {
  volume: /^(?:master |output |main )?(?:volume|gain|level)$/i,
  reverb: /^(?:hall )?reverb(?: (?:mix|amount|level|send))?$/i,
  chorus: /^chorus(?: (?:mix|amount|level|send))?$/i,
  brightness: /^(?:brightness|(?:filter )?(?:cutoff|cut.off)(?: frequency)?)$/i,
}
function pluginControl(instrument: Instrument, key: OrchestraControl) {
  return instrument.plugin?.parameters?.find(
    (p) => p.input && pluginNames[key].test(p.name.trim()),
  )
}
export function unsupportedMembers(
  project: Project,
  orchestra: Orchestra,
  key: OrchestraControl,
) {
  const members = new Set(
    orchestra.sections.flatMap((s) => s.members.map((m) => m.instrumentId)),
  )
  return project.instruments.filter(
    (i) =>
      members.has(i.id) && i.backend === 'plugin' && !pluginControl(i, key),
  )
}

export function applyOrchestraControls(
  project: Project,
  selected: Record<string, string> = {},
): Project {
  if (!project.orchestras?.some((o) => o.fx)) return project
  const active = new Set(
    project.tracks.flatMap((t) =>
      t.kind === 'midi' && t.orchestraId
        ? [selected[t.id] ?? t.orchestraId]
        : [],
    ),
  )
  const byInstrument = new Map<string, Orchestra>()
  for (const o of project.orchestras) {
    for (const section of o.sections)
      for (const member of section.members) {
        if (active.has(o.id) || !byInstrument.has(member.instrumentId))
          byInstrument.set(member.instrumentId, o)
      }
  }
  return {
    ...project,
    instruments: project.instruments.map((instrument) => {
      const fx = byInstrument.get(instrument.id)?.fx
      if (!fx) return instrument
      const result = { ...instrument }
      for (const key of orchestraControls) {
        const value = fx[key]
        if (value === undefined) continue
        if (instrument.backend === 'plugin') {
          const control = pluginControl(instrument, key)
          if (control)
            result.pluginParams = {
              ...result.pluginParams,
              [control.index]:
                control.min + value * (control.max - control.min),
            }
        } else if (key === 'brightness') {
          result.initCc = { ...result.initCc, 74: Math.round(value * 127) }
        } else {
          result[key] = value
          const cc = { volume: 7, reverb: 91, chorus: 93 }[key]
          if (result.initCc?.[cc] !== undefined) {
            result.initCc = { ...result.initCc }
            delete result.initCc[cc]
          }
        }
      }
      return result
    }),
  }
}
