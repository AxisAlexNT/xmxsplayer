import type { Orchestra } from './model'

export function pickLayers(
  orchestra: Orchestra,
  key: number,
  registers: readonly boolean[],
) {
  const members = orchestra.sections
    .filter((s) => s.register === null || registers[s.register])
    .flatMap((s) => s.members)
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
        },
      ]
    : []
}
