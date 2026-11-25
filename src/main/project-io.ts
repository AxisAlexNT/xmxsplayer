import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { FileMap, ProjectSnapshot } from '../shared/api'
import { scriptDeclarations } from '../shared/script-declarations'
import type { Project } from '../shared/model'
import { newProject } from '../shared/defaults'
import { fromFiles, toFiles } from '../shared/project-files'

export const documentPath = (path: string): boolean =>
  /^(project|setup|bindings|clips|orchestras)\.yaml$|^script\.ts$|^mappings\/[a-z0-9]+(?:-[a-z0-9]+)*\.yaml$|^tracks\/[a-z0-9]+(?:-[a-z0-9]+)*\.mid$/.test(
    path,
  )
export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
export async function confined(root: string, path: string): Promise<string> {
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((s) => s === '..' || s === '.') ||
    path.includes('\0')
  )
    throw new Error('Invalid relative path')
  const file = resolve(root, path)
  const within = (candidate: string): boolean => {
    const rel = relative(root, candidate)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }
  if (!within(file)) throw new Error('Path escapes project folder')
  let ancestor = file
  for (;;) {
    try {
      if (!within(await realpath(ancestor)))
        throw new Error('Symlink escapes project folder')
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ancestor = dirname(ancestor)
    }
  }
  return file
}
export async function atomicWrite(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, content)
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}
export class ProjectIO {
  folder = ''
  hashes: Record<string, string> = {}
  async readDocument(path: string): Promise<string | Uint8Array | null> {
    const file = await confined(this.folder, path)
    try {
      const bytes = await readFile(file)
      return path.endsWith('.mid')
        ? new Uint8Array(bytes)
        : bytes.toString('utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  async readAll(): Promise<FileMap> {
    const files: FileMap = {}
    for (const dir of ['', 'mappings', 'tracks']) {
      let names: string[]
      try {
        names = await readdir(await confined(this.folder, dir))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
      for (const name of names) {
        const path = dir ? `${dir}/${name}` : name
        if (!documentPath(path)) continue
        const content = await this.readDocument(path)
        if (content !== null) files[path] = content
      }
    }
    return files
  }
  private async supportFiles(): Promise<void> {
    await atomicWrite(await confined(this.folder, '.xmxs/.gitignore'), '*\n')
    await atomicWrite(
      await confined(this.folder, 'xm.d.ts'),
      scriptDeclarations,
    )
  }
  async open(folder: string): Promise<ProjectSnapshot> {
    const canonical = await realpath(folder)
    const previous = this.folder
    this.folder = canonical
    try {
      const files = await this.readAll()
      fromFiles(files)
      await this.supportFiles()
      this.hashes = Object.fromEntries(
        Object.entries(files).map(([p, v]) => [p, hash(v)]),
      )
      return { folder: this.folder, files, hashes: { ...this.hashes } }
    } catch (error) {
      this.folder = previous
      throw error
    }
  }
  async create(folder: string, project?: Project): Promise<ProjectSnapshot> {
    await mkdir(folder, { recursive: true })
    if ((await readdir(folder)).length)
      throw new Error('Choose an empty folder for the new project')
    this.folder = await realpath(folder)
    await this.save(toFiles(project ?? newProject(basename(folder))), {})
    return this.open(folder)
  }
  async save(
    files: FileMap,
    expected: Record<string, string>,
  ): Promise<Record<string, string>> {
    if (!this.folder) throw new Error('Open a project first')
    fromFiles(files)
    const old = await this.readAll()
    const changed = new Set([...Object.keys(files), ...Object.keys(old)])
    for (const path of changed) {
      if (!documentPath(path))
        throw new Error(`Unsupported project file: ${path}`)
      const actual = old[path] === undefined ? '' : hash(old[path])
      if (
        actual !== (expected[path] ?? '') &&
        !(files[path] !== undefined && hash(files[path]) === actual)
      )
        throw new Error(
          `${path} changed on disk. Resolve the file conflict before saving.`,
        )
    }
    for (const path of changed) {
      const file = await confined(this.folder, path)
      if (files[path] === undefined) await rm(file, { force: true })
      else if (old[path] === undefined || hash(old[path]) !== hash(files[path]))
        await atomicWrite(file, files[path])
    }
    this.hashes = Object.fromEntries(
      Object.entries(files).map(([p, v]) => [p, hash(v)]),
    )
    return { ...this.hashes }
  }
  async importFile(
    kind: 'audio' | 'score' | 'midi' | 'soundfont',
    source: string,
  ): Promise<string> {
    if (!this.folder) throw new Error('Open a project first')
    if (!(await stat(source)).isFile()) throw new Error('Select a file')
    if (kind === 'score') {
      const canonical = await realpath(source),
        rel = relative(this.folder, canonical).split('\\').join('/')
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        await confined(this.folder, rel)
        return rel
      }
    }
    if (kind === 'soundfont' && !/\.sf[23]$/i.test(source)) throw Error('Select an SF2 or SF3 soundfont')
    const dir = kind === 'soundfont' ? 'soundfonts' : kind === 'audio' ? 'audio' : 'scores'
    const name = basename(source)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let n = 1; ; n++) {
      const path = `${dir}/${stem}${n === 1 ? '' : `-${n}`}${ext}`
      const target = await confined(this.folder, path)
      await mkdir(dirname(target), { recursive: true })
      try {
        await copyFile(source, target, 1)
        return path
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }
}
