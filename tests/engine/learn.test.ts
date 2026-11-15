import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ControlDef } from '../../src/shared/model'
import { Learn, learnedMode } from '../../src/engine/midi/learn'
import { decodeMidi } from '../../src/engine/midi/midi-io'
const control: ControlDef = {
  id: 'knob.2',
  label: 'Knob 2',
  kind: 'knob',
  mode: 'absolute',
  ui: { group: 'knobs', row: 0, col: 1 },
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const msg = (bytes: number[], source = 'a') =>
  decodeMidi(source, new Uint8Array(bytes), 20)!
it('learns full-range absolute CC and captures only once after quiet', () => {
  const captured = vi.fn(),
    learn = new Learn(captured)
  learn.start('a', control)
  expect(learn.receive(msg([0xb2, 71, 0], 'b'))).toBe(false)
  for (const n of [0, 20, 64, 100, 127]) learn.receive(msg([0xb2, 71, n]))
  vi.advanceTimersByTime(449)
  expect(captured).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(captured).toHaveBeenCalledExactlyOnceWith('a', {
    ...control,
    msg: { type: 'cc', channel: 2, number: 71 },
    mode: 'absolute',
  })
  learn.receive(msg([0xb2, 71, 90]))
  vi.advanceTimersByTime(500)
  expect(captured).toHaveBeenCalledTimes(1)
})
it('detects relative64 only with evidence in both directions and allows ambiguous capture correction', () => {
  expect(
    learnedMode(control, [{ value: 65 }, { value: 65 }, { value: 63 }]),
  ).toBe('relative64')
  expect(learnedMode(control, [{ value: 65 }])).toBe('absolute')
  expect(
    learnedMode(control, [
      { value: 30 },
      { value: 63 },
      { value: 65 },
      { value: 100 },
    ]),
  ).toBe('absolute')
})
it('captures pad note/channel on release, ignores pressure and unrelated messages', () => {
  const captured = vi.fn(),
    learn = new Learn(captured),
    pad = { ...control, id: 'pad.9', kind: 'pad' as const }
  learn.start('a', pad)
  learn.receive(msg([0x89, 44, 0]))
  learn.receive(msg([0x99, 44, 100]))
  learn.receive(msg([0xa9, 44, 120]))
  learn.receive(msg([0xb0, 20, 127]))
  learn.receive(msg([0x99, 44, 0]))
  expect(captured).toHaveBeenCalledExactlyOnceWith('a', {
    ...pad,
    msg: { type: 'note', channel: 9, number: 44 },
    mode: 'momentary',
  })
})
it('cancels pending captures and separates successive wizard steps', () => {
  const captured = vi.fn(),
    learn = new Learn(captured)
  learn.start('a', control)
  learn.receive(msg([0xb0, 71, 30]))
  learn.stop()
  vi.advanceTimersByTime(500)
  expect(captured).not.toHaveBeenCalled()
  learn.start('a', { ...control, id: 'fader.2', kind: 'fader' })
  learn.receive(msg([0xb0, 75, 100]))
  vi.advanceTimersByTime(450)
  expect(captured.mock.lastCall?.[1]).toMatchObject({
    id: 'fader.2',
    msg: { number: 75 },
  })
})
