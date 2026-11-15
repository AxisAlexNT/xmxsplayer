import { AudioCache } from './audio-cache'
import { audioExtension, audioFormats, type AudioPeaks } from '../shared/audio'
import { relaunchArgs } from './relaunch'
import { app, dialog, ipcMain } from 'electron'
import { basename, dirname, join } from 'node:path'
import type { FileMap } from '../shared/api'
import { ProjectIO, confined } from './project-io'
import { ProjectWatcher } from './watcher'
import { fileTokens } from './protocols'
import { loadSettings, saveSettings } from './settings'
import { liveProject } from '../shared/template'
import {
  defaultSoundfontDirs,
  findSoundfont,
  scanSoundfonts,
} from './soundfonts'
import type { Windows } from './windows'

export function installIpc(windows: Windows): () => Promise<void> {
  const { ui } = windows
  const io = new ProjectIO()
  const audioCache = new AudioCache(() => io.folder)
  const watcher = new ProjectWatcher()
  let operations = Promise.resolve<unknown>(undefined)
  function handle(name: string, fn: (...args: never[]) => unknown): void {
    ipcMain.handle(name, (event, ...args) => {
      if (
        event.sender !== ui.webContents ||
        event.senderFrame !== ui.webContents.mainFrame ||
        !event.senderFrame.url.startsWith('app://xmxsplayer/')
      )
        throw new Error('Forbidden')
      const work = operations.then(() => fn(...(args as never[])))
      operations = work.catch(() => undefined)
      return work
    })
  }
  const watch = async (): Promise<void> => {
    fileTokens.clear()
    await watcher.start(io, (changes) => {
      if (!ui.isDestroyed()) ui.webContents.send('project:changed', changes)
    })
  }
  let restored = false
  handle('project:restore', async () => {
    if (restored) return null
    restored = true
    const index = process.argv.indexOf('--reopen-project')
    if (index < 0 || !process.argv[index + 1]) return null
    const snapshot = await io.open(process.argv[index + 1])
    await watch()
    return snapshot
  })
  handle('project:create', async () => {
    const result = await dialog.showOpenDialog(ui, {
      title: 'Choose an empty project folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const available = await scanSoundfonts(directories())
    const template = liveProject(
      basename(result.filePaths[0]),
      available.find((sf) => sf.gm)?.file,
    )
    const snapshot = await io.create(result.filePaths[0], template)
    await watch()
    return snapshot
  })
  handle('project:open', async () => {
    const result = await dialog.showOpenDialog(ui, {
      title: 'Open project folder or project.yaml',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Project', extensions: ['yaml'] }],
    })
    if (result.canceled) return null
    const chosen = result.filePaths[0]
    const snapshot = await io.open(
      chosen.endsWith('.yaml') ? dirname(chosen) : chosen,
    )
    await watch()
    return snapshot
  })
  handle('project:save', (files: FileMap, hashes: Record<string, string>) =>
    io.save(files, hashes),
  )
  handle('project:import', async (kind: 'audio' | 'score' | 'midi') => {
    if (!['audio', 'score', 'midi'].includes(kind))
      throw new Error('Invalid import kind')
    const result = await dialog.showOpenDialog(ui, {
      title: 'Import file',
      properties: ['openFile'],
    })
    return result.canceled ? null : io.importFile(kind, result.filePaths[0])
  })
  handle('project:importDropped', (file: string) => {
    if (typeof file !== 'string' || !audioFormats.has(audioExtension(file)))
      throw Error('Choose WAV, MP3, OGG, FLAC or M4A audio')
    return io.importFile('audio', file)
  })
  handle('audio:source', async (file: string, rate: number) => {
    const source = await audioCache.source(file, rate)
    return {
      ...source,
      file: undefined,
      url: await fileTokens.issue(source.file, [io.folder]),
    }
  })
  handle('audio:cache', (file: string, key: string, data: AudioPeaks) =>
    audioCache.store(file, key, data),
  )
  handle('project:url', async (path: string) => {
    if (!io.folder) throw new Error('Open a project first')
    return fileTokens.issue(await confined(io.folder, path), [io.folder])
  })
  function directories(): string[] {
    const configured = loadSettings().soundfontDirs
    return [
      ...(configured.length ? configured : defaultSoundfontDirs()),
      ...(io.folder ? [join(io.folder, 'soundfonts')] : []),
    ]
  }
  async function pickSoundfont(
    title: string,
  ): Promise<{ file: string; url: string } | null> {
    const chosen = await dialog.showOpenDialog(ui, {
      title,
      properties: ['openFile'],
      filters: [{ name: 'Soundfonts', extensions: ['sf2', 'sf3'] }],
    })
    if (chosen.canceled) return null
    const path = chosen.filePaths[0]
    const settings = loadSettings()
    const folder = dirname(path)
    settings.soundfontDirs = [
      ...new Set([
        ...(settings.soundfontDirs.length
          ? settings.soundfontDirs
          : defaultSoundfontDirs()),
        folder,
      ]),
    ]
    saveSettings(settings)
    return { file: basename(path), url: await fileTokens.issue(path, [folder]) }
  }
  handle('soundfonts:scan', () => scanSoundfonts(directories()))
  handle('soundfonts:resolve', async (file: string, locate = false) => {
    const dirs = directories()
    const found = await findSoundfont(file, dirs)
    if (found) return { file, url: await fileTokens.issue(found, dirs) }
    return locate ? pickSoundfont(`Locate missing soundfont — ${file}`) : null
  })
  handle('soundfonts:pick', () => pickSoundfont('Add soundfont'))
  handle('app:confirmClose', async () => {
    const result = await dialog.showMessageBox(ui, {
      type: 'question',
      title: 'Unsaved changes',
      message: 'Discard unsaved changes and quit?',
      buttons: ['Discard and quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  })
  handle('app:relaunch', async () => {
    await windows.stopEngine()
    app.relaunch({ args: relaunchArgs(process.argv.slice(1), io.folder) })
    app.exit(0)
  })
  handle('settings:get', () => loadSettings())
  handle('settings:set', (value) => saveSettings(value))
  return () => watcher.close()
}
