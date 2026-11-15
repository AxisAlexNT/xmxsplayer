import { expect, it, vi } from 'vitest'
import { Metronome } from '../../src/engine/transport/metronome'
import type { AudioGraph } from '../../src/engine/audio/graph'
import { BeatGrid } from '../../src/engine/transport/beat-grid'
import { newProject } from '../../src/shared/defaults'
import { TimeMap } from '../../src/shared/time-map'
import { TransportClock } from '../../src/engine/transport/clock'
import { importedAudio } from '../../src/ui/sources/import-audio'
it('schedules accented cue clicks and bounds the count-in lookahead', () => {
  const oscillators: {
    frequency: { value: number }
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    connect: () => void
    disconnect: () => void
  }[] = []
  const context = {
    currentTime: 0,
    createOscillator: () => {
      const o = {
        frequency: { value: 0 },
        start: vi.fn(),
        stop: vi.fn(),
        connect: () => undefined,
        disconnect: () => undefined,
      }
      oscillators.push(o)
      return o
    },
    createGain: () => ({
      gain: {
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      disconnect: () => undefined,
    }),
  }
  const route = vi.fn(() => ({
      context,
      destination: {},
      timeAt: (t: number) => t + 0.2,
    })),
    metro = new Metronome({ context, route } as unknown as AudioGraph)
  metro.click(1, true, true)
  expect(route).toHaveBeenCalledWith(true)
  expect(oscillators[0].frequency.value).toBe(1500)
  expect(oscillators[0].start).toHaveBeenCalledWith(1.2)
  metro.countIn(2, 3, 6, 0.5, true)
  expect(oscillators).toHaveLength(1)
  metro.tick(2)
  expect(oscillators).toHaveLength(2)
  metro.tick(3.1)
  expect(oscillators).toHaveLength(4)
  expect(oscillators[2].frequency.value).toBe(1000)
  metro.cancel(true)
  const count = oscillators.length
  metro.tick(10)
  expect(oscillators).toHaveLength(count)
})
it('captures audio-time anchors while running and applies them as one map change', () => {
  const p = newProject(),
    track = importedAudio(p, 'audio/reference.wav', 20).track
  p.tracks = [track]
  let now = 0
  const clock = new TransportClock(new TimeMap(p), () => now),
    apply = vi.fn(),
    reports = vi.fn(),
    grid = new BeatGrid(
      clock,
      () => p,
      () => undefined,
      apply,
      reports,
      () => undefined,
    )
  grid.setSession({ active: true, trackId: track.id, unit: 'beat' })
  grid.tapBeat()
  expect(reports.mock.lastCall?.[0].anchors).toEqual([])
  clock.play()
  for (const sec of [1, 1.5, 2.3, 2.8]) {
    now = sec
    grid.tapBeat()
  }
  expect(reports.mock.lastCall?.[0].anchors).toEqual([
    { tick: 0, sec: 1 },
    { tick: 480, sec: 1.5 },
    { tick: 960, sec: 2.3 },
    { tick: 1440, sec: 2.8 },
  ])
  expect(apply).not.toHaveBeenCalled()
  grid.setSession({ active: false, trackId: track.id, unit: 'beat' })
  expect(apply).toHaveBeenCalledOnce()
  expect(apply.mock.calls[0][0].tracks[0].offsetSec).toBe(-1)
  p.loop.enabled = true
  expect(() =>
    grid.setSession({ active: true, trackId: track.id, unit: 'beat' }),
  ).toThrow('looping off')
})
