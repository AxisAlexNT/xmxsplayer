import { translate } from '../shared/i18n-en'
import { loadSettings } from './settings'
import {
  app,
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron'
export function installMenu(ui: BrowserWindow): void {
  const t = (key: Parameters<typeof translate>[0]) => translate(key, {}, locale)
  const locale = loadSettings().locale
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
        label: t('menu.file'),
        submenu: [
          action(t('menu.newProject'), 'new', 'CmdOrCtrl+N'),
          action(t('menu.open'), 'open', 'CmdOrCtrl+O'),
          action(t('menu.save'), 'save', 'CmdOrCtrl+S'),
          { type: 'separator' },
          action(t('menu.importMidi'), 'import:midi'),
          action(t('menu.importAudio'), 'import:audio'),
          action(t('menu.linkScore'), 'link:score'),
          action(t('menu.exportMidiForMusescore'), 'export:midi'),
          { type: 'separator' },
          action(t('menu.settings'), 'settings:audio', 'CmdOrCtrl+,'),
          { label: t('menu.quit'), click: () => app.quit() },
        ],
      },
      {
        label: t('menu.edit'),
        submenu: [
          action(t('menu.undo'), 'undo', 'CmdOrCtrl+Z'),
          action(t('menu.redo'), 'redo', 'CmdOrCtrl+Y'),
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: t('menu.view'),
        submenu: [
          action(t('menu.collapseLeftPanel'), 'view:collapse'),
          action(t('menu.staffLanes'), 'view:lanes:staff'),
          action(t('menu.pianoRollLanes'), 'view:lanes:roll'),
          action(t('menu.perTrackLaneView'), 'view:lanes:per-track'),
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: t('menu.help'),
        submenu: [
          {
            label: t('menu.aboutXmxsplayer'),
            click: () => ui.webContents.send('app:menu', 'about'),
          },
        ],
      },
    ]),
  )
}
