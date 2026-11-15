import { afterEach, expect, it, vi } from 'vitest'
import type { AudioSource } from '../../src/shared/audio'
import { AudioDecoder } from '../../src/engine/audio/decode'
const restore = globalThis.fetch
afterEach(() => {
  globalThis.fetch = restore
})
it('retains a clip buffer when tracks prune the shared cache and invalidates it on project change', async () => {
  const buffer = {
    sampleRate: 48000,
    duration: 1,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(4),
  } as unknown as AudioBuffer
  const decode = vi.fn(async () => buffer)
  const context = {
    sampleRate: 48000,
    decodeAudioData: decode,
  } as unknown as BaseAudioContext
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([0])))
  const decoder = new AudioDecoder(
    context,
    async () => ({
      key: 'clip-a',
      url: 'xmfile://f/token',
      cached: { sampleRate: 48000, durationSec: 1, peaks: [0.1] },
    }),
    async () => undefined,
    () => undefined,
  )
  const a = await decoder.load('audio/loop.wav')
  decoder.prune(new Set(), new Set(['audio/loop.wav']))
  expect(await decoder.load('audio/loop.wav')).toBe(a)
  expect(decode).toHaveBeenCalledTimes(1)
  decoder.prune(new Set())
  await decoder.load('audio/loop.wav')
  expect(decode).toHaveBeenCalledTimes(2)
  decoder.clear()
  await decoder.load('audio/loop.wav')
  expect(decode).toHaveBeenCalledTimes(3)
})
it('rejects a file resolution completed after its project was closed', async () => {
  let finish!: (value: AudioSource) => void
  const decoder = new AudioDecoder(
    { sampleRate: 48000 } as BaseAudioContext,
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    async () => undefined,
    () => undefined,
  )
  const loading = decoder.load('audio/old.wav')
  decoder.clear()
  finish({ key: 'old', url: 'xmfile://f/old', cached: null })
  await expect(loading).rejects.toThrow('project changed')
})
