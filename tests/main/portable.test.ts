import { afterEach, expect, it } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { exportPortable, importPortable } from '../../src/main/portable'
import { findSoundfont } from '../../src/main/soundfonts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

it('restores assets and a library font and rejects a named damaged file before installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xmxs-portable-'))
  roots.push(root)
  const project = join(root, 'project')
  const archive = join(root, 'Song.xmxs.zip')
  const imported = join(root, 'imported')
  const retry = join(root, 'retry')
  for (const dir of [project, imported, retry]) await mkdir(dir)
  await mkdir(join(project, '.xmxs'))
  await writeFile(join(project, '.xmxs', 'cache'), 'private cache')
  await writeFile(join(project, 'project.yaml'), 'name: Song')
  const font = Buffer.alloc(180000, 42)
  await writeFile(join(root, 'Library.sf3'), font)
  await exportPortable(project, archive, ['Library.sf3'], [root], '1.2', [
    'Example',
  ])
  const manifest = await importPortable(archive, imported)
  expect(manifest.requiredPlugins).toEqual(['Example'])
  expect((await readdir(imported)).sort()).toEqual([
    'project.yaml',
    'soundfonts',
  ])
  const restored = await findSoundfont('Library.sf3', [
    join(imported, 'soundfonts'),
  ])
  expect(await readFile(restored!)).toEqual(font)
  const files = unzipSync(await readFile(archive))
  files['soundfonts/Library.sf3'][0] ^= 1
  await writeFile(archive, zipSync(files))
  await expect(importPortable(archive, retry)).rejects.toThrow(
    'soundfonts/Library.sf3',
  )
  expect(await readdir(retry)).toEqual([])
})
