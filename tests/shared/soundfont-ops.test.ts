import { expect, it } from 'vitest'
import {
  addFont,
  removeFont,
  replaceFont,
} from '../../src/shared/soundfont-ops'
import { liveProject } from '../../src/shared/template'
it('replaces by address then exact or folded preset name and keeps unmatched instruments playable', () => {
  const p = liveProject('Piano', 'Old.sf2'),
    id = p.soundfonts[0].id
  const base = p.instruments[0]
  p.instruments = ['Piano', 'Bass', 'Lead', 'Missing'].map((name, program) => ({
    ...base,
    id: name.toLowerCase(),
    name,
    program,
  }))
  const old = p.instruments.map(({ name, bank, program, isDrum }) => ({
    name,
    bank,
    program,
    isDrum,
  }))
  const presets = [
    { ...old[0], name: 'Grand' },
    { ...old[1], program: 12 },
    { ...old[2], name: 'LEAD', program: 17 },
  ]
  const result = replaceFont(p, id, 'New.sf3', old, presets)
  expect(result.unmatched).toEqual(['Missing'])
  expect(result.project.instruments.map((i) => i.program)).toEqual([
    0, 12, 17, 3,
  ])
  expect(result.project.instruments[3].soundfontId).toBe(id)
  expect(() => removeFont(result.project, id)).toThrow('Missing')
  expect(addFont(p, 'Old.sf2')).toBe(p)
  expect(p.soundfonts).toHaveLength(1)
})
