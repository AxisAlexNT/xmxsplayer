import { expect, it, vi } from 'vitest'
import { installClipPlan } from '../../src/engine/clips/stretch-plan'
import type { StretchSchedule } from 'signalsmith-stretch'
it('installs current and future audio segments together without cancelling a queued start', () => {
  const original = vi.fn(),
    defaults = {
      output: 0,
      input: 0,
      rate: 1,
      semitones: 0,
      active: false,
      tonalityHz: 8000,
      loopStart: 0,
      loopEnd: 0,
    }
  const processor = {
    timeMap: [defaults],
    port: { onmessage: original as MessagePort['onmessage'] },
  }
  installClipPlan(processor)
  const start = { output: 2, input: 0, rate: 1, semitones: 12, active: true },
    stop = { ...start, output: 4, input: 2, active: false }
  const send = (changes: StretchSchedule[]) =>
    processor.port.onmessage!.call(
      processor.port as MessagePort,
      { data: { type: 'xmxs:clip-plan', changes } } as MessageEvent,
    )
  send([start, stop])
  expect(processor.timeMap).toEqual([
    { ...defaults, ...start },
    { ...defaults, ...stop },
  ])
  expect(original).not.toHaveBeenCalled()
  send([{ ...start, input: NaN }])
  expect(processor.timeMap).toHaveLength(2)
  send([stop, start])
  expect(processor.timeMap).toHaveLength(2)
  send([{ ...start, rate: 0.5 }])
  expect(processor.timeMap).toEqual([{ ...defaults, ...start, rate: 0.5 }])
  processor.port.onmessage!.call(
    processor.port as MessagePort,
    { data: [3, 'latency'] } as MessageEvent,
  )
  expect(original).toHaveBeenCalledTimes(1)
})
