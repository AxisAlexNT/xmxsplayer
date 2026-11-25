import { expect, it, vi } from 'vitest'
import { PluginSynthBackend } from '../../src/engine/synth/plugin-synth'
import { liveProject } from '../../src/shared/template'

it('keeps note releases behind sustain and cancels retired sequencer notes', async () => {
  vi.useFakeTimers()
  const send = vi.fn().mockResolvedValue(undefined)
  const backend = new PluginSynthBackend(
    { send, onState: () => () => {}, configure: async () => true },
    () => 0,
    vi.fn(),
  )
  try {
    const instrument = liveProject('test').instruments[0]
    const slot = await backend.allocate(
      {
        ...instrument,
        backend: 'plugin',
        plugin: { format: 'lv2', name: 'Kick', uri: 'urn:kick' },
      },
      'kick',
    )
    backend.noteOn(slot, 60, 91)
    backend.cc(slot, 64, 127)
    backend.noteOff(slot, 60)
    expect(send).not.toHaveBeenCalledWith(
      'instrument-kick',
      'note_off',
      [0, 60],
    )
    backend.cc(slot, 64, 0)
    expect(send).toHaveBeenCalledWith('instrument-kick', 'note_off', [0, 60])
    backend.noteOn(slot, 75, 100, 2)
    backend.release(slot)
    vi.advanceTimersByTime(2500)
    expect(send).not.toHaveBeenCalledWith(
      'instrument-kick',
      'note_on',
      [0, 75, 100],
    )
  } finally {
    vi.useRealTimers()
  }
})
