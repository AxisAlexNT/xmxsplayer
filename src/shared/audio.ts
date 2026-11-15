export interface AudioPeaks {
  sampleRate: number
  durationSec: number
  peaks: number[]
}
export interface AudioSource {
  url: string
  key: string
  cached: AudioPeaks | null
}
export const PEAK_FRAMES = 256
export const audioExtension = (file: string): string =>
  file.split('.').at(-1)?.toLowerCase() ?? 'unknown'
export const audioFormats = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a'])
export function sourceTime(songSec: number, offsetSec: number): number {
  return songSec - offsetSec
}
export function songTime(inputSec: number, offsetSec: number): number {
  return inputSec + offsetSec
}
