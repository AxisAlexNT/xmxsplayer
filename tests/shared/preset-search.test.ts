import { expect, it } from 'vitest'
import { favouriteKey, searchPresets } from '../../src/shared/preset-search'
import type { SoundFontIndexEntry } from '../../src/shared/api'
it('groups results by soundfont and keeps favourites distinct at the same bank and program', () => {
  const preset = { bank: 0, program: 48, name: 'Strings', isDrum: false }
  const index: SoundFontIndexEntry[] = ['One.sf2', 'Two.sf3'].map((file) => ({
    file,
    path: file,
    kind: 'GM',
    bytes: 1,
    gm: true,
    mtime: 0,
    presets: [preset],
  }))
  const opts = {
    file: '',
    library: false,
    query: 'STR',
    family: 'Ensemble',
    onlyFavourites: false,
    favourites: new Set([favouriteKey('Two.sf3', preset)]),
  }
  const project = new Set(['One.sf2'])
  expect(searchPresets(index, project, opts).map((g) => g.file)).toEqual([
    'One.sf2',
  ])
  expect(
    searchPresets(index, project, { ...opts, library: true }),
  ).toHaveLength(2)
  expect(
    searchPresets(index, project, {
      ...opts,
      library: true,
      onlyFavourites: true,
    }).map((g) => g.file),
  ).toEqual(['Two.sf3'])
})
