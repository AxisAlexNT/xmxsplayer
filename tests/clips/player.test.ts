import { afterEach, expect, it, vi } from 'vitest'
import { ClipPlayer, type ClipFrame } from '../../src/engine/clips/clip-player'
import { AudioClipVoice } from '../../src/engine/clips/clip-voice'
import { stretchNode } from '../../src/engine/audio/stretch'
import {
  Scheduler,
  type SchedulerOutput,
} from '../../src/engine/transport/scheduler'
import { TransportClock } from '../../src/engine/transport/clock'
import { newProject } from '../../src/shared/defaults'
import { TimeMap } from '../../src/shared/time-map'
import { clip, audioFixture } from './fixture'
vi.mock('../../src/engine/audio/stretch', () => ({ stretchNode: vi.fn() }))
const players: ClipPlayer[] = []
afterEach(() => {
  for (const player of players.splice(0)) player.close()
  vi.useRealTimers()
})
const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve()
}
function rig(definitions = [clip()], playing = true) {
  vi.useFakeTimers()
  let now = 0,
    deadline: number | null = null
  const p = newProject(),
    clock = new TransportClock(new TimeMap(p), () => now)
  const output = {
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    event: vi.fn(),
    beat: vi.fn(),
    boundary: vi.fn(),
    reset: vi.fn(),
    hasNote: () => false,
    chase: vi.fn(),
    collect: vi.fn(),
  } satisfies SchedulerOutput
  const scheduler = new Scheduler(clock, output)
  scheduler.setProject(p)
  if (playing) clock.play()
  const audio = new Map<string, ReturnType<typeof audioFixture>>(),
    voices = new Map<string, AudioClipVoice>(),
    frames: ClipFrame[] = [],
    warnings: string[] = []
  const prepare = vi.fn(async (c) => {
    const fixture = audioFixture(() => now)
    audio.set(c.id, fixture)
    vi.mocked(stretchNode).mockResolvedValueOnce({
      node: fixture.node,
      latency: 0.05,
    })
    const voice = await AudioClipVoice.create(fixture.route, fixture.decoded, c)
    voices.set(c.id, voice)
    return voice
  })
  const player = new ClipPlayer({
    clock,
    prepare,
    queue: (at, run) => scheduler.queue(at, run),
    cancel: (id) => scheduler.cancelAction(id),
    queuedTime: (id) => scheduler.queuedTime(id),
    holdDeadline: () => deadline,
    advance: () => scheduler.tick(),
    report: (frame) => frames.push(frame),
    warn: (message) => warnings.push(message),
  })
  players.push(player)
  player.configure(definitions)
  return {
    player,
    clock,
    scheduler,
    audio,
    voices,
    frames,
    warnings,
    prepare,
    setDeadline: (time: number | null) => {
      deadline = time
    },
    step: (time: number) => {
      now = time
      scheduler.tick()
      player.tick()
    },
  }
}
it('prepares only the fragment and schedules its first sample before the bar, without restarting on a late callback', async () => {
  const r = rig()
  r.step(0.1)
  r.player.launch('loop')
  await settle()
  expect(r.player.state('loop')).toBe('queued')
  const f = r.audio.get('loop')!,
    voice = r.voices.get('loop')!
  expect(vi.mocked(f.node.addBuffers).mock.calls[0][0][0]).toHaveLength(2000)
  expect(vi.mocked(f.node.addBuffers).mock.calls[0][0][0][0]).toBe(1000)
  expect(f.scheduled.find((s) => s.output === 2)).toMatchObject({
    input: 0,
    active: true,
    loopEnd: 2,
  })
  r.step(2.017)
  expect(r.player.state('loop')).toBe('playing')
  expect(voice.position(2.017).input).toBeCloseTo(0.017)
  expect(r.warnings).toEqual([])
})
it('cancels a queued start and can undo a queued stop without resetting the loop', async () => {
  const r = rig()
  r.step(0.1)
  r.player.launch('loop')
  await settle()
  r.player.launch('loop')
  expect(r.player.state('loop')).toBe('stopped')
  expect(
    r.audio.get('loop')!.scheduled.some((s) => s.output >= 2 && s.active),
  ).toBe(false)
  r.player.launch('loop')
  await settle()
  r.step(2.01)
  r.step(2.5)
  const before = r.voices.get('loop')!.position(2.5).input
  r.player.launch('loop')
  expect(r.player.state('loop')).toBe('queued')
  r.player.launch('loop')
  await settle()
  expect(r.player.state('loop')).toBe('playing')
  expect(r.voices.get('loop')!.position(2.5).input).toBeCloseTo(before)
  expect(
    r.audio.get('loop')!.scheduled.some((s) => s.output >= 4 && !s.active),
  ).toBe(false)
})
it('owns hold launches per source and releases a quick press before it can reach the bar', async () => {
  const r = rig([clip('held', { launch: 'hold' })])
  r.step(0.1)
  r.player.launch('held', true, 1, 'a')
  r.player.launch('held', true, 1, 'b')
  await settle()
  r.player.launch('held', false, 0, 'a')
  expect(r.player.state('held')).toBe('queued')
  r.player.launch('held', false, 0, 'b')
  expect(r.player.state('held')).toBe('stopped')
  r.step(2.1)
  expect(r.player.state('held')).toBe('stopped')
})
it('starts immediately while stopped, ignores releases for oneShot and stops at the fragment end', async () => {
  const r = rig([clip('hit', { launch: 'oneShot' })], false)
  r.player.launch('hit')
  await settle()
  expect(r.player.state('hit')).toBe('playing')
  expect(r.audio.get('hit')!.scheduled[0]).toMatchObject({
    active: true,
    input: 0,
    loopEnd: 0,
  })
  r.player.launch('hit', false)
  expect(r.player.state('hit')).toBe('playing')
  r.step(2.1)
  expect(r.player.state('hit')).toBe('stopped')
})
it('restarts a retrigger from zero and replaces group peers only at the queued boundary', async () => {
  const r = rig([
    clip('a', { quantize: 'now', group: 'drums', launch: 'retrigger' }),
    clip('b', { group: 'drums' }),
  ])
  r.player.launch('a')
  await settle()
  r.step(0.5)
  expect(r.voices.get('a')!.position(0.5).input).toBeCloseTo(0.5)
  r.player.launch('a')
  await settle()
  expect(r.voices.get('a')!.position(0.5).input).toBeCloseTo(0)
  r.player.launch('b')
  await settle()
  expect(r.player.state('a')).toBe('playing')
  expect(
    r.audio.get('a')!.scheduled.some((s) => !s.active && s.output === 2.01),
  ).toBe(true)
  r.step(2.017)
  expect(r.player.state('a')).toBe('stopped')
  expect(r.player.state('b')).toBe('playing')
  expect(r.voices.get('b')!.position(2.017).input).toBeCloseTo(0.017)
})
it('lets the last queued group launch win, including a previous load still in flight', async () => {
  const r = rig([clip('a', { group: 'drums' }), clip('b', { group: 'drums' })])
  r.step(0.1)
  r.player.launch('a')
  r.player.launch('b')
  await settle()
  expect(r.player.state('a')).toBe('stopped')
  expect(r.player.state('b')).toBe('queued')
  r.step(2.01)
  expect(r.player.state('a')).toBe('stopped')
  expect(r.player.state('b')).toBe('playing')
})
it('changes sync rate without jumping phase, freezes at a hold deadline and leaves unsynced clips running', async () => {
  const r = rig([
    clip('sync', { quantize: 'now' }),
    clip('free', { sync: false, quantize: 'now' }),
  ])
  r.player.launch('sync')
  r.player.launch('free')
  await settle()
  r.step(0.25)
  r.clock.setRate(0.5)
  r.player.tick()
  r.step(0.75)
  expect(r.voices.get('sync')!.position(0.75).input).toBeCloseTo(0.5)
  expect(r.voices.get('free')!.position(0.75).input).toBeCloseTo(0.75)
  r.clock.setFollowFactor(1.5)
  r.player.tick()
  r.setDeadline(1)
  r.player.tick()
  expect(
    r.audio.get('sync')!.scheduled.find((s) => s.output === 1),
  ).toMatchObject({ active: false })
  r.step(1)
  r.clock.hold()
  r.player.tick()
  r.step(1.5)
  expect(r.voices.get('sync')!.position(1.5).input).toBeCloseTo(0.6875)
  expect(r.voices.get('free')!.position(1.5).input).toBeCloseTo(1.5)
  r.setDeadline(null)
  r.clock.release()
  r.player.tick()
  r.step(2)
  expect(r.voices.get('sync')!.position(2).input).toBeCloseTo(1.0625)
})
it('cancels seek-cleared queues, closes removed media and does not relaunch after a delayed load', async () => {
  const r = rig()
  r.step(0.1)
  r.player.launch('loop')
  await settle()
  r.scheduler.clearActions()
  r.player.tick()
  expect(r.player.state('loop')).toBe('stopped')
  expect(
    r.audio.get('loop')!.scheduled.some((s) => s.output >= 2 && s.active),
  ).toBe(false)
  r.player.configure([])
  vi.advanceTimersByTime(40)
  expect(r.audio.get('loop')!.node.disconnect).toHaveBeenCalled()
})
it('does not launch or retain a voice that finishes loading after its project was reset', async () => {
  const r = rig()
  const fixture = audioFixture(() => 0)
  vi.mocked(stretchNode).mockResolvedValueOnce({
    node: fixture.node,
    latency: 0.05,
  })
  const voice = await AudioClipVoice.create(
    fixture.route,
    fixture.decoded,
    clip(),
  )
  let finish!: (voice: AudioClipVoice) => void
  r.prepare.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  r.player.launch('loop')
  await settle()
  r.player.reset()
  finish(voice)
  await settle()
  expect(r.player.state('loop')).toBe('stopped')
  expect(fixture.node.disconnect).toHaveBeenCalled()
  expect(fixture.scheduled.some((s) => s.active)).toBe(false)
  expect(r.warnings).toEqual([])
})
it('sends a tempo-map rate change to the worklet ahead of its deadline', async () => {
  const r = rig([clip('loop', { quantize: 'now' })])
  const project = newProject()
  project.tempos.push({ tick: 1920, bpm: 180 })
  r.clock.setMap(new TimeMap(project))
  r.player.tick()
  r.player.launch('loop')
  await settle()
  r.step(1.85)
  expect(
    r.audio.get('loop')!.scheduled.find((s) => s.output === 2),
  ).toMatchObject({ rate: 1.5, active: true })
  r.step(2.1)
  expect(r.voices.get('loop')!.position(2.1).input).toBeCloseTo(0.15)
})
it('releases a held clip using its original press after the launch mode is edited', async () => {
  const r = rig([clip('held', { launch: 'hold', quantize: 'now' })], false)
  r.player.launch('held', true, 1, 'pad')
  await settle()
  r.player.configure([clip('held', { launch: 'toggle', quantize: 'now' })])
  r.player.launch('held', false, 0, 'pad')
  expect(r.player.state('held')).toBe('stopped')
})
it('starts a synced clip silently at position zero during a hold and resumes its first sample on release', async () => {
  const r = rig([clip('held', { quantize: 'now' })])
  r.step(0.3)
  r.clock.hold()
  r.player.launch('held')
  await settle()
  expect(r.player.state('held')).toBe('playing')
  expect(r.audio.get('held')!.scheduled[0]).toMatchObject({
    active: false,
    input: 0,
  })
  r.step(1.3)
  expect(r.voices.get('held')!.position(1.3).input).toBeCloseTo(0)
  r.clock.release()
  r.player.tick()
  r.step(1.5)
  expect(r.voices.get('held')!.position(1.5).input).toBeCloseTo(0.2)
})
