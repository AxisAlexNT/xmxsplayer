import type { AudioPeaks, AudioSource } from '../../shared/audio'
import { audioExtension } from '../../shared/audio'
import { audioPeaks } from './peaks'
export interface DecodedAudio extends AudioPeaks {
  key: string
  buffer: AudioBuffer
}
export class AudioDecoder {
  private buffers = new Map<string, Promise<DecodedAudio>>()
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
    const source = await this.resolve(file, this.context.sampleRate),
      old = this.buffers.get(source.key)
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
        peaks: audioPeaks(
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
  prune(keys: Set<string>): void {
    for (const key of this.buffers.keys())
      if (!keys.has(key)) this.buffers.delete(key)
  }
  clear(): void {
    this.buffers.clear()
  }
}
