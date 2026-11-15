import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { atomicWrite, confined } from './project-io'
import type { AudioPeaks } from '../shared/audio'
export class AudioCache {
  constructor(private folder: () => string) {}
  private async identity(
    file: string,
    sampleRate: number,
  ): Promise<{ file: string; key: string }> {
    const root = this.folder()
    if (!root) throw Error('Open a project first')
    if (!file.startsWith('audio/')) throw Error('Audio must be inside audio/')
    if (![44100, 48000].includes(sampleRate)) throw Error('Invalid sample rate')
    const path = await confined(root, file),
      info = await stat(path)
    if (!info.isFile()) throw Error(`${file}: not a file`)
    return {
      file: path,
      key: createHash('sha256')
        .update(
          JSON.stringify([root, file, info.size, info.mtimeMs, sampleRate]),
        )
        .digest('hex'),
    }
  }
  async source(
    file: string,
    sampleRate: number,
  ): Promise<{ file: string; key: string; cached: AudioPeaks | null }> {
    const identity = await this.identity(file, sampleRate)
    let cached: AudioPeaks | null = null
    try {
      const data = JSON.parse(
        await readFile(
          await confined(this.folder(), `.xmxs/audio-${identity.key}.json`),
          'utf8',
        ),
      )
      if (validPeaks(data) && data.sampleRate === sampleRate) cached = data
    } catch {
      /* Missing and damaged caches are rebuilt. */
    }
    return { ...identity, cached }
  }
  async store(file: string, key: string, data: AudioPeaks): Promise<void> {
    if (!validPeaks(data)) throw Error('Invalid audio peak cache')
    const identity = await this.identity(file, data.sampleRate)
    if (identity.key !== key) return
    await atomicWrite(
      await confined(this.folder(), `.xmxs/audio-${key}.json`),
      JSON.stringify(data),
    )
  }
}
function validPeaks(data: AudioPeaks): boolean {
  return (
    !!data &&
    Number.isFinite(data.durationSec) &&
    data.durationSec > 0 &&
    [44100, 48000].includes(data.sampleRate) &&
    Array.isArray(data.peaks) &&
    data.peaks.length <=
      Math.ceil((data.durationSec * data.sampleRate) / 256) + 1 &&
    data.peaks.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
  )
}
