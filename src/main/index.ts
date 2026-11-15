import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain } from 'electron'
import { installProtocols } from './protocols'
import { createWindows } from './windows'
import { loadSettings, saveSettings } from './settings'

app.setName('xmxsplayer')
const settings = loadSettings()
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
if (settings.audio.bufferSize > 0)
  app.commandLine.appendSwitch(
    'audio-buffer-size',
    String(settings.audio.bufferSize),
  )
const smoke = process.env.XM_SMOKE === '1'
const timeout = smoke
  ? setTimeout(() => {
      console.error('UI mount / engine handshake timed out')
      app.exit(1)
    }, 30_000)
  : undefined
void app
  .whenReady()
  .then(() => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    installProtocols(join(root, 'renderer'))
    const windows = createWindows(join(root, 'preload'))
    ipcMain.handle('settings:get', event => {
      if (event.sender !== windows.ui.webContents) throw new Error('Forbidden')
      return loadSettings()
    })
    ipcMain.handle('settings:set', (event, value) => {
      if (event.sender !== windows.ui.webContents) throw new Error('Forbidden')
      saveSettings(value)
    })
    let mounted = false
    let ready = false
    let finishing = false
    const finish = async (): Promise<void> => {
      if (!smoke || !mounted || !ready || finishing) return
      finishing = true
      if (process.env.XM_SMOKE_SCREENSHOT) {
        const { writeFile } = await import('node:fs/promises')
        windows.ui.setContentSize(1920, 1080)
        await windows.ui.webContents.executeJavaScript(
          'document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))',
        )
        await writeFile(
          process.env.XM_SMOKE_SCREENSHOT,
          (await windows.ui.webContents.capturePage()).resize({ width: 1920, height: 1080 }).toPNG(),
        )
      }
      console.log('UI mounted; engine ready')
      clearTimeout(timeout)
      app.quit()
    }
    ipcMain.on('ui:mounted', (event) => {
      if (event.sender === windows.ui.webContents) {
        mounted = true
        void finish()
      }
    })
    ipcMain.on('engine:ready', (event) => {
      if (event.sender === windows.ui.webContents) {
        ready = true
        void finish()
      }
    })
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
