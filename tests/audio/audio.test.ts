import { expect, it } from 'vitest'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  symlink,
  readFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AudioCache } from '../../src/main/audio-cache'
import { audioPeaks } from '../../src/engine/audio/peaks'
import { channelMatrix } from '../../src/engine/audio/channel-mode'
import { contextTimeAt } from '../../src/engine/audio/graph'
import { sourceTime, songTime } from '../../src/shared/audio'
it('reduces both channels into bounded peaks per 256 frames', () => {
  const l = new Float32Array(513),
    r = new Float32Array(513)
  l[10] = -0.8
  r[280] = 0.9
  r[512] = 2
  expect(audioPeaks([l, r])).toEqual([
    expect.closeTo(0.8),
    expect.closeTo(0.9),
    1,
  ])
})
it('isolates stereo channels, mono mid and mono side without doubling gain', () => {
  const input = [0.8, 0.2],
    mix = (mode: Parameters<typeof channelMatrix>[0]) =>
      channelMatrix(mode).map((row) => row[0] * input[0] + row[1] * input[1])
  expect(mix('stereo')).toEqual([0.8, 0.2])
  expect(mix('left')).toEqual([0.8, 0.8])
  expect(mix('right')).toEqual([0.2, 0.2])
  expect(mix('mid')).toEqual([0.5, 0.5])
  expect(mix('side')).toEqual([expect.closeTo(0.3), expect.closeTo(0.3)])
})
it('maps audio offset and output timestamps between independent contexts', () => {
  expect(songTime(sourceTime(4.5, -0.7), -0.7)).toBeCloseTo(4.5)
  const context = (
    currentTime: number,
    contextTime: number,
    performanceTime: number,
  ) =>
    ({
      currentTime,
      getOutputTimestamp: () => ({ contextTime, performanceTime }),
    }) as AudioContext
  expect(
    contextTimeAt(context(5, 4.9, 1000), context(2, 1.8, 1020), 5.2),
  ).toBeCloseTo(2.08)
  expect(contextTimeAt(context(5, 0, 0), context(2, 0, 0), 5.2)).toBeCloseTo(
    2.2,
  )
})
it('persists peak caches, keys them by file and sample rate, and confines cache writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xmxs-audio-cache-'))
  await mkdir(join(root, 'audio'))
  await writeFile(join(root, 'audio/test.wav'), 'test')
  const cache = new AudioCache(() => root),
    first = await cache.source('audio/test.wav', 48000),
    data = { sampleRate: 48000, durationSec: 1, peaks: [0.2, 0.4] }
  expect(first.cached).toBeNull()
  await cache.store('audio/test.wav', first.key, data)
  expect((await cache.source('audio/test.wav', 48000)).cached).toEqual(data)
  expect((await cache.source('audio/test.wav', 44100)).key).not.toBe(first.key)
  await writeFile(join(root, 'audio/test.wav'), 'new content')
  expect((await cache.source('audio/test.wav', 48000)).cached).toBeNull()
  await expect(cache.source('../outside', 48000)).rejects.toThrow()
  const outside = await mkdtemp(join(tmpdir(), 'xmxs-audio-outside-')),
    other = await mkdtemp(join(tmpdir(), 'xmxs-audio-symlink-'))
  await mkdir(join(other, 'audio'))
  await writeFile(join(other, 'audio/a.wav'), 'a')
  await symlink(outside, join(other, '.xmxs'))
  const linked = new AudioCache(() => other),
    source = await linked.source('audio/a.wav', 48000)
  await expect(linked.store('audio/a.wav', source.key, data)).rejects.toThrow(
    'Symlink',
  )
  expect(await readdir(outside)).toEqual([])
  expect(
    await readFile(join(root, '.xmxs/audio-' + first.key + '.json'), 'utf8'),
  ).toContain('48000')
})
