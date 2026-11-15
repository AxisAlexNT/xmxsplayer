import { dialog, ipcMain } from 'electron'
import { dirname } from 'node:path'
import type { FileMap } from '../shared/api'
import { ProjectIO, confined } from './project-io'
import { ProjectWatcher } from './watcher'
import { fileTokens } from './protocols'
import { loadSettings, saveSettings } from './settings'
import type { Windows } from './windows'

export function installIpc(windows: Windows): () => Promise<void> {
  const { ui } = windows
  const io = new ProjectIO()
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
  handle('project:create', async () => {
    const result = await dialog.showOpenDialog(ui, {
      title: 'Choose an empty project folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const snapshot = await io.create(result.filePaths[0])
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
  handle('project:url', async (path: string) => {
    if (!io.folder) throw new Error('Open a project first')
    return fileTokens.issue(await confined(io.folder, path), [io.folder])
  })
  handle('settings:get', () => loadSettings())
  handle('settings:set', (value) => saveSettings(value))
  return () => watcher.close()
}
