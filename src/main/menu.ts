import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
export function installMenu(ui: BrowserWindow): void {
  const action = (
    label: string,
    cmd: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => ui.webContents.send('app:menu', cmd),
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          action('New Project', 'new', 'CmdOrCtrl+N'),
          action('Open', 'open', 'CmdOrCtrl+O'),
          action('Save', 'save', 'CmdOrCtrl+S'),
          { type: 'separator' },
          action('Import MIDI', 'import:midi'),
          action('Import Audio', 'import:audio'),
          { label: 'Link Score', enabled: false },
          { label: 'Export MIDI for MuseScore', enabled: false },
          { type: 'separator' },
          action('Settings', 'settings:audio', 'CmdOrCtrl+,'), { label: 'Quit', click: () => app.quit() },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          action('Undo', 'undo', 'CmdOrCtrl+Z'),
          action('Redo', 'redo', 'CmdOrCtrl+Y'),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          action('Collapse left panel', 'view:collapse'),
          action('Staff lanes', 'view:lanes:staff'),
          action('Piano roll lanes', 'view:lanes:roll'),
          action('Per-track lane view', 'view:lanes:per-track'),
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About xmxsplayer',
            click: () => ui.webContents.send('app:menu', 'about'),
          },
        ],
      },
    ]),
  )
}
