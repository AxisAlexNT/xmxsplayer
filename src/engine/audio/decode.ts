import type { AudioPeaks, AudioSource } from '../../shared/audio'
import { audioExtension } from '../../shared/audio'
import { audioPeaksAsync } from './peaks'
export interface DecodedAudio extends AudioPeaks {
  key: string
  buffer: AudioBuffer
}
export class AudioDecoder {
  private buffers = new Map<string, Promise<DecodedAudio>>()
  private fileKeys = new Map<string, string>()
  private revision = 0
  constructor(
    private context: BaseAudioContext,
    private resolve: (file: string, sampleRate: number) => Promise<AudioSource>,
    private store: (
      file: string,
      key: string,
      peaks: AudioPeaks,
    ) => Promise<void>,
    private warn: (message: string) => void,
  ) {}
  async load(file: string): Promise<DecodedAudio> {
    const revision = this.revision
    const source = await this.resolve(file, this.context.sampleRate)
    if (revision !== this.revision)
      throw Error('Audio project changed while loading')
    this.fileKeys.set(file, source.key)
    const old = this.buffers.get(source.key)
    if (old) return old
    const loading = (async () => {
      const response = await fetch(source.url)
      if (!response.ok)
        throw Error(`${file}: loading failed (${response.status})`)
      let buffer: AudioBuffer
      try {
        buffer = await this.context.decodeAudioData(
          await response.arrayBuffer(),
        )
      } catch {
        throw Error(
          `${file}: cannot decode ${audioExtension(file).toUpperCase()} audio in this build`,
        )
      }
      const data = source.cached ?? {
        sampleRate: buffer.sampleRate,
        durationSec: buffer.duration,
        peaks: await audioPeaksAsync(
          Array.from({ length: buffer.numberOfChannels }, (_, i) =>
            buffer.getChannelData(i),
          ),
        ),
      }
      if (!source.cached)
        void this.store(file, source.key, data).catch((e) =>
          this.warn(`Waveform cache: ${String(e)}`),
        )
      return { ...data, key: source.key, buffer }
    })()
    this.buffers.set(source.key, loading)
    try {
      return await loading
    } catch (e) {
      this.buffers.delete(source.key)
      throw e
    }
  }
  prune(keys: Set<string>, files: ReadonlySet<string> = new Set()): void {
    keys = new Set(keys)
    for (const file of files) {
      const key = this.fileKeys.get(file)
      if (key) keys.add(key)
    }
    for (const key of this.buffers.keys())
      if (!keys.has(key)) this.buffers.delete(key)
  }
  clear(): void {
    this.revision++
    this.fileKeys.clear()
    this.buffers.clear()
  }
}
