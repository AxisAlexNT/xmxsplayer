import { contextBridge, ipcRenderer } from 'electron'

ipcRenderer.on('bus:port', (event) => {
  window.postMessage({ type: 'bus:port' }, 'app://xmxsplayer', event.ports)
})
window.addEventListener(
  'DOMContentLoaded',
  () => ipcRenderer.send('port:ready'),
  { once: true },
)

contextBridge.exposeInMainWorld('engineHost', {
  smoke: process.argv.includes('--xmxs-smoke'),
  setPlaying: (playing: boolean) => ipcRenderer.send('engine:playing', playing),
  onShutdown: (handler: () => Promise<void>) => {
    const listener = (): void => {
      void Promise.resolve()
        .then(handler)
        .catch((error) => console.error('Engine shutdown failed:', error))
        .finally(() => ipcRenderer.send('engine:shutdownDone'))
    }
    ipcRenderer.on('engine:shutdown', listener)
    return () => ipcRenderer.removeListener('engine:shutdown', listener)
  },
})
