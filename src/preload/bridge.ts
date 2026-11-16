import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopApi, FluidApi } from '../shared/api'

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
  const fluid: FluidApi = {
    detect: (path) => ipcRenderer.invoke('fluid:detect', path),
    start: () => ipcRenderer.invoke('fluid:start'),
    stop: () => ipcRenderer.invoke('fluid:stop'),
    load: (url) => ipcRenderer.invoke('fluid:load', url),
    unload: (font) => ipcRenderer.invoke('fluid:unload', font),
    presets: (font) => ipcRenderer.invoke('fluid:presets', font),
    send: (lines) => ipcRenderer.invoke('fluid:send', lines),
    onEvent: (handler) => subscribe('fluid:event', handler),
  }
  const api: DesktopApi = {
    fluid,
    scores: {
      readXml: (file) => ipcRenderer.invoke('scores:xml', file),
      detect: (path) => ipcRenderer.invoke('scores:detect', path),
      convert: (source) => ipcRenderer.invoke('scores:convert', source),
      open: (file) => ipcRenderer.invoke('scores:open', file),
      exportMidi: (file, bytes) =>
        ipcRenderer.invoke('scores:export', file, bytes),
      onChanged: (handler) => subscribe('scores:changed', handler),
    },
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
