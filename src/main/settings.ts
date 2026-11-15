import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { defaultSettings } from '../shared/defaults'
import { settingsSchema } from '../shared/schema'
import type { Settings } from '../shared/model'

export function settingsPath(): string {
  const portable = join(dirname(app.getPath('exe')), 'xmxsplayer-data')
  return join(
    process.env.XMXS_DATA_DIR ||
      (existsSync(portable) ? portable : app.getPath('userData')),
    'settings.json',
  )
}
export function loadSettings(): Settings {
  try {
    return settingsSchema.parse(
      JSON.parse(readFileSync(settingsPath(), 'utf8')),
    )
  } catch (error) {
    if (existsSync(settingsPath()))
      console.error(`settings.json: ${String(error)}`)
    return defaultSettings()
  }
}
export function saveSettings(value: Settings): void {
  const settings = settingsSchema.parse(value)
  const target = settingsPath()
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(`${target}.tmp`, JSON.stringify(settings, null, 2))
  renameSync(`${target}.tmp`, target)
}
