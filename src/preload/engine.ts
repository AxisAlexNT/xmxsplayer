import { contextBridge, ipcRenderer } from 'electron'
import type { FluidApi } from '../shared/api'
ipcRenderer.on('bus:port', (event) => {
  window.postMessage({ type: 'bus:port' }, 'app://xmxsplayer', event.ports)
})
window.addEventListener(
  'DOMContentLoaded',
  () => ipcRenderer.send('port:ready'),
  { once: true },
)
const fluid: FluidApi = {
  detect: (path) => ipcRenderer.invoke('fluid:detect', path),
  start: () => ipcRenderer.invoke('fluid:start'),
  stop: () => ipcRenderer.invoke('fluid:stop'),
  load: (url) => ipcRenderer.invoke('fluid:load', url),
  unload: (font) => ipcRenderer.invoke('fluid:unload', font),
  presets: (font) => ipcRenderer.invoke('fluid:presets', font),
  send: (lines) => ipcRenderer.invoke('fluid:send', lines),
  onEvent: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof handler>[0],
    ): void => handler(value)
    ipcRenderer.on('fluid:event', listener)
    return () => ipcRenderer.removeListener('fluid:event', listener)
  },
}
const pluginPlayback: import('../shared/plugins').PluginPlayback = {
  onState(handler) {
    const listener = (_event:Electron.IpcRendererEvent, state:import('../shared/plugins').PluginStatus) => handler(state)
    ipcRenderer.on('plugins:state',listener)
    return ()=>ipcRenderer.removeListener('plugins:state',listener)
  },
  configure: (project, playing) => ipcRenderer.invoke('plugins:configure', project, playing),
  send: (id, command, values) => ipcRenderer.invoke('plugins:send', id, command, values),
}
contextBridge.exposeInMainWorld('pluginPlayback', pluginPlayback)
contextBridge.exposeInMainWorld('xm', { fluid })

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
