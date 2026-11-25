import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { ProjectSnapshot } from '../shared/api'
import { fromFiles } from '../shared/project-files'
import { liveProject } from '../shared/template'
import { ProjectIO } from './project-io'

async function copyAssets(source: string, target: string): Promise<void> {
  const entry = await lstat(source)
  if (entry.isFile()) {
    await copyFile(source, target, constants.COPYFILE_EXCL)
    return
  }
  if (!entry.isDirectory()) throw new Error('Cannot copy linked or special project assets')
  await mkdir(target)
  for (const name of await readdir(source))
    await copyAssets(join(source, name), join(target, name))
}

type ProjectSource = Pick<ProjectSnapshot, 'folder' | 'files'>

async function populatePracticeFolder(
  folder: string,
  source: ProjectSource | null,
  defaultFont?: string,
): Promise<ProjectSnapshot> {
  const project = source ? fromFiles(source.files) : liveProject('Tutorial practice', defaultFont)
  const snapshot = await new ProjectIO().create(folder, project)
  if (source) {
    const names = await readdir(source.folder)
    for (const name of ['audio', 'scores', 'soundfonts', 'plugins'])
      if (names.includes(name)) {
        const asset = join(source.folder, name)
        if ((await realpath(folder)).startsWith((await realpath(asset)) + sep))
          throw new Error('Practice folder is inside project assets')
        await copyAssets(asset, join(folder, name))
      }
  }
  return snapshot
}

/** Build a separately editable snapshot, including any unsaved project edits. */
export async function createPracticeProject(
  userData: string,
  source: ProjectSource | null,
  defaultFont?: string,
): Promise<ProjectSnapshot> {
  const root = join(userData, 'tutorial-practice')
  await mkdir(root, { recursive: true })
  const folder = await mkdtemp(join(root, Date.now() + '-'))
  try {
    return await populatePracticeFolder(folder, source, defaultFont)
  } catch (error) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
}

/** Save As reserves a new folder so an existing project can never be overwritten. */
export async function keepPracticeProject(
  destination: string,
  source: ProjectSource,
): Promise<ProjectSnapshot> {
  const parent = await realpath(dirname(destination))
  const target = join(parent, basename(destination))
  const practice = await realpath(source.folder)
  if (target === practice || target.startsWith(practice + sep))
    throw new Error('Choose a folder outside the practice project')
  await mkdir(destination)
  try {
    return await populatePracticeFolder(destination, source)
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
