import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createPracticeProject, keepPracticeProject } from '../../src/main/tutorial-practice'
import { ProjectIO } from '../../src/main/project-io'
import { fromFiles, toFiles } from '../../src/shared/project-files'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'xmxs-tutorial-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('creates a playable practice project without an existing project', async () => {
  const copy = await createPracticeProject(root, null, 'Local.sf2')
  expect(fromFiles(copy.files).soundfonts[0].file).toBe('Local.sf2')
  expect(fromFiles(copy.files).tracks.length).toBeGreaterThan(0)
})

it('isolates edits to unsaved material and media from the original', async () => {
  const original = await new ProjectIO().create(join(root, 'Original'))
  const project = fromFiles(original.files)
  project.name = 'Unsaved name'
  await mkdir(join(original.folder, 'audio'))
  await writeFile(join(original.folder, 'audio', 'song.wav'), 'original bytes')
  const copy = await createPracticeProject(root, {folder: original.folder, files: toFiles(project)})
  expect(fromFiles(copy.files).name).toBe('Unsaved name')
  expect(await readFile(join(copy.folder, 'audio', 'song.wav'), 'utf8')).toBe('original bytes')
  await writeFile(join(copy.folder, 'audio', 'song.wav'), 'replacement')
  expect(await readFile(join(original.folder, 'audio', 'song.wav'), 'utf8')).toBe('original bytes')
  expect(fromFiles((await new ProjectIO().open(original.folder)).files).name).toBe('Original')
})

it('rejects linked assets and removes the incomplete practice copy', async () => {
  const original = await new ProjectIO().create(join(root, 'Original'))
  await symlink(original.folder, join(original.folder, 'scores'))
  await expect(createPracticeProject(root, original)).rejects.toThrow()
  expect(await readdir(join(root, 'tutorial-practice'))).toEqual([])
})

it('keeps practice edits as a separate reopenable project', async () => {
  const practice = await createPracticeProject(root, null)
  const project = fromFiles(practice.files)
  project.name = 'My arrangement'
  const kept = await keepPracticeProject(join(root, 'Arrangement'), {
    folder: practice.folder, files: toFiles(project),
  })
  const reopened = await new ProjectIO().open(kept.folder)
  expect(fromFiles(reopened.files).name).toBe('My arrangement')
  await expect(keepPracticeProject(kept.folder, practice)).rejects.toThrow()
  expect(await readFile(join(kept.folder, 'project.yaml'), 'utf8')).toContain('My arrangement')
})

it('leaves the practice session available after Save As fails', async () => {
  const practice = await createPracticeProject(root, null)
  await symlink(practice.folder, join(practice.folder, 'scores'))
  const destination = join(root, 'Arrangement')
  await expect(keepPracticeProject(destination, practice)).rejects.toThrow()
  expect(await readdir(root)).not.toContain('Arrangement')
  expect(await readdir(practice.folder)).toContain('project.yaml')
})

it('prevents saving a permanent project inside its temporary practice folder', async () => {
  const practice = await createPracticeProject(root, null)
  await expect(keepPracticeProject(join(practice.folder, 'Keep'), practice))
    .rejects.toThrow('outside the practice project')
  expect(await readdir(practice.folder)).not.toContain('Keep')
})
