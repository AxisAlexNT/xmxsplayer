import { afterEach, expect, it, vi } from 'vitest'
import { LedManager, type LedHost } from '../../src/engine/feedback/led-manager'
import { builtinProfiles } from '../../src/engine/midi/profile'
import { connect, selectProgram } from '../../src/engine/feedback/arturia-mk3'
import { newProject } from '../../src/shared/defaults'
import type { FeedbackState } from '../../src/engine/feedback/frame'
import type { ControllerDevice } from '../../src/engine/midi/device-manager'
const managers: LedManager[] = []
afterEach(async () => {
  const done = Promise.all(managers.splice(0).map((manager) => manager.close()))
  if (vi.isFakeTimers()) await vi.runAllTimersAsync()
  await done
  vi.useRealTimers()
})
function fixture() {
  let now = 0
  const p = newProject(),
    state: FeedbackState = {
      project: p,
      playing: false,
      recording: false,
      holding: false,
      tick: 0,
      rate: 1,
      runtime: {
        activeSceneId: null,
        registers: Array(8).fill(false),
        armedCueId: null,
        pendingActions: [],
        expectedNext: null,
        clips: {},
        effective: { zones: [], patch: [] },
      },
    },
    profile = builtinProfiles.find((p) => p.feedback === 'arturia-mk3')!,
    devices: ControllerDevice[] = [
      { id: 'keylab', name: 'KeyLab', profile, outputId: 'main' },
    ],
    output = { send: vi.fn(), clear: vi.fn() },
    report = vi.fn(),
    warn = vi.fn(),
    host: LedHost = {
      now: () => now,
      state: () => state,
      devices: () => devices,
      output: (id) => (id === 'main' ? output : undefined),
      forceProgram: () => false,
      queued: () => new Set(),
      report,
      warn,
    }
  const leds = new LedManager(host)
  managers.push(leds)
  return {
    host,
    leds,
    state,
    devices,
    output,
    report,
    warn,
    setNow: (value: number) => {
      now = value
    },
  }
}
it('connects only the paired main output, never forces the program by default and sends changes only', () => {
  const f = fixture()
  f.leds.tick()
  expect(f.output.send.mock.calls[0][0]).toEqual(connect())
  expect(
    f.output.send.mock.calls.some(
      (c) => c[0].join(',') === selectProgram(0).join(','),
    ),
  ).toBe(false)
  const count = f.output.send.mock.calls.length
  f.setNow(20)
  f.leds.tick()
  expect(f.output.send).toHaveBeenCalledTimes(count)
  expect(f.report.mock.lastCall?.[0].status).toBe('active')
  f.devices[0].outputId = undefined
  f.setNow(40)
  f.leds.tick()
  expect(f.report.mock.lastCall?.[0].status).toBe('off')
})
it('sends beat LED changes at their performance timestamps and cancels them on a seek', () => {
  const f = fixture()
  f.leds.tick()
  f.state.playing = true
  f.leds.beatAt(0, 100)
  f.setNow(80)
  f.leds.tick()
  expect(
    f.output.send.mock.calls.some((c) => c[1] === 100 && c[0][8] === 0x16),
  ).toBe(true)
  f.leds.invalidate()
  expect(f.output.clear).toHaveBeenCalledOnce()
})
it('re-sends state after program changes and pad release, without repeating program selection', () => {
  const f = fixture()
  f.leds.tick()
  const count = f.output.send.mock.calls.length
  f.leds.sysex('keylab', new Uint8Array(selectProgram(1)))
  expect(f.output.send.mock.calls.length).toBeGreaterThan(count)
  expect(
    f.output.send.mock.calls.filter(
      (c) => c[0].join(',') === connect().join(','),
    ),
  ).toHaveLength(2)
  const after = f.output.send.mock.calls.length
  f.leds.control({
    deviceId: 'keylab',
    controlId: 'pad.2',
    value: 0,
    pressed: false,
    edge: 'release',
    timestamp: 10,
  })
  expect(f.output.send.mock.calls.length).toBe(after + 1)
  expect(f.output.send.mock.lastCall?.[0][9]).toBe(0x1d)
})
it('lets hit flashes outrank scheduled chase and waiting cues outrank flashes', () => {
  const f = fixture()
  f.state.playing = true
  f.leds.tick()
  f.leds.beatAt(0, 100)
  f.setNow(80)
  f.leds.tick()
  f.leds.control({
    deviceId: 'keylab',
    controlId: 'pad.1',
    value: 1,
    pressed: true,
    edge: 'press',
    timestamp: 80,
  })
  expect(f.output.clear).toHaveBeenCalledOnce()
  expect(f.report.mock.lastCall?.[0].controls['pad.1']).toMatchObject({
    color: '#d8f3ff',
    state: 'on',
  })
  f.state.project.cues = [
    {
      id: 'cue',
      tick: 0,
      name: 'Cue',
      trigger: 'wait',
      control: 'pad.1',
      actions: [],
    },
  ]
  f.state.runtime.armedCueId = 'cue'
  f.leds.tick()
  expect(f.report.mock.lastCall?.[0].controls['pad.1']).toMatchObject({
    color: '#ffb020',
    state: 'queued',
  })
})
it('selects Arturia only when requested and reinitializes feedback on hot-plug', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.host.forceProgram = () => true
  f.leds.tick()
  expect(f.output.send.mock.calls[0][0]).toEqual(selectProgram(0))
  f.devices.splice(0)
  f.leds.tick()
  await vi.advanceTimersByTimeAsync(30)
  f.devices.push({
    id: 'new',
    name: 'KeyLab',
    profile: builtinProfiles.find((p) => p.feedback === 'arturia-mk3')!,
    outputId: 'main',
  })
  f.leds.tick()
  expect(
    f.output.send.mock.calls.filter(
      (c) => c[0].join(',') === selectProgram(0).join(','),
    ),
  ).toHaveLength(2)
})
it('sends disconnect on graceful shutdown and stops future updates', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.leds.start()
  const close = f.leds.close()
  await vi.advanceTimersByTimeAsync(30)
  await close
  expect(f.output.send.mock.lastCall?.[0]).toEqual(connect(false))
  const count = f.output.send.mock.calls.length
  f.leds.tick()
  await vi.advanceTimersByTimeAsync(100)
  expect(f.output.send).toHaveBeenCalledTimes(count)
})
