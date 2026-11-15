import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
  rename,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectIO, atomicWrite, confined } from '../../src/main/project-io'
import { ProjectWatcher } from '../../src/main/watcher'
import { fromFiles, toFiles } from '../../src/shared/project-files'
import type { FileChanges } from '../../src/shared/api'

const folders: string[] = []
const watchers: ProjectWatcher[] = []
afterEach(async () => {
  await Promise.all(watchers.splice(0).map((w) => w.close()))
  await Promise.all(
    folders.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  )
})
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'xmxs-'))
  folders.push(dir)
  return dir
}
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error('Watcher did not deliver changes')
    await new Promise((r) => setTimeout(r, 50))
  }
}
describe('project folder IO', () => {
  it('creates, reopens, saves only changed files and refuses stale saves', async () => {
    const folder = await temp()
    const io = new ProjectIO()
    const snapshot = await io.create(folder)
    expect(await readFile(join(folder, '.xmxs/.gitignore'), 'utf8')).toBe('*\n')
    expect(await readFile(join(folder, 'xm.d.ts'), 'utf8')).toContain(
      'Project script',
    )
    const untouched = (await stat(join(folder, 'setup.yaml'))).mtimeMs
    const project = fromFiles(snapshot.files)
    project.name = 'Updated'
    const hashes = await io.save(toFiles(project), snapshot.hashes)
    expect((await stat(join(folder, 'setup.yaml'))).mtimeMs).toBe(untouched)
    expect(fromFiles((await io.open(folder)).files).name).toBe('Updated')
    await atomicWrite(
      join(folder, 'setup.yaml'),
      String(snapshot.files['setup.yaml']) + '\n# external change\n',
    )
    await expect(io.save(toFiles(project), hashes)).rejects.toThrow(
      /changed on disk/,
    )
  })
  it('delivers an external revert back to the originally loaded bytes', async () => {
    const folder = await temp()
    const io = new ProjectIO()
    const snapshot = await io.create(folder)
    const watcher = new ProjectWatcher()
    watchers.push(watcher)
    const changes: FileChanges[] = []
    await watcher.start(io, (change) => changes.push(change))
    const original = snapshot.files['setup.yaml']
    await atomicWrite(
      join(folder, 'setup.yaml'),
      String(original) + '\n# Changed\n',
    )
    await until(() => changes.length === 1)
    await atomicWrite(join(folder, 'setup.yaml'), original)
    await until(() => changes.length === 2)
    expect(changes[1].files['setup.yaml']).toBe(original)
  })
  it('copies imports without overwriting originals or existing imports', async () => {
    const folder = await temp()
    const io = new ProjectIO()
    await io.create(folder)
    const source = join(await temp(), 'take.wav')
    await writeFile(source, 'sound')
    expect(await io.importFile('audio', source)).toBe('audio/take.wav')
    expect(await io.importFile('audio', source)).toBe('audio/take-2.wav')
    expect(await readFile(source, 'utf8')).toBe('sound')
  })
  it('rejects traversal and escaped symlinks', async () => {
    const folder = await temp()
    const outside = await temp()
    await symlink(outside, join(folder, 'audio'))
    await expect(confined(folder, '../private')).rejects.toThrow()
    await expect(confined(folder, 'audio/private.wav')).rejects.toThrow(
      /Symlink/,
    )
  })
  it('delivers external atomic replacements, ignores cache and its own saves', async () => {
    const folder = await temp()
    const io = new ProjectIO()
    const snapshot = await io.create(folder)
    const watcher = new ProjectWatcher()
    watchers.push(watcher)
    const changes: FileChanges[] = []
    await watcher.start(io, (c) => changes.push(c))
    const project = fromFiles(snapshot.files)
    project.registers[0].name = 'External'
    await atomicWrite(
      join(folder, 'setup.yaml'),
      toFiles(project)['setup.yaml'],
    )
    await until(() => changes.length > 0)
    expect(String(changes[0].files['setup.yaml'])).toContain('External')
    const current = await io.open(folder)
    await watcher.start(io, (c) => changes.push(c))
    changes.length = 0
    const next = fromFiles(current.files)
    next.name = 'Saved'
    await io.save(toFiles(next), current.hashes)
    await writeFile(join(folder, '.xmxs/test'), 'cache')
    await new Promise((r) => setTimeout(r, 800))
    expect(changes).toEqual([])
    const tempFile = join(folder, 'setup.tmp')
    await writeFile(
      tempFile,
      String(toFiles(next)['setup.yaml']) + '\n# editor save\n',
    )
    await rename(tempFile, join(folder, 'setup.yaml'))
    await until(() => changes.length > 0)
    expect(changes[0].hashes['setup.yaml']).not.toBe(
      current.hashes['setup.yaml'],
    )
  })
})
