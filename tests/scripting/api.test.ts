import { expect, it, vi } from 'vitest'
import { createApi, type ApiHost } from '../../src/engine/script/api'
import { clip } from '../clips/fixture'
import { liveProject } from '../../src/shared/template'
function rig() {
  const project = liveProject('API'),
    errors: unknown[] = []
  const host: ApiHost = {
    project: () => project,
    position: () => ({ bar: 1, beat: 1, tick: 0, playing: false, rate: 1 }),
    play: vi.fn(),
    stop: vi.fn(),
    seekBar: vi.fn(),
    setRate: vi.fn(),
    hold: vi.fn(),
    release: vi.fn(),
    scene: () => null,
    activate: vi.fn(),
    registers: () => [false],
    register: vi.fn(),
    zones: vi.fn(),
    patch: vi.fn(),
    mode: () => 'live',
    setMode: vi.fn(),
    playNote: vi.fn(),
    clip: () => ({
      launch: vi.fn(),
      stop: vi.fn(),
      playing: false,
      semitones: 0,
      gain: 1,
    }),
    follow: () => 'written',
    setFollow: vi.fn(),
    pad: () => '#4cc2ff',
    setPad: vi.fn(),
    display: vi.fn(),
    log: vi.fn(),
    error: (e) => errors.push(e),
  }
  let active = true
  const api = createApi(
    host,
    (() => () => undefined) as never,
    {},
    () => active,
  )
  return {
    api,
    host,
    project,
    errors,
    deactivate: () => {
      active = false
    },
  }
}
it('validates mutations independently and prevents calls through stale API objects', () => {
  const { api, host, project, errors, deactivate } = rig()
  api.patch.set('missing', ['piano'])
  api.patch.set('piano', ['missing'])
  api.registers.set(8, true)
  api.transport.setRate(NaN)
  api.track('piano').playNote(60, 100, 0)
  api.pad(2).color = 'red'
  expect(errors).toHaveLength(6)
  expect(host.patch).not.toHaveBeenCalled()
  api.patch.set('piano', ['piano', 'piano'])
  api.zones.set(project.base.zones)
  api.track('piano').mode = 'auto'
  api.registers.set(1, true)
  api.track('piano').playNote(60, 100, 0.25)
  api.pad(2).color = '#b07cff'
  expect(host.patch).toHaveBeenCalledWith('piano', ['piano'])
  expect(host.setMode).toHaveBeenCalledWith('piano', 'auto')
  expect(host.playNote).toHaveBeenCalledWith('piano', 60, 100, 0.25)
  deactivate()
  api.transport.play()
  api.track('piano').mode = 'mute'
  api.pad(2).color = '#ff0000'
  expect(host.play).not.toHaveBeenCalled()
  expect(host.setMode).toHaveBeenCalledTimes(1)
  expect(host.setPad).toHaveBeenCalledTimes(1)
})
it('rejects duplicate zones, wrong kinds and missing destinations without partial writes', () => {
  const { api, host, project, errors } = rig()
  api.zones.set([...project.base.zones, ...project.base.zones])
  api.zones.set([{ ...project.base.zones[0], trackIds: ['absent'] }])
  api.scene.activate('absent')
  api.track('absent').mode = 'live'
  expect(errors).toHaveLength(4)
  expect(host.zones).not.toHaveBeenCalled()
  expect(host.activate).not.toHaveBeenCalled()
})

it('guards clip controls and live properties after disable or deletion', () => {
  const { api, host, project, errors, deactivate } = rig()
  const live = {
    launch: vi.fn(),
    stop: vi.fn(),
    playing: false,
    semitones: 0,
    gain: 0.8,
  }
  host.clip = () => live
  project.clips = [clip()]
  const ref = api.clip('loop')
  ref.launch()
  live.playing = true
  expect(ref.playing).toBe(true)
  ref.semitones = -12
  ref.gain = 0.5
  expect(live).toMatchObject({ semitones: -12, gain: 0.5 })
  ref.semitones = NaN
  ref.gain = -1
  expect(errors).toHaveLength(2)
  project.clips = []
  ref.stop()
  expect(errors).toHaveLength(3)
  expect(live.stop).not.toHaveBeenCalled()
  project.clips = [clip()]
  ref.stop()
  expect(live.stop).toHaveBeenCalledTimes(1)
  deactivate()
  ref.launch()
  ref.stop()
  ref.gain = 1
  expect(live.launch).toHaveBeenCalledTimes(1)
  expect(live.stop).toHaveBeenCalledTimes(1)
  expect(live.gain).toBe(0.5)
})
