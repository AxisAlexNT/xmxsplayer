import type { Instrument, Orchestra, OrchestraMember, Project } from './model'

export function pickLayers(
  orchestra: Orchestra,
  key: number,
  registers: readonly boolean[],
) {
  const members = orchestra.sections
    .filter((s) => s.register === null || registers[s.register])
    .filter((s) => s.gain !== 0)
    .flatMap((s) => s.members.map((m) => ({ ...m, sectionGain: s.gain ?? 1 })))
    .filter((m) => m.enabled && m.gain > 0)
  const ranked = members
    .filter((m) => key >= m.lo && key <= m.hi)
    .sort((a, b) => {
      const outsideA = key < a.comfortLo || key > a.comfortHi
      const outsideB = key < b.comfortLo || key > b.comfortHi
      return (
        Number(outsideA) - Number(outsideB) ||
        Math.abs(key - (a.comfortLo + a.comfortHi) / 2) -
          Math.abs(key - (b.comfortLo + b.comfortHi) / 2)
      )
    })
  const targets = ranked
    .map((m) => ({
      instrumentId: m.instrumentId,
      key: key + m.octave * 12,
      gain: m.gain,
      balance: m.balance,
      sectionGain: m.sectionGain,
    }))
    .filter((t) => t.key >= 0 && t.key <= 127)
  if (targets.length || orchestra.outOfRange === 'silent')
    return targets.slice(0, orchestra.maxLayers || targets.length)
  const folded = members
    .flatMap((m) => {
      const octaves =
        key < m.lo
          ? Math.ceil((m.lo - key) / 12)
          : Math.floor((m.hi - key) / 12)
      const pitch = key + octaves * 12
      const output = pitch + m.octave * 12
      return pitch >= m.lo && pitch <= m.hi && output >= 0 && output <= 127
        ? [
            {
              instrumentId: m.instrumentId,
              key: output,
              gain: m.gain,
              balance: m.balance,
              sectionGain: m.sectionGain,
              distance: Math.abs(octaves),
            },
          ]
        : []
    })
    .sort((a, b) => a.distance - b.distance)[0]
  return folded
    ? [
        {
          instrumentId: folded.instrumentId,
          key: folded.key,
          gain: folded.gain,
          balance: folded.balance,
          sectionGain: folded.sectionGain,
        },
      ]
    : []
}

export function sharedExternalMembers(instruments: Instrument[]): Set<string> {
  const channels = new Map<string, string[]>()
  for (const instrument of instruments) {
    if (instrument.backend !== 'midi' || !instrument.midiOut) continue
    const { portName, channel } = instrument.midiOut
    const key = JSON.stringify([portName, channel])
    const members = channels.get(key) ?? []
    members.push(instrument.id)
    channels.set(key, members)
  }
  return new Set([...channels.values()].filter((ids) => ids.length > 1).flat())
}

export function layerBalance(
  layer: Pick<OrchestraMember, 'gain' | 'balance' | 'instrumentId'> & {
    sectionGain?: number
  },
  shared: Set<string>,
) {
  const sectionGain = layer.sectionGain ?? 1
  if (shared.has(layer.instrumentId))
    return { velocity: layer.gain * sectionGain, expression: undefined }
  const mode = layer.balance ?? 'volume'
  const level =
    mode === 'both' ? Math.sqrt(layer.gain) : mode === 'volume' ? layer.gain : 1
  // CC11 tops out at unity. Preserve the existing gain range above 100% in velocity.
  const expression = Math.min(1, level)
  return {
    expression: expression * sectionGain,
    velocity: expression > 0 ? layer.gain / expression : 0,
  }
}

export function orchestraSections(project: Project) {
  return (project.orchestras ?? []).flatMap((orchestra) =>
    orchestra.sections.map((section, index) => ({
      id: `section:${orchestra.id}:${index}`,
      orchestra,
      section,
      name: orchestra.name + ' · ' + section.name,
    })),
  )
}
