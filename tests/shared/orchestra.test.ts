import { expect, it } from 'vitest'
import { addPreset, presets } from '../../src/shared/orchestra-presets'
import { pickLayers } from '../../src/shared/orchestra'
import { newProject } from '../../src/shared/defaults'
import { toFiles, fromFiles } from '../../src/shared/project-files'
it('saves all presets and reloads member ranges and the orchestra track', () => {
  const p = newProject()
  for (const id of Object.keys(presets)) addPreset(p, id, 'gm')
  expect(p.tracks).toHaveLength(1)
  const files = toFiles(p)
  expect(files['orchestras.yaml']).toBeTruthy()
  expect(fromFiles(files).orchestras).toEqual(p.orchestras)
})
it('ranks by comfort, limits layers, gates sections and folds by octaves', () => {
  const p = newProject()
  addPreset(p, 'symphonic', 'gm')
  const o = p.orchestras![0],
    regs = [true, true, true, true]
  expect(pickLayers(o, 60, regs)).toHaveLength(3)
  expect(pickLayers(o, 60, [])).toEqual([])
  o.maxLayers = 0
  expect(pickLayers(o, 60, regs).length).toBeGreaterThan(3)
  expect(pickLayers(o, 10, regs)).toEqual([])
  o.outOfRange = 'nearest'
  const [folded] = pickLayers(o, 10, regs)
  expect(folded.key % 12).toBe(10)
  expect(folded.key).toBeGreaterThanOrEqual(24)
})
