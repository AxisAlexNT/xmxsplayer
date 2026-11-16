import { afterEach, expect, it, vi } from 'vitest'
import { FluidSynthBackend } from '../../src/engine/synth/fluid-synth'
import type { FluidApi } from '../../src/shared/api'
import type { FluidEvent } from '../../src/shared/fluid'
import { defaultSettings } from '../../src/shared/defaults'
const backends: FluidSynthBackend[] = []
afterEach(async () => {
  for (const backend of backends.splice(0)) await backend.destroy()
  vi.useRealTimers()
})
function rig() {
  vi.useFakeTimers()
  let time = 0,
    generation = 0,
    running = false,
    nextFont = 100,
    listener: (event: FluidEvent) => void = () => undefined
  const emit = (event: FluidEvent): void => listener(event)
  const api: FluidApi = {
    detect: vi.fn(async () => ({ path: 'fluidsynth', version: '2.3.4' })),
    start: vi.fn(async () => {
      if (!running) {
        running = true
        emit({ type: 'ready', generation: ++generation })
      }
      return { generation }
    }),
    stop: vi.fn(async () => {
      running = false
      emit({ type: 'exit', code: 0, restarting: false })
    }),
    load: vi.fn(async () => ++nextFont),
    unload: vi.fn(async () => undefined),
    presets: vi.fn(async () => [
      { bank: 0, program: 0, name: 'Piano', isDrum: false },
    ]),
    send: vi.fn(async () => undefined),
    onEvent: (handler) => {
      listener = handler
      return () => {
        listener = () => undefined
      }
    },
  }
  const warn = vi.fn(),
    recovered = vi.fn(),
    resolveFont = vi.fn(async () => 'xmfile://f/fresh')
  const backend = new FluidSynthBackend(
    api,
    () => time,
    { ...defaultSettings().fluid, sampleRate: 48000 },
    warn,
    resolveFont,
    recovered,
  )
  backends.push(backend)
  const instrument = {
    id: 'piano',
    name: 'Piano',
    color: '#4cc2ff',
    bank: 0,
    program: 0,
    isDrum: false,
    volume: 0.8,
    pan: 0,
    reverb: 0.2,
    chorus: 0,
    transpose: 0,
    soundfontId: 'gm',
    backend: 'fluid' as const,
  }
  return {
    api,
    backend,
    instrument,
    warn,
    recovered,
    resolveFont,
    setTime: (value: number) => {
      time = value
    },
    restart: () => {
      emit({ type: 'exit', code: 1, restarting: true })
      running = true
      emit({ type: 'ready', generation: ++generation })
    },
  }
}
it('loads once, selects returned IDs and configures independent melodic and drum slots', async () => {
  const { api, backend, instrument } = rig()
  await backend.loadSoundFont(
    { id: 'gm', file: 'Piano.sf2' },
    'xmfile://f/font',
  )
  await backend.loadSoundFont(
    { id: 'gm', file: 'Piano.sf2' },
    'xmfile://f/other',
  )
  expect(api.load).toHaveBeenCalledTimes(1)
  await backend.allocate(instrument)
  await backend.allocate({ ...instrument, isDrum: true, bank: 128 })
  expect(vi.mocked(api.send).mock.calls[0][0][0]).toBe('select 0 101 0 0')
  expect(vi.mocked(api.send).mock.calls[1][0][0]).toBe('select 9 101 128 0')
  await backend.allocate({ ...instrument, isDrum: true, bank: 136 })
  expect(vi.mocked(api.send).mock.calls[2][0][0]).toBe('select 25 101 136 0')
  expect(await backend.listPresets('gm')).toHaveLength(1)
  expect(backend.latencySec()).toBeCloseTo(512 / 48000)
})
it('batches due messages in stable time order and cancels only the requested channel', async () => {
  const { api, backend, instrument, setTime } = rig()
  await backend.loadSoundFont(
    { id: 'gm', file: 'Piano.sf2' },
    'xmfile://f/font',
  )
  const a = await backend.allocate(instrument),
    b = await backend.allocate(instrument)
  vi.mocked(api.send).mockClear()
  backend.noteOn(a, 60, 100, 3)
  backend.noteOn(a, 62, 90, 2)
  backend.noteOff(a, 62, 2)
  backend.cc(b, 64, 127, 2)
  backend.clearScheduled(b)
  setTime(2)
  backend.flush()
  expect(api.send).toHaveBeenLastCalledWith(['noteon 0 62 90', 'noteoff 0 62'])
  setTime(3)
  backend.flush()
  expect(api.send).toHaveBeenLastCalledWith(['noteon 0 60 100'])
  backend.noteOn(a, 65, 100, 4)
  backend.allNotesOff()
  vi.mocked(api.send).mockClear()
  setTime(5)
  backend.flush()
  expect(api.send).not.toHaveBeenCalled()
})
it('retains retired font ownership until its release tail is reclaimed without stealing held channels', async () => {
  const { api, backend, instrument } = rig()
  await backend.loadSoundFont({ id: 'gm', file: 'Old.sf2' }, 'xmfile://f/old')
  const old = await backend.allocate({ ...instrument, isDrum: true })
  await backend.loadSoundFont({ id: 'gm', file: 'New.sf3' }, 'xmfile://f/new')
  expect(api.unload).not.toHaveBeenCalled()
  backend.release(old)
  for (let n = 0; n < 4; n++)
    await backend.allocate({ ...instrument, isDrum: true })
  expect(api.unload).toHaveBeenCalledWith(101)
  await expect(
    backend.allocate({ ...instrument, isDrum: true }),
  ).rejects.toThrow('no free drum')
})
it('reloads fonts and channel configuration after a process restart and discards queued notes', async () => {
  const { api, backend, instrument, setTime, restart, resolveFont, recovered } =
    rig()
  await backend.loadSoundFont({ id: 'gm', file: 'Piano.sf2' }, 'xmfile://f/old')
  const id = await backend.allocate(instrument)
  backend.noteOn(id, 60, 100, 2)
  restart()
  await backend.listPresets('gm')
  expect(resolveFont).toHaveBeenCalledWith({ id: 'gm', file: 'Piano.sf2' })
  expect(api.load).toHaveBeenLastCalledWith('xmfile://f/fresh')
  expect(vi.mocked(api.send).mock.calls.at(-1)![0][0]).toBe('select 0 102 0 0')
  expect(recovered).toHaveBeenCalledTimes(1)
  vi.mocked(api.send).mockClear()
  setTime(3)
  backend.flush()
  expect(api.send).not.toHaveBeenCalled()
})
it('marks failed restoration unavailable and retries after a missing font is located', async () => {
  const { api, backend, instrument, restart } = rig()
  await backend.loadSoundFont({ id: 'gm', file: 'Piano.sf2' }, 'xmfile://f/old')
  await backend.allocate(instrument)
  vi.mocked(api.load).mockRejectedValue(Error('Missing font'))
  restart()
  await expect(backend.listPresets('gm')).rejects.toThrow('Missing font')
  expect(backend.available).toBe(false)
  vi.mocked(api.load).mockResolvedValue(105)
  await backend.listPresets('gm')
  expect(backend.available).toBe(true)
  expect(vi.mocked(api.send).mock.calls.at(-1)![0][0]).toBe('select 0 105 0 0')
})

it('dispatches live input immediately after older due events without waiting for the timer', async () => {
  const { api, backend, instrument, setTime } = rig()
  await backend.loadSoundFont(
    { id: 'gm', file: 'Piano.sf2' },
    'xmfile://f/font',
  )
  const id = await backend.allocate(instrument)
  vi.mocked(api.send).mockClear()
  backend.noteOn(id, 60, 100, 1)
  setTime(1)
  backend.cc(id, 64, 127)
  expect(vi.mocked(api.send).mock.calls.map((call) => call[0])).toEqual([
    ['noteon 0 60 100'],
    ['cc 0 64 127'],
  ])
  backend.noteOff(id, 60)
  expect(api.send).toHaveBeenLastCalledWith(['noteoff 0 60'])
})
