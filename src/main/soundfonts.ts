import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { atomicWrite } from './project-io'
import type { FluidPreset } from '../shared/fluid'
import type { SoundFontIndexEntry, SoundFontFile } from '../shared/api'

export function defaultSoundfontDirs(): string[] {
  return process.platform === 'win32'
    ? [join(homedir(), 'Documents', 'SoundFonts')]
    : [
        '/usr/share/sounds/sf2',
        '/usr/share/sounds/sf3',
        '/usr/share/soundfonts',
        join(homedir(), '.local/share/soundfonts'),
      ]
}
export async function readPresets(file: string): Promise<FluidPreset[]> {
  const handle = await open(file, 'r')
  try {
    const size = (await handle.stat()).size
    const header = Buffer.alloc(12)
    await handle.read(header, 0, 12, 0)
    if (
      header.toString('ascii', 0, 4) !== 'RIFF' ||
      header.toString('ascii', 8, 12) !== 'sfbk'
    )
      return []
    for (let pos = 12; pos + 12 <= size;) {
      await handle.read(header, 0, 12, pos)
      const chunkSize = header.readUInt32LE(4)
      const end = pos + 8 + chunkSize
      if (end > size) return []
      if (
        header.toString('ascii', 0, 4) === 'LIST' &&
        header.toString('ascii', 8, 12) === 'pdta'
      ) {
        for (let inner = pos + 12; inner + 8 <= end;) {
          await handle.read(header, 0, 8, inner)
          const length = header.readUInt32LE(4)
          if (inner + 8 + length > end) return []
          if (header.toString('ascii', 0, 4) === 'phdr') {
            if (length < 38 || length > 38 * 65536 || length % 38) return []
            const data = Buffer.alloc(length)
            await handle.read(data, 0, length, inner + 8)
            const presets: FluidPreset[] = []
            for (let i = 0; i < length - 38; i += 38) {
              const bank = data.readUInt16LE(i + 22),
                program = data.readUInt16LE(i + 20)
              const name = data
                .toString('latin1', i, i + 20)
                .split('\0')[0]
                .trim()
              presets.push({
                bank,
                program,
                name,
                isDrum:
                  (bank & 128) !== 0 ||
                  (bank & 127) === 120 ||
                  (bank & 127) === 127,
              })
            }
            return presets
          }
          inner += 8 + length + (length % 2)
        }
      }
      pos = end + (chunkSize % 2)
      // Some SF3 writers omit the RIFF alignment byte after compressed samples.
      if (chunkSize % 2 && end + 4 <= size) {
        await handle.read(header, 0, 4, end)
        if (header.toString('ascii', 0, 4) === 'LIST') pos = end
      }
    }
    return []
  } finally {
    await handle.close()
  }
}
function isGM(presets: FluidPreset[]): boolean {
  const programs = new Set(
    presets.filter((p) => p.bank === 0).map((p) => p.program),
  )
  return Array.from({ length: 128 }, (_, i) => i).every((i) => programs.has(i))
}
export async function gmBank(file: string): Promise<boolean> {
  return isGM(await readPresets(file))
}

export async function indexSoundfonts(
  directories: string[],
  cacheFile: string,
): Promise<SoundFontIndexEntry[]> {
  let cache = new Map<string, SoundFontIndexEntry>()
  try {
    const entries: SoundFontIndexEntry[] = JSON.parse(
      await readFile(cacheFile, 'utf8'),
    )
    cache = new Map(
      entries
        .filter((e) => typeof e?.path === 'string' && Array.isArray(e.presets))
        .map((e) => [e.path, e]),
    )
  } catch {
    /* Start with an empty index when the cache is missing or unreadable. */
  }
  const results: SoundFontIndexEntry[] = []
  const seen = new Set<string>()
  for (const folder of directories) {
    const names = await readdir(folder).catch(() => [])
    for (const file of names.sort()) {
      if (!/\.sf[23]$/i.test(file) || seen.has(file)) continue
      const path = join(folder, file)
      const info = await stat(path).catch(() => null)
      if (!info?.isFile()) continue
      const previous = cache.get(path)
      if (
        previous &&
        previous.bytes === info.size &&
        previous.mtime === info.mtimeMs
      )
        results.push(previous)
      else {
        const presets = await readPresets(path).catch(() => [])
        if (!presets.length) continue
        const gm = isGM(presets)
        const kind = gm
          ? 'GM'
          : presets.every((p) => p.isDrum) || /drum|kit/i.test(file)
            ? 'Drums'
            : /piano|grand/i.test(file)
              ? 'Piano'
              : /synth/i.test(file)
                ? 'Synth'
                : 'Other'
        results.push({
          file,
          path,
          bytes: info.size,
          mtime: info.mtimeMs,
          gm,
          kind,
          presets,
        })
      }
      seen.add(file)
    }
  }
  await atomicWrite(cacheFile, JSON.stringify(results))
  return results
}
export async function scanSoundfonts(
  directories: string[],
): Promise<SoundFontFile[]> {
  const results: SoundFontFile[] = []
  const seen = new Set<string>()
  for (const dir of directories) {
    let files: string[]
    try {
      files = await readdir(dir)
    } catch {
      continue
    }
    for (const file of files.sort()) {
      if (!/\.sf[23]$/i.test(file) || seen.has(file)) continue
      try {
        const path = join(dir, file)
        const info = await stat(path)
        if (!info.isFile()) continue
        const gm = await gmBank(path)
        results.push({ file, bytes: info.size, gm })
        seen.add(file)
      } catch {
        /* Unreadable files are omitted from the available banks. */
      }
    }
  }
  return results
}
export async function findSoundfont(
  file: string,
  directories: string[],
): Promise<string | null> {
  if (basename(file) !== file || /[\\/:]/.test(file))
    throw new Error('Soundfont must be a file name')
  for (const dir of directories) {
    try {
      const path = join(dir, file)
      if ((await stat(path)).isFile()) return await realpath(path)
    } catch {
      continue
    }
  }
  return null
}
