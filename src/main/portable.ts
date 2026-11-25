import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  createReadStream,
  mkdirSync,
  openSync,
  writeSync,
} from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strToU8,
} from 'fflate'
import { findSoundfont } from './soundfonts'

const zip32Limit = 0xffffffff
interface PortableEntry {
  path: string
  size: number
  sha256: string
}
interface PortableManifest {
  appVersion: string
  requiredPlugins: string[]
  files: PortableEntry[]
}

function checkSize(size: number, path: string): void {
  if (size >= zip32Limit)
    throw new Error(`Portable archive exceeds the 4 GB ZIP limit at ${path}`)
}

export async function exportPortable(
  folder: string,
  destination: string,
  fontNames: string[],
  fontDirs: string[],
  appVersion: string,
  requiredPlugins: string[] = [],
): Promise<void> {
  const sources = new Map<string, string>()
  async function collect(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + entry.name
      const source = join(dir, entry.name)
      if (path === '.xmxs' || path === '.git') continue
      if (resolve(source) === resolve(destination))
        throw new Error(
          'Choose a destination outside the existing project files',
        )
      validatePath(path)
      if (path.toLowerCase() === 'manifest.json')
        throw new Error('Project contains reserved manifest.json')
      if (entry.isDirectory()) await collect(source, path + '/')
      else if (entry.isFile()) sources.set(path, source)
      else
        throw new Error(
          `Cannot include linked or special project file: ${path}`,
        )
    }
  }
  await collect(folder, '')
  for (const name of fontNames) {
    const source = await findSoundfont(name, [
      join(folder, 'soundfonts'),
      ...fontDirs,
    ])
    if (!source) throw new Error(`Missing soundfont: ${name}`)
    sources.set('soundfonts/' + name, source)
  }
  if (sources.size + 1 >= 0xffff)
    throw new Error('Too many files for a portable ZIP')
  const temp = join(dirname(destination), '.' + randomUUID() + '.tmp')
  const output = await open(temp, 'wx')
  const manifest: PortableManifest = { appVersion, requiredPlugins, files: [] }
  let current = ''
  let written = 0
  let inputSize = 0
  try {
    const zip = new Zip((err, data) => {
      if (err) throw err
      written += data.length
      checkSize(written, current)
      let offset = 0
      while (offset < data.length)
        offset += writeSync(output.fd, data, offset, data.length - offset)
    })
    for (const [path, source] of sources) {
      current = path
      checkSize(inputSize + (await stat(source)).size, path)
      const stream = /\.(sf3|mp3|ogg|flac|m4a|zip)$/i.test(path)
        ? new ZipPassThrough(path)
        : new ZipDeflate(path, { level: 6 })
      zip.add(stream)
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of createReadStream(source)) {
        size += chunk.length
        inputSize += chunk.length
        checkSize(inputSize, path)
        hash.update(chunk)
        stream.push(chunk)
      }
      stream.push(new Uint8Array(), true)
      manifest.files.push({ path, size, sha256: hash.digest('hex') })
    }
    current = 'manifest.json'
    const bytes = strToU8(JSON.stringify(manifest))
    checkSize(inputSize + bytes.length, current)
    const entry = new ZipDeflate(current, { level: 6 })
    zip.add(entry)
    entry.push(bytes, true)
    zip.end()
    await output.close()
    await rename(temp, destination)
  } finally {
    await output.close()
    await rm(temp, { force: true })
  }
}

function validatePath(path: string): void {
  if (
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          /[. ]$/.test(part) ||
          /[\\:<>|"?*\x00-\x1f]/u.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part) ||
          ['.git', '.xmxs'].includes(part.toLowerCase()),
      )
  )
    throw new Error(`Invalid portable project path: ${path}`)
}

