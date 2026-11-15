import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi } from '../shared/api'

function subscribe<T>(
  channel: string,
  handler: (value: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void =>
    handler(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
export function installBridge(ui: boolean): void {
  ipcRenderer.on('bus:port', (event) => {
    window.postMessage({ type: 'bus:port' }, 'app://xmxsplayer', event.ports)
  })
  window.addEventListener(
    'DOMContentLoaded',
    () => ipcRenderer.send('port:ready'),
    { once: true },
  )
  if (!ui) return
  const api: DesktopApi = {
    project: {
      restore: () => ipcRenderer.invoke('project:restore'),
      create: () => ipcRenderer.invoke('project:create'),
      open: () => ipcRenderer.invoke('project:open'),
      save: (files, hashes) =>
        ipcRenderer.invoke('project:save', files, hashes),
      importFile: (kind) => ipcRenderer.invoke('project:import', kind),
      urlFor: (path) => ipcRenderer.invoke('project:url', path),
      importDropped: (file) =>
        ipcRenderer.invoke(
          'project:importDropped',
          webUtils.getPathForFile(file),
        ),
      audioSource: (file, rate) =>
        ipcRenderer.invoke('audio:source', file, rate),
      cachePeaks: (file, key, data) =>
        ipcRenderer.invoke('audio:cache', file, key, data),
      onFilesChanged: (handler) => subscribe('project:changed', handler),
    },
    soundfonts: {
      scan: () => ipcRenderer.invoke('soundfonts:scan'),
      resolve: (file, locate) =>
        ipcRenderer.invoke('soundfonts:resolve', file, locate),
      pick: () => ipcRenderer.invoke('soundfonts:pick'),
    },
    settings: {
      get: () => ipcRenderer.invoke('settings:get'),
      set: (value) => ipcRenderer.invoke('settings:set', value),
    },
    app: {
      onMenu: (handler) => subscribe('app:menu', handler),
      relaunch: () => ipcRenderer.invoke('app:relaunch'),
      confirmClose: () => ipcRenderer.invoke('app:confirmClose'),
      mounted: () => ipcRenderer.send('ui:mounted'),
      engineReady: () => ipcRenderer.send('engine:ready'),
    },
  }
  contextBridge.exposeInMainWorld('xm', api)
}
