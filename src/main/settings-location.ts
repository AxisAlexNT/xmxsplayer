import { posix, win32 } from 'node:path'

export function settingsLocation(
  executable: string,
  userData: string,
  environment: NodeJS.ProcessEnv,
  exists: (directory: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (environment.XMXS_DATA_DIR)
    return paths.join(environment.XMXS_DATA_DIR, 'settings.json')
  const outer =
    platform === 'linux' &&
    environment.APPIMAGE &&
    paths.isAbsolute(environment.APPIMAGE)
      ? paths.dirname(environment.APPIMAGE)
      : platform === 'win32' &&
          environment.PORTABLE_EXECUTABLE_DIR &&
          paths.isAbsolute(environment.PORTABLE_EXECUTABLE_DIR)
        ? environment.PORTABLE_EXECUTABLE_DIR
        : paths.dirname(executable)
  const portable = paths.join(outer, 'xmxsplayer-data')
  return paths.join(exists(portable) ? portable : userData, 'settings.json')
}
