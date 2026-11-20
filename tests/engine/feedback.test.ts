import { expect, it, vi } from 'vitest'
import {
  connect,
  display,
  programChanged,
  rgb,
  screenText,
  selectProgram,
  setColor,
} from '../../src/engine/feedback/arturia-mk3'
import {
  controlFrame,
  mergeFeedback,
  screenLines,
  type FeedbackState,
} from '../../src/engine/feedback/frame'
import {
  DiffOutput,
  FeedbackBudget,
} from '../../src/engine/feedback/diff-output'
import { builtinProfiles } from '../../src/engine/midi/profile'
import { clip } from '../clips/fixture'
import { newProject } from '../../src/shared/defaults'
const profile = builtinProfiles.find((p) => p.feedback === 'arturia-mk3')!
function state(): FeedbackState {
  const project = newProject('Acid Wolfpack')
  return {
    project,
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
  }
}
it('builds only the documented KeyLab SysEx messages with exact 7-bit payloads', () => {
  expect(connect()).toEqual([
    0xf0, 0, 0x20, 0x6b, 0x7f, 0x42, 2, 15, 64, 90, 1, 0xf7,
  ])
  expect(connect(false).at(-2)).toBe(0)
  expect(selectProgram(0)).toEqual([
    0xf0, 0, 0x20, 0x6b, 0x7f, 0x42, 0x21, 0x11, 0x40, 2, 0, 0, 0xf7,
  ])
  expect(setColor(0x1d, rgb('#ff8000'))).toEqual([
    0xf0, 0, 0x20, 0x6b, 0x7f, 0x42, 4, 1, 0x16, 0x1d, 127, 64, 0, 0xf7,
  ])
  expect(display('A', '1.1')).toEqual([
    0xf0, 0, 0x20, 0x6b, 0x7f, 0x42, 4, 1, 0x60, 0x12, 1, 65, 0, 2, 49, 46, 49,
    0, 0xf7,
  ])
  expect(programChanged(new Uint8Array(selectProgram(2)))).toBe(2)
  expect(programChanged(new Uint8Array(connect()))).toBeNull()
  expect(screenText('Été\n🎹')).toBe('Ete???')
  expect(screenText('12345678901234567890')).toHaveLength(16)
  expect(() => selectProgram(128)).toThrow('7-bit')
  expect(() => setColor(1, [128, 0, 0])).toThrow('7-bit')
})
it('merges colour layers in order with queued cues above pad-hit flashes', () => {
  const s = state()
  s.playing = true
  s.project.mappings[profile.id].beatChase = 'top'
  s.project.base.padColors = { 'pad.1': '#ff0000' }
  let frame = controlFrame(profile, s, { time: 0, blink: true, beat: 1 })
  expect(frame['pad.1']).toMatchObject({
    color: '#ffb020',
    level: 1,
    state: 'on',
  })
  frame = controlFrame(profile, s, {
    time: 0,
    blink: true,
    beat: 1,
    flashes: new Map([['pad.1', 100]]),
  })
  expect(frame['pad.1'].color).toBe('#d8f3ff')
  s.project.cues = [
    {
      id: 'reprise',
      tick: 0,
      name: 'Reprise',
      trigger: 'armed',
      control: 'pad.1',
      actions: [],
    },
  ]
  s.runtime.armedCueId = 'reprise'
  frame = controlFrame(profile, s, {
    time: 0,
    blink: false,
    beat: 1,
    flashes: new Map([['pad.1', 100]]),
  })
  expect(frame['pad.1']).toEqual({
    color: '#ffb020',
    level: 0.12,
    state: 'queued',
  })
  s.project.metronome.visualPads = false
  s.runtime.armedCueId = null
  frame = controlFrame(profile, s, { time: 200, blink: true, beat: 1 })
  expect(frame['pad.1']).toMatchObject({
    color: '#ff0000',
    level: 0.2,
    state: 'idle',
  })
  expect(
    mergeFeedback(
      undefined,
      { color: '#ffffff', level: 1, state: 'on' },
      undefined,
    ).state,
  ).toBe('on')
})
it('shows section state on bank A and beat and phrase on bank B', () => {
  const s = state()
  s.playing = true
  s.runtime.registers[0] = true
  const frame = controlFrame(profile, s, { time: 0, blink: true, beat: 2 })
  expect(frame['pad.1'].state).toBe('on')
  expect(frame['pad.2'].state).toBe('idle')
  expect(frame['pad.10'].state).toBe('on')
  expect(frame['pad.13'].state).toBe('on')
  s.project.base.beatChase = 'bottom'
  s.project.mappings[profile.id].beatChase = 'bottom'
  expect(
    controlFrame(profile, s, { time: 0, blink: true, beat: 3 })['pad.7'].state,
  ).toBe('on')
})
it('formats scene/project names and bar/beat, speed and follow state for the screen', () => {
  const s = state()
  s.rate = 0.6
  s.tick = 1920
  expect(screenLines(s)).toEqual(['Acid Wolfpack', '2.1 60% Written'])
  s.project.scenes = [{ id: 'verse', name: 'Verse', color: '#4cc2ff' }]
  s.runtime.activeSceneId = 'verse'
  s.holding = true
  expect(screenLines(s)).toEqual(['Verse', '2.1 60% Hold'])
})
it('diffs output, schedules beat messages with timestamps and cancels stale future colours', () => {
  let now = 0
  const output = { send: vi.fn(), clear: vi.fn() },
    budget = new FeedbackBudget(),
    sender = new DiffOutput(output, 'a', budget, () => now, vi.fn())
  sender.write('pad.1', [1], 0)
  sender.flush()
  sender.write('pad.1', [1], 0)
  sender.flush()
  expect(output.send).toHaveBeenCalledExactlyOnceWith([1], 0)
  sender.write('pad.1', [2], 100)
  sender.flush()
  expect(output.send).toHaveBeenCalledTimes(1)
  now = 80
  sender.flush()
  expect(output.send.mock.lastCall).toEqual([[2], 100])
  expect(sender.hasFuture()).toBe(true)
  sender.invalidateFuture()
  expect(output.clear).toHaveBeenCalledOnce()
  sender.write('pad.1', [1])
  sender.flush()
  expect(output.send).toHaveBeenCalledTimes(2)
  sender.forget('pad.1')
  sender.write('pad.1', [1])
  sender.flush()
  expect(output.send).toHaveBeenCalledTimes(3)
})
it('coalesces overload and enforces the global 100-message sliding window across devices', () => {
  let now = 0
  const a = { send: vi.fn(), clear: vi.fn() },
    b = { send: vi.fn(), clear: vi.fn() },
    budget = new FeedbackBudget(),
    one = new DiffOutput(a, 'a', budget, () => now, vi.fn()),
    two = new DiffOutput(b, 'b', budget, () => now, vi.fn())
  for (let i = 0; i < 80; i++) one.write('a' + i, [i])
  one.flush()
  for (let i = 0; i < 80; i++) two.write('b' + i, [i])
  two.flush()
  expect(a.send.mock.calls.length + b.send.mock.calls.length).toBe(100)
  two.write('b79', [99])
  now = 1000
  two.flush()
  expect(a.send.mock.calls.length + b.send.mock.calls.length).toBe(160)
  expect(b.send.mock.lastCall?.[0]).toEqual([99])
})
it('restores budget for cancelled future packets and isolates output failures', () => {
  let now = 0
  const warn = vi.fn(),
    output = { send: vi.fn(), clear: vi.fn() },
    budget = new FeedbackBudget(1),
    sender = new DiffOutput(output, 'a', budget, () => now, warn)
  sender.write('p', [1], 20)
  sender.flush()
  now = 5
  sender.invalidateFuture()
  sender.write('p', [2])
  sender.flush()
  expect(output.send).toHaveBeenCalledTimes(2)
  const broken = new DiffOutput(
    {
      send: () => {
        throw Error('gone')
      },
      clear: vi.fn(),
    },
    'b',
    new FeedbackBudget(),
    () => 0,
    warn,
  )
  broken.write('p', [1])
  broken.flush()
  broken.flush()
  expect(warn).toHaveBeenCalledExactlyOnceWith('Error: gone')
})
it('keeps future packets cancellable inside the engine when MIDIOutput.clear is unavailable', () => {
  let now = 80
  const output = { send: vi.fn() },
    sender = new DiffOutput(
      output,
      'a',
      new FeedbackBudget(),
      () => now,
      vi.fn(),
    )
  sender.write('pad.1', [1], 100)
  sender.flush()
  expect(output.send).not.toHaveBeenCalled()
  sender.invalidateFuture()
  now = 110
  sender.flush()
  expect(output.send).not.toHaveBeenCalled()
  sender.write('pad.1', [2], 200)
  now = 201
  sender.flush()
  expect(output.send).toHaveBeenCalledExactlyOnceWith([2], 200)
})
it('places script colours above bindings and below beat, hit and queued feedback', () => {
  const s = state()
  s.project.mappings[profile.id].beatChase='top'
  s.scriptPads = { 'pad.2': '#b07cff' }
  s.scriptDisplay = ['Scene', 'Strings']
  expect(screenLines(s)).toEqual(['Scene', 'Strings'])
  expect(
    controlFrame(profile, s, { time: 0, blink: true })['pad.2'].color,
  ).toBe('#b07cff')
  s.playing = true
  expect(
    controlFrame(profile, s, { time: 0, blink: true, beat: 2 })['pad.2'].color,
  ).not.toBe('#b07cff')
})

it('shows clip identity and stopped, queued and playing binding feedback', () => {
  const s = state()
  s.project.mappings[profile.id].bindings=[]
  s.project.clips = [clip('break', { color: '#ff9f43' })]
  s.project.base.bindings.push({
    control: 'pad.1',
    edge: 'press',
    action: { type: 'clip', cmd: 'launch', clipId: 'break' },
  })
  s.runtime.clips.break = 'stopped'
  expect(
    controlFrame(profile, s, { time: 0, blink: false })['pad.1'],
  ).toMatchObject({ state: 'idle', color: '#ff9f43', level: 0.2 })
  s.runtime.clips.break = 'queued'
  expect(
    controlFrame(profile, s, { time: 0, blink: false })['pad.1'],
  ).toMatchObject({ state: 'queued', level: 0.12 })
  expect(
    controlFrame(profile, s, { time: 0, blink: true })['pad.1'].level,
  ).toBe(1)
  s.runtime.clips.break = 'playing'
  expect(
    controlFrame(profile, s, { time: 0, blink: false })['pad.1'],
  ).toMatchObject({ state: 'on', color: '#ff9f43', level: 1 })
})