export async function importPortable(
  archive: string,
  destination: string,
): Promise<PortableManifest> {
  if ((await readdir(destination)).length)
    throw new Error('Choose an empty project folder')
  const archiveSize = (await stat(archive)).size
  checkSize(archiveSize, archive)
  // Our ZIP writer emits a standard end-of-central-directory record without a comment.
  const input = await open(archive, 'r')
  const trailer = Buffer.alloc(22)
  try {
    if (
      archiveSize < trailer.length ||
      (
        await input.read(
          trailer,
          0,
          trailer.length,
          archiveSize - trailer.length,
        )
      ).bytesRead !== trailer.length ||
      trailer.readUInt32LE() !== 0x06054b50 ||
      trailer.readUInt16LE(20) !== 0 ||
      trailer.readUInt32LE(12) + trailer.readUInt32LE(16) !==
        archiveSize - trailer.length
    )
      throw new Error('Incomplete portable ZIP archive')
  } finally {
    await input.close()
  }
  const stage = await mkdtemp(join(destination, '.import-'))
  const handles = new Set<number>()
  const entries = new Map<string, PortableEntry>()
  const names = new Set<string>()
  const installed: string[] = []
  const createdDirs: string[] = []
  let total = 0
  try {
    const unzip = new Unzip((file) => {
      const path = file.name
      validatePath(path)
      const key = path.normalize('NFC').toLowerCase()
      if (names.has(key)) throw new Error(`Duplicate archive file: ${path}`)
      names.add(key)
      if (names.size >= 0xffff) throw new Error('Too many archive files')
      const output = join(stage, path)
      mkdirSync(dirname(output), { recursive: true })
      const fd = openSync(output, 'wx')
      handles.add(fd)
      const hash = createHash('sha256')
      let size = 0
      file.ondata = (error, bytes, final) => {
        if (error) throw new Error(`Cannot read ${path}: ${error.message}`)
        size += bytes.length
        total += bytes.length
        checkSize(total, path)
        hash.update(bytes)
        let offset = 0
        while (offset < bytes.length)
          offset += writeSync(fd, bytes, offset, bytes.length - offset)
        if (final) {
          closeSync(fd)
          handles.delete(fd)
          entries.set(path, { path, size, sha256: hash.digest('hex') })
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    for await (const bytes of createReadStream(archive)) unzip.push(bytes)
    unzip.push(new Uint8Array(), true)
    if (
      handles.size ||
      !entries.delete('manifest.json') ||
      !entries.has('project.yaml')
    )
      throw new Error(
        'Incomplete portable project or missing manifest.json/project.yaml',
      )
    const manifest: PortableManifest = JSON.parse(
      await readFile(join(stage, 'manifest.json'), 'utf8'),
    )
    if (
      !Array.isArray(manifest.files) ||
      typeof manifest.appVersion !== 'string' ||
      !Array.isArray(manifest.requiredPlugins) ||
      !manifest.requiredPlugins.every((p) => typeof p === 'string')
    )
      throw new Error('Invalid portable project manifest.json')
    for (const expected of manifest.files) {
      const actual = entries.get(expected.path)
      if (
        !actual ||
        expected.size !== actual.size ||
        expected.sha256 !== actual.sha256
      )
        throw new Error(`File failed verification: ${expected.path}`)
      entries.delete(expected.path)
    }
    if (entries.size)
      throw new Error(`Unlisted archive file: ${entries.keys().next().value}`)
    if ((await readdir(destination)).length !== 1)
      throw new Error('Destination folder changed during import')
    const dirs = new Set([destination])
    for (const { path } of manifest.files) {
      let dir = destination
      for (const part of path.split('/').slice(0, -1)) {
        dir = join(dir, part)
        if (!dirs.has(dir)) {
          await mkdir(dir)
          dirs.add(dir)
          createdDirs.push(dir)
        }
      }
      const target = join(destination, path)
      await copyFile(join(stage, path), target, constants.COPYFILE_EXCL)
      installed.push(target)
    }
    return manifest
  } catch (error) {
    for (const path of installed.reverse()) await unlink(path)
    for (const dir of createdDirs.reverse()) await rmdir(dir)
    throw error
  } finally {
    for (const fd of handles) closeSync(fd)
    await rm(stage, { recursive: true, force: true })
  }
}
