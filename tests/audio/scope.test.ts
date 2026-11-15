import { expect, it, vi } from 'vitest'
import { AudioTracks } from '../../src/engine/audio/tracks'
import type { AudioGraph } from '../../src/engine/audio/graph'
import type { DecodedAudio } from '../../src/engine/audio/decode'
import type { Bus } from '../../src/shared/bus'
import { TransportClock } from '../../src/engine/transport/clock'
import { TimeMap } from '../../src/shared/time-map'
import { newProject } from '../../src/shared/defaults'
it('discards a delayed decode after the user opens another project', async () => {
  const send = vi.fn(),
    bus = { send } as unknown as Bus,
    graph = { context: { sampleRate: 48000 } } as unknown as AudioGraph
  const manager = new AudioTracks(
    graph,
    new TransportClock(new TimeMap(newProject()), () => 0),
    () => null,
    () => bus,
    () => undefined,
  )
  manager.setScope('first')
  let finish!: (audio: DecodedAudio) => void
  vi.spyOn(manager.decoder, 'load').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const loading = manager.load('reference', 'audio/test.wav')
  manager.setScope('second')
  finish({
    key: 'old',
    buffer: {} as AudioBuffer,
    durationSec: 1,
    sampleRate: 48000,
    peaks: [0.5],
  })
  await expect(loading).rejects.toThrow('project changed')
  expect(send.mock.calls.filter(([name]) => name === 'audio:peaks')).toEqual([])
  expect(
    send.mock.calls.filter(
      ([name, data]) => name === 'audio:state' && !data.loading,
    ),
  ).toEqual([])
})
