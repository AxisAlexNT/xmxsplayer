import { expect, it, vi } from 'vitest'
import {
  Bindings,
  SoftTakeover,
  type BindingHost,
} from '../../src/engine/router/bindings'
import type { ControlEvent } from '../../src/engine/midi/profile'
import { newProject } from '../../src/shared/defaults'
import type { MidiTrack } from '../../src/shared/model'
function sampleTrack(): MidiTrack {
  return {
    id: 'piano-lh',
    name: 'Piano LH',
    color: '#4cc2ff',
    kind: 'midi',
    mode: 'live',
    solo: false,
    volume: 1,
    pan: 0,
    height: 132,
    notes: [],
    events: [],
    view: 'roll',
    clef: 'auto',
    quantGrid: 120,
    armed: false,
    leads: false,
  }
}
const event = (
  controlId: string,
  edge: ControlEvent['edge'] = 'press',
  extra: Partial<ControlEvent> = {},
): ControlEvent => ({
  deviceId: 'a',
  controlId,
  edge,
  value: 1,
  pressed: edge !== 'release',
  timestamp: 10,
  ...extra,
})
function fixture() {
  const p = newProject(),
    context = {
      activeSceneId: null as string | null,
      registers: Array(8).fill(false),
      bar: 1,
      playing: false,
      holding: false,
    },
    run = vi.fn(),
    jobs = new Map<number, () => void>(),
    host: BindingHost = {
      project: () => p,
      context: () => context,
      profile: () => ({
        id: 'arturia-keylab-essential-mk3',
        controls: [
          {
            id: 'knob.1',
            label: 'Speed',
            kind: 'knob',
            mode: 'absolute',
            ui: { group: 'knobs', row: 0, col: 0 },
          },
        ],
      }),
      run,
      parameter: () => 1,
      queue: (at, fn) => {
        if (at === 'now') {
          fn()
          return 0
        }
        const id = jobs.size + 1
        jobs.set(id, fn)
        return id
      },
      cancel: (id) => {
        jobs.delete(id)
      },
    }
  return { p, context, run, jobs, host, bindings: new Bindings(host) }
}
it('requires pickup, tracks crossed targets and re-arms after an external change', () => {
  const p = new SoftTakeover()
  expect(p.accept('a', 0.9, 0.5, 0)).toBe(false)
  expect(p.accept('a', 0.6, 0.5, 10)).toBe(false)
  expect(p.accept('a', 0.4, 0.5, 20)).toBe(true)
  expect(p.accept('a', 0.3, 0.4, 30)).toBe(true)
  expect(p.accept('a', 0.2, 0.8, 500)).toBe(false)
  expect(p.accept('a', 0.9, 0.8, 510)).toBe(true)
  expect(p.accept('b', 0.9, 0.2, 520)).toBe(false)
})
it('dispatches edges, conditions and forward-as-skip only during a hold', () => {
  const f = fixture()
  f.bindings.receive(event('transport.play'))
  expect(f.run.mock.lastCall?.[0]).toEqual({ type: 'transport', cmd: 'toggle' })
  f.context.holding = true
  f.bindings.receive(event('transport.forward'))
  expect(f.run.mock.lastCall?.[0]).toEqual({
    type: 'transport',
    cmd: 'skipHold',
  })
  f.p.base.bindings.push({
    control: 'pad.1',
    edge: 'press',
    when: { bars: [33, 40] },
    action: { type: 'app', cmd: 'save' },
  })
  f.bindings.receive(event('pad.1'))
  expect(f.run).toHaveBeenCalledTimes(2)
  f.context.bar = 33
  f.bindings.receive(event('pad.1'))
  expect(f.run.mock.lastCall?.[0]).toEqual({ type: 'app', cmd: 'save' })
})
it('keeps controller mappings isolated and applies scene overrides', () => {
  const f = fixture()
  f.p.mappings['arturia-keylab-essential-mk3'].bindings.push({
    control: 'transport.play',
    edge: 'press',
    action: { type: 'transport', cmd: 'stop' },
  })
  f.bindings.receive(event('transport.play'))
  expect(f.run.mock.lastCall?.[0]).toMatchObject({ cmd: 'stop' })
  f.host.profile = () => ({ id: 'generic', controls: [] })
  f.bindings.receive(event('transport.play'))
  expect(f.run.mock.lastCall?.[0]).toMatchObject({ cmd: 'toggle' })
})
it('keeps note-off ownership across changed conditions, and cancels released queued notes', () => {
  const f = fixture()
  f.p.base.bindings.push({
    control: 'pad.1',
    edge: 'press',
    when: { playing: false },
    action: { type: 'note', trackId: 'piano', key: 60, velocity: 'control' },
  })
  f.bindings.receive(event('pad.1'))
  f.context.playing = true
  f.p.base.bindings = []
  f.bindings.receive(event('pad.1', 'release'))
  expect(f.run.mock.lastCall).toEqual([
    { type: 'note', trackId: 'piano', key: 60, velocity: 'control' },
    1,
    false,
    'binding:["a","pad.1"]',
  ])
  f.context.playing = false
  f.p.base.bindings = [
    {
      control: 'pad.2',
      edge: 'press',
      at: 'bar',
      action: { type: 'note', trackId: 'piano', key: 64, velocity: 100 },
    },
  ]
  f.bindings.receive(event('pad.2'))
  expect(f.jobs.size).toBe(1)
  f.bindings.receive(event('pad.2', 'release'))
  expect(f.jobs.size).toBe(0)
  expect(f.run).toHaveBeenCalledTimes(2)
})
it('resolves default faders by track order and uses relative deltas from the target value', () => {
  const f = fixture()
  f.p.tracks = [sampleTrack()]
  f.bindings.receive(event('fader.1', 'change'))
  expect(f.run.mock.lastCall?.[0]).toMatchObject({
    type: 'param',
    target: 'track.volume',
    id: 'piano-lh',
  })
  f.bindings.receive(event('knob.1', 'change', { delta: -2 }))
  expect(f.run.mock.lastCall?.[1]).toBeCloseTo((1 - 0.25) / 1.25 - 2 / 127)
  f.p.tracks = []
  const count = f.run.mock.calls.length
  f.bindings.receive(event('fader.1', 'change'))
  expect(f.run).toHaveBeenCalledTimes(count)
})
it('queues ordinary actions and releases active notes on unplug', () => {
  const f = fixture()
  f.p.base.bindings = [
    {
      control: 'pad.1',
      edge: 'press',
      at: 'bar',
      action: { type: 'app', cmd: 'save' },
    },
    {
      control: 'pad.2',
      edge: 'press',
      action: { type: 'note', trackId: 'piano', key: 60, velocity: 100 },
    },
  ]
  f.bindings.receive(event('pad.1'))
  expect(f.run).not.toHaveBeenCalled()
  f.jobs.get(1)!()
  expect(f.run.mock.lastCall?.[0]).toMatchObject({ cmd: 'save' })
  f.bindings.receive(event('pad.2'))
  f.bindings.disconnect('a')
  expect(f.run.mock.lastCall?.[2]).toBe(false)
})
it('routes clip pressure and release to the press-time action and forwards timing without double queueing', () => {
  const f = fixture(),
    pressure = vi.fn()
  f.host.pressure = pressure
  f.p.base.bindings = [
    {
      control: 'pad.1',
      edge: 'press',
      at: 'bar',
      action: { type: 'clip', cmd: 'launch', clipId: 'old' },
    },
  ]
  f.bindings.receive(event('pad.1', 'press', { value: 0.5 }))
  expect(f.jobs.size).toBe(0)
  expect(f.run.mock.lastCall).toEqual([
    { type: 'clip', cmd: 'launch', clipId: 'old' },
    0.5,
    true,
    'binding:["a","pad.1"]',
    { at: 'bar', delta: undefined },
  ])
  f.p.base.bindings = [
    {
      control: 'pad.1',
      edge: 'press',
      action: { type: 'clip', cmd: 'launch', clipId: 'new' },
    },
  ]
  f.bindings.receive(event('pad.1', 'change', { pressed: true, value: 0.7 }))
  expect(pressure).toHaveBeenCalledWith(
    { type: 'clip', cmd: 'launch', clipId: 'old' },
    0.7,
    'binding:["a","pad.1"]',
  )
  f.bindings.receive(event('pad.1', 'release'))
  expect(f.run.mock.lastCall?.[0]).toEqual({
    type: 'clip',
    cmd: 'launch',
    clipId: 'old',
  })
  expect(f.run.mock.lastCall?.[2]).toBe(false)
})
