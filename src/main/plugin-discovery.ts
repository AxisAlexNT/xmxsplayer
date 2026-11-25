import { execFile } from 'node:child_process'
import { access, readdir, stat, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, delimiter, extname, join } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { atomicWrite } from './project-io'

import type { DiscoveredPlugin, PluginFormat } from '../shared/plugins'
export function parseDiscovery(
  text: string,
  format: PluginFormat,
  file: string,
): DiscoveredPlugin[] {
  const plugins: DiscoveredPlugin[] = []
  let fields: Map<string, string> | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = /^carla-discovery::([^:]+)::(.*)$/.exec(line)
    if (!match) continue
    const [, field, value] = match
    if (field === 'init') fields = new Map()
    else if (fields && field === 'end') {
      const raw = fields.get('label') ?? ''
      const prefix = basename(file) + '/'
      const uri =
        format === 'lv2' && raw.startsWith(prefix)
          ? raw.slice(prefix.length)
          : raw
      const name = fields.get('name')
      const number = (key: string) => Number(fields?.get(key)) || 0
      const hints = number('hints')
      if (name && uri)
        plugins.push({
          format,
          file,
          uri,
          name,
          maker: fields.get('maker') ?? '',
          instrument: !!(hints & 4) || fields.get('category') === 'synth',
          customUi: !!(hints & 8),
          audioInputs: number('audio.ins'),
          audioOutputs: number('audio.outs'),
          midiInputs: number('midi.ins'),
          parameters: number('parameters.ins'),
          uniqueId: number('uniqueId'),
        })
      fields = undefined
    } else fields?.set(field, value)
  }
  return plugins
}
export function pluginDirectories(format: PluginFormat): string[] {
  const env = process.env[format.toUpperCase() + '_PATH']
  if (env) return env.split(delimiter).filter(Boolean)
  return [
    join(homedir(), '.' + format),
    join(homedir(), '.local/lib', format),
    '/usr/local/lib/' + format,
    '/usr/lib/' + format,
  ]
}

interface IndexEntry {
  stamp: string
  plugins: DiscoveredPlugin[]
}
const run = promisify(execFile)
export async function discoverPlugins(
  cacheFile: string,
  executable = '/usr/lib/carla/carla-discovery-native',
  force = false,
  lv2Helper?: string,
): Promise<{ plugins: DiscoveredPlugin[]; errors: string[] }> {
  let previous: Record<string, IndexEntry> = {}
  if (!force) {
    try {
      previous = JSON.parse(await readFile(cacheFile, 'utf8'))
    } catch {
      /* First scan or stale index. */
    }
  }
  const next: Record<string, IndexEntry> = {},
    errors: string[] = []
  const scannerAvailable = await access(executable, constants.X_OK).then(() => true, () => false)
  let fallback: DiscoveredPlugin[] = []
  if (!scannerAvailable && lv2Helper) {
    try {
      const script = await readFile(lv2Helper, 'utf8')
      const {stdout} = await run('python3', ['-c', script, '--catalog'], {
        timeout: 20000, maxBuffer: 16 * 1024 * 1024,
      })
      fallback = JSON.parse(stdout)
    } catch (error) {
      errors.push('LV2 manifest scan: ' + String(error))
    }
    errors.push('Carla discovery is unavailable. Rescan with Carla installed to discover CLAP, VST3 and LADSPA plugins.')
    return { plugins: fallback, errors }
  }
  for (const format of ['lv2', 'clap', 'vst3', 'ladspa'] as const) {
    for (const dir of pluginDirectories(format)) {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      for (const name of names.sort()) {
        if (
          extname(name).toLowerCase() !==
          (format === 'ladspa' ? '.so' : '.' + format)
        )
          continue
        const file = join(dir, name)
        try {
          const info = await stat(file)
          const manifest =
            format === 'lv2' ? await stat(join(file, 'manifest.ttl')) : info
          const stamp = [
            info.size,
            info.mtimeMs,
            manifest.size,
            manifest.mtimeMs,
          ].join(':')
          if (
            previous?.[file]?.stamp === stamp &&
            Array.isArray(previous[file].plugins)
          )
            next[file] = previous[file]
          else {
            const { stdout } = await run(executable, [format, file], {
              timeout: 20000,
              maxBuffer: 16 * 1024 * 1024,
            })
            next[file] = {
              stamp,
              plugins: parseDiscovery(stdout, format, file),
            }
          }
        } catch (error) {
          errors.push(
            name +
              ': ' +
              (error instanceof Error ? error.message : String(error)),
          )
        }
      }
    }
  }
  await atomicWrite(cacheFile, JSON.stringify(next))
  return {
    plugins: Object.values(next).flatMap((entry) => entry.plugins),
    errors,
  }
}
