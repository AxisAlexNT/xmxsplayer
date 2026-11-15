import { ipcRenderer } from 'electron'

ipcRenderer.on('bus:port', event => {
  window.postMessage({ type: 'bus:port' }, 'app://xmxsplayer', event.ports)
})
window.addEventListener('DOMContentLoaded', () => ipcRenderer.send('port:ready'), { once: true })
