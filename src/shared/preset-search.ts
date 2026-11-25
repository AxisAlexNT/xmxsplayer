import type { SoundFontIndexEntry } from './api'
import type { FluidPreset } from './fluid'

export const gmFamilies = [
  'Piano',
  'Chromatic percussion',
  'Organ',
  'Guitar',
  'Bass',
  'Strings',
  'Ensemble',
  'Brass',
  'Reed',
  'Pipe',
  'Synth lead',
  'Synth pad',
  'Synth effects',
  'Ethnic',
  'Percussive',
  'Sound effects',
] as const

export function favouriteKey(file: string, preset: FluidPreset): string {
  return JSON.stringify([file, preset.bank, preset.program])
}
export function searchPresets(
  index: SoundFontIndexEntry[],
  projectFiles: Set<string>,
  options: {
    file: string
    library: boolean
    query: string
    family: string
    onlyFavourites: boolean
    favourites: ReadonlySet<string>
  },
) {
  const query = options.query.trim().toLowerCase()
  return index.flatMap((entry) => {
    if (
      (options.file && entry.file !== options.file) ||
      (!options.library && !projectFiles.has(entry.file))
    )
      return []
    const presets = entry.presets.filter(
      (p) =>
        (!options.family ||
          (p.isDrum ? 'Drums' : gmFamilies[Math.floor(p.program / 8)]) ===
            options.family) &&
        (!options.onlyFavourites ||
          options.favourites.has(favouriteKey(entry.file, p))) &&
        (!query ||
          `${entry.file} ${p.name} ${p.bank}:${p.program}`
            .toLowerCase()
            .includes(query)),
    )
    return presets.length ? [{ file: entry.file, presets }] : []
  })
}
