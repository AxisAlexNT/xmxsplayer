import { expect, it } from 'vitest'
import { settingsLocation } from '../../src/main/settings-location'

it('uses an AppImage neighbor instead of the read-only mounted executable directory', () => {
  expect(
    settingsLocation(
      '/tmp/.mount_xmxs/xmxsplayer',
      '/profile',
      { APPIMAGE: '/studio/xmxsplayer.AppImage' },
      (dir) => dir === '/studio/xmxsplayer-data',
      'linux',
    ),
  ).toBe('/studio/xmxsplayer-data/settings.json')
})
it('uses the Windows portable launcher directory instead of its extraction directory', () => {
  expect(
    settingsLocation(
      'C:\\Temp\\portable\\xmxsplayer.exe',
      'C:\\Profile',
      { PORTABLE_EXECUTABLE_DIR: 'D:\\Studio' },
      (dir) => dir === 'D:\\Studio\\xmxsplayer-data',
      'win32',
    ),
  ).toBe('D:\\Studio\\xmxsplayer-data\\settings.json')
})
it('honors explicit settings and falls back to user data when no portable folder exists', () => {
  expect(
    settingsLocation(
      '/tmp/mount/app',
      '/profile',
      { APPIMAGE: '/studio/app.AppImage', XMXS_DATA_DIR: '/explicit' },
      () => true,
      'linux',
    ),
  ).toBe('/explicit/settings.json')
  expect(
    settingsLocation(
      '/tmp/mount/app',
      '/profile',
      { APPIMAGE: '/studio/app.AppImage' },
      () => false,
      'linux',
    ),
  ).toBe('/profile/settings.json')
  expect(
    settingsLocation(
      '/opt/app/app',
      '/profile',
      { APPIMAGE: 'relative.AppImage' },
      (dir) => dir === '/opt/app/xmxsplayer-data',
      'linux',
    ),
  ).toBe('/opt/app/xmxsplayer-data/settings.json')
})
