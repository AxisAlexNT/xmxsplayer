import { spawn } from 'node:child_process'
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { atomicWrite, confined } from './project-io'
import type { ScoreData } from '../shared/api'
import type { Source } from '../shared/model'

export interface Detection {
  path: string
  version: string
}
export function executableCandidates(
  configured: string,
  platform = process.platform,
  env = process.env,
  home = homedir(),
): string[] {
  if (configured.trim()) return [configured.trim()]
  const names = [
    'mscore',
    'musescore',
    'mscore4portable',
    'musescore4',
    'mscore3',
    'musescore3',
  ]
  const paths = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const candidates = paths.flatMap((dir) =>
    names.map((name) => join(dir, name + (platform === 'win32' ? '.exe' : ''))),
  )
  if (platform === 'win32') {
    for (const dir of [env.ProgramFiles, env['ProgramFiles(x86)']].filter(
      (p): p is string => !!p,
    ))
      for (const version of [4, 3])
        candidates.push(
          join(dir, `MuseScore ${version}`, 'bin', `MuseScore${version}.exe`),
        )
  } else candidates.push(join(home, 'Applications', 'MuseScore.AppImage'))
  return [...new Set(candidates)]
}
export function conversionJob(
  input: string,
  midi: string,
  musicxml: string,
): string {
  return JSON.stringify([{ in: input, out: [midi, musicxml] }], null, 2)
}
export async function runMuseScore(
  path: string,
  args: string[],
  timeoutMs = 60000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, {
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.platform === 'linux'
          ? { QT_QPA_PLATFORM: 'offscreen' }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      errors = '',
      timedOut = false
    child.stdout.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-8192)
    })
    child.stderr.on('data', (data: Buffer) => {
      errors = (errors + data.toString()).slice(-8192)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut)
        reject(Error('MuseScore conversion timed out after 60 seconds'))
      else if (code !== 0)
        reject(
          Error(
            `MuseScore exited with code ${code}: ${errors.trim().slice(-2000)}`,
          ),
        )
      else resolve((output + '\n' + errors).trim())
    })
  })
}
export async function detectMuseScore(
  configured = '',
  deps = {
    candidates: executableCandidates,
    accessible: (path: string) =>
      access(
        path,
        process.platform === 'win32' ? constants.F_OK : constants.X_OK,
      ),
    run: runMuseScore,
    appImages: async (): Promise<string[]> => {
      const dir = join(homedir(), 'Applications')
      try {
        return (await readdir(dir))
          .filter((n) => /MuseScore.*\.AppImage$/i.test(n))
          .map((n) => join(dir, n))
      } catch {
        return []
      }
    },
  },
): Promise<Detection> {
  const candidates = [
    ...deps.candidates(configured),
    ...(!configured.trim() ? await deps.appImages() : []),
  ]
  const errors: string[] = []
  for (const path of candidates) {
    try {
      await deps.accessible(path)
      const version = await deps.run(path, ['--version'], 10000)
      const line = version
        .split('\n')
        .find((line) => /MuseScore.*\d/i.test(line))
      if (!line) throw Error('Executable did not report a MuseScore version')
      return { path, version: line }
    } catch (error) {
      if (configured.trim()) errors.push(String(error))
    }
  }
  throw Error(
    `MuseScore executable not found${errors.length ? ': ' + errors.join('; ') : '. Set its path in Settings → Files.'}`,
  )
}
export async function convertScore(
  folder: string,
  source: Source,
  executable: string,
): Promise<ScoreData> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id))
    throw Error('Invalid source ID')
  const input = await confined(folder, source.file)
  if (!(await stat(input)).isFile()) throw Error(`${source.file}: not a file`)
  if (source.kind === 'musicxml')
    throw Error(`${source.file}: needs staves milestone`)
  if (source.kind === 'mid')
    return { midi: new Uint8Array(await readFile(input)) }
  const midi = await confined(folder, `.xmxs/${source.id}/score.mid`)
  const musicxml = await confined(folder, `.xmxs/${source.id}/score.musicxml`)
  await mkdir(dirname(midi), { recursive: true })
  // Unique output paths prevent stale files from making a failed export look successful.
  const { randomUUID } = await import('node:crypto')
  const token = randomUUID(),
    tempMidi = midi + `.${token}.mid`,
    tempXml = musicxml + `.${token}.musicxml`
  const job = resolve(dirname(midi), 'job.json')
  const { rm } = await import('node:fs/promises')
  try {
    await atomicWrite(job, conversionJob(input, tempMidi, tempXml))
    const diagnostics = await runMuseScore(executable, ['-j', job])
    let bytes: Buffer, xml: string
    try {
      ;[bytes, xml] = await Promise.all([
        readFile(tempMidi),
        readFile(tempXml, 'utf8'),
      ])
    } catch {
      throw Error(
        `MuseScore did not write MIDI and MusicXML: ${diagnostics.slice(-2000)}`,
      )
    }
    await atomicWrite(midi, bytes)
    await atomicWrite(musicxml, xml)
    return { midi: new Uint8Array(bytes), musicxml: xml }
  } finally {
    await Promise.all([
      rm(tempMidi, { force: true }),
      rm(tempXml, { force: true }),
    ])
  }
}
