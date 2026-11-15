import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  findSoundfont,
  gmBank,
  scanSoundfonts,
} from '../../src/main/soundfonts'
import { liveProject } from '../../src/shared/template'
import { projectSchema } from '../../src/shared/schema'
const folders: string[] = []
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  )
})
function font(programCount: number): Buffer {
  const presets = Buffer.alloc((programCount + 1) * 38)
  for (let i = 0; i < programCount; i++) {
    presets.write(`Preset ${i}`, i * 38)
    presets.writeUInt16LE(i, i * 38 + 20)
  }
  const chunk = Buffer.alloc(8 + presets.length)
  chunk.write('phdr')
  chunk.writeUInt32LE(presets.length, 4)
  presets.copy(chunk, 8)
  const result = Buffer.alloc(24 + chunk.length)
  result.write('RIFF')
  result.writeUInt32LE(result.length - 8, 4)
  result.write('sfbkLIST', 8)
  result.writeUInt32LE(chunk.length + 4, 16)
  result.write('pdta', 20)
  chunk.copy(result, 24)
  return result
}
it('detects a complete GM bank from headers, scans safely and rejects traversal', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'xmxs-font-'))
  folders.push(folder)
  const gm = join(folder, 'GM.sf2')
  await writeFile(gm, font(128))
  const kit = join(folder, 'Kit.sf3')
  await writeFile(kit, font(8))
  expect(await gmBank(gm)).toBe(true)
  expect(await gmBank(kit)).toBe(false)
  expect(
    (await scanSoundfonts([join(folder, 'missing'), folder])).map((f) => [
      f.file,
      f.gm,
    ]),
  ).toEqual([
    ['GM.sf2', true],
    ['Kit.sf3', false],
  ])
  expect(await findSoundfont('GM.sf2', [folder])).toBe(gm)
  await expect(findSoundfont('../private.sf2', [folder])).rejects.toThrow(
    'file name',
  )
})
it('creates a validated piano, MIDI track, zone and patch template', () => {
  const project = projectSchema.parse(liveProject('New song', 'GM.sf2'))
  expect(project.soundfonts[0].file).toBe('GM.sf2')
  expect(project.tracks).toHaveLength(1)
  expect(project.base.zones[0]).toMatchObject({
    lo: 0,
    hi: 127,
    trackIds: ['piano'],
  })
  expect(project.base.patch[0]).toMatchObject({
    trackId: 'piano',
    instrumentId: 'piano',
  })
})
