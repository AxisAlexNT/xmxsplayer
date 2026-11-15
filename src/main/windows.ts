import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  powerSaveBlocker,
  session,
} from 'electron'

export interface Windows {
  ui: BrowserWindow
  getEngine: () => BrowserWindow
  stopEngine: () => Promise<void>
}
export function createWindows(preloadRoot: string): Windows {
  const options = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  }
  const ui = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0c0f13',
    webPreferences: { ...options, preload: join(preloadRoot, 'ui.cjs') },
  })
  let engine: BrowserWindow
  let uiReady = false
  let engineReady = false
  let shuttingDown = false
  let crashes = 0
  let engineStopped = false
  let shutdown: Promise<void> | undefined
  let shutdownDone: (() => void) | undefined
  let blocker: number | undefined
  function stopEngine(): Promise<void> {
    if (shutdown) return shutdown
    shuttingDown = true
    stopBlocker()
    shutdown = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('Engine shutdown acknowledgement timed out')
        finish()
      }, 1500)
      function finish(): void {
        clearTimeout(timer)
        engineStopped = true
        shutdownDone = undefined
        resolve()
      }
      shutdownDone = finish
      if (engine.isDestroyed()) finish()
      else engine.webContents.send('engine:shutdown')
    })
    return shutdown
  }
  ipcMain.on('engine:shutdownDone', (event) => {
    if (
      event.sender === engine.webContents &&
      event.senderFrame === engine.webContents.mainFrame
    )
      shutdownDone?.()
  })
  function stopBlocker(): void {
    if (blocker !== undefined) powerSaveBlocker.stop(blocker)
    blocker = undefined
  }
  ipcMain.on('engine:playing', (event, playing: unknown) => {
    if (
      event.sender !== engine.webContents ||
      event.senderFrame !== engine.webContents.mainFrame ||
      typeof playing !== 'boolean'
    )
      return
    if (playing && blocker === undefined)
      blocker = powerSaveBlocker.start('prevent-app-suspension')
    else if (!playing) stopBlocker()
  })
  function secure(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault(),
    )
  }
  function broker(): void {
    if (!uiReady || !engineReady || ui.isDestroyed() || engine.isDestroyed())
      return
    const { port1, port2 } = new MessageChannelMain()
    ui.webContents.postMessage('bus:port', null, [port1])
    engine.webContents.postMessage('bus:port', null, [port2])
  }
  function createEngine(): void {
    engineReady = false
    engine = new BrowserWindow({
      show: false,
      webPreferences: {
        ...options,
        preload: join(preloadRoot, 'engine.cjs'),
        additionalArguments:
          process.env.XM_SMOKE === '1' ? ['--xmxs-smoke'] : [],
        backgroundThrottling: false,
      },
    })
    secure(engine)
    engine.webContents.on('render-process-gone', (_event, details) => {
      engineReady = false
      stopBlocker()
      if (shuttingDown) return
      console.error(`Engine renderer exited: ${details.reason}`)
      ui.webContents.send('app:menu', 'engine:restarting')
      engine.destroy()
      setTimeout(
        () => {
          if (!shuttingDown) createEngine()
        },
        Math.min(500 * 2 ** crashes++, 5000),
      )
    })
    void engine.loadURL('app://xmxsplayer/src/engine/index.html')
  }
  secure(ui)
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin) =>
      process.env.XM_SMOKE !== '1' &&
      !!contents &&
      (contents === ui.webContents || contents === engine?.webContents) &&
      ['midi', 'midiSysex'].includes(permission) &&
      origin === 'app://xmxsplayer',
  )
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        process.env.XM_SMOKE !== '1' &&
          (contents === ui.webContents || contents === engine?.webContents) &&
          ['midi', 'midiSysex'].includes(permission) &&
          details.requestingUrl.startsWith('app://xmxsplayer/'),
      )
    },
  )
  ipcMain.on('port:ready', (event) => {
    if (event.sender === ui.webContents) uiReady = true
    else if (event.sender === engine.webContents) engineReady = true
    else return
    broker()
  })
  ui.on('closed', () => {
    void stopEngine().then(() => app.quit())
  })
  app.on('before-quit', (event) => {
    if (engineStopped) return
    event.preventDefault()
    if (!ui.isDestroyed()) ui.close()
    else void stopEngine().then(() => app.quit())
  })
  createEngine()
  void ui.loadURL('app://xmxsplayer/src/ui/index.html')
  return { ui, getEngine: () => engine, stopEngine }
}
