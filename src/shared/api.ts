import type { AudioPeaks, AudioSource } from './audio'
import type { Source, Settings } from './model'
export interface SoundFontFile {
  file: string
  bytes: number
  gm: boolean
}
export interface ResolvedSoundFont {
  file: string
  url: string
}
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
export interface ScoreData {
  midi: Uint8Array
  musicxml?: string
}
export interface DesktopApi {
  scores: {
    readXml: (file: string) => Promise<string>
    detect: (path?: string) => Promise<{ path: string; version: string }>
    convert: (source: Source) => Promise<ScoreData>
    open: (file: string) => Promise<void>
    exportMidi: (file: string, bytes: Uint8Array) => Promise<string>
    onChanged: (
      handler: (change: { folder: string; paths: string[] }) => void,
    ) => () => void
  }
  project: {
    restore: () => Promise<ProjectSnapshot | null>
    create: () => Promise<ProjectSnapshot | null>
    open: () => Promise<ProjectSnapshot | null>
    save: (
      files: FileMap,
      expectedHashes: Record<string, string>,
    ) => Promise<Record<string, string>>
    importFile: (kind: 'audio' | 'score' | 'midi') => Promise<string | null>
    urlFor: (relPath: string) => Promise<string>
    importDropped: (file: File) => Promise<string>
    audioSource: (file: string, sampleRate: number) => Promise<AudioSource>
    cachePeaks: (file: string, key: string, data: AudioPeaks) => Promise<void>
    onFilesChanged: (handler: (changes: FileChanges) => void) => () => void
  }
  soundfonts: {
    scan: () => Promise<SoundFontFile[]>
    resolve: (
      file: string,
      locate?: boolean,
    ) => Promise<ResolvedSoundFont | null>
    pick: () => Promise<ResolvedSoundFont | null>
  }
  settings: {
    get: () => Promise<Settings>
    set: (settings: Settings) => Promise<void>
  }
  app: {
    onMenu: (handler: (cmd: string) => void) => () => void
    relaunch: () => Promise<void>
    confirmClose: () => Promise<boolean>
    mounted: () => void
    engineReady: () => void
  }
}
declare global {
  interface Window {
    engineHost: {
      smoke: boolean
      setPlaying(playing: boolean): void
      onShutdown(handler: () => Promise<void>): () => void
    }
    xm: DesktopApi
  }
}
