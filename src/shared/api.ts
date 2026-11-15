import type { Settings } from './model'
export type FileMap = Record<string, string | Uint8Array>
export interface ProjectSnapshot {
  folder: string
  files: FileMap
  hashes: Record<string, string>
}
export interface FileChanges {
  folder: string
  files: Record<string, string | Uint8Array | null>
  hashes: Record<string, string>
}
export interface DesktopApi {
  project: {
    create: () => Promise<ProjectSnapshot | null>
    open: () => Promise<ProjectSnapshot | null>
    save: (
      files: FileMap,
      expectedHashes: Record<string, string>,
    ) => Promise<Record<string, string>>
    importFile: (kind: 'audio' | 'score' | 'midi') => Promise<string | null>
    urlFor: (relPath: string) => Promise<string>
    onFilesChanged: (handler: (changes: FileChanges) => void) => () => void
  }
  settings: {
    get: () => Promise<Settings>
    set: (settings: Settings) => Promise<void>
  }
  app: {
    onMenu: (handler: (cmd: string) => void) => () => void
    mounted: () => void
    engineReady: () => void
  }
}
declare global {
  interface Window {
    xm: DesktopApi
  }
}
