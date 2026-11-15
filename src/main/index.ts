import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, ipcMain } from 'electron'
import { installProtocols } from './protocols'
import { createWindows } from './windows'
import { installIpc } from './ipc'
import { installMenu } from './menu'
import { loadSettings } from './settings'

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
    const close = installIpc(windows)
    installMenu(windows.ui)
    app.on('before-quit', () => {
      void close()
    })
    let mounted = false
    let ready = false
    let finishing = false
    const finish = async (): Promise<void> => {
      if (!smoke || !mounted || !ready || finishing) return
      finishing = true
      if (process.env.XM_SMOKE_SCREENSHOT) {
        const { writeFile } = await import('node:fs/promises')
        const contents = windows.ui.webContents
        contents.debugger.attach('1.3')
        await contents.debugger.sendCommand(
          'Emulation.setDeviceMetricsOverride',
          { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
        )
        await windows.ui.webContents.executeJavaScript(
          'document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))',
        )
        const capture = await contents.debugger.sendCommand(
          'Page.captureScreenshot',
          {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
          },
        )
        await writeFile(
          process.env.XM_SMOKE_SCREENSHOT,
          Buffer.from(capture.data, 'base64'),
        )
        contents.debugger.detach()
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
