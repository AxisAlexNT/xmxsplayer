import { expect, it } from 'vitest'
import { TempoTrack } from '../../src/engine/follow/tempo-track'
import { TransportClock } from '../../src/engine/transport/clock'
import { TimeMap } from '../../src/shared/time-map'
import { liveProject } from '../../src/shared/template'
function rig(step = 480, count = 80) {
  let now = 0
  const project = liveProject('Tempo'),
    lead = project.tracks[0]
  if (lead.kind !== 'midi') throw Error('MIDI')
  lead.leads = true
  lead.notes = Array.from({ length: count }, (_, i) => [
    i * step,
    120,
    60 + (i % 16),
    100,
  ])
  project.tempos = [{ tick: 0, bpm: 120 }]
  project.lengthTicks = count * step + 1920
  project.follow.mode = 'tempoTrack'
  const clock = new TransportClock(new TimeMap(project), () => now)
  const follower = new TempoTrack({
    clock,
    apply: (factor) => clock.setFollowFactor(factor),
  })
  follower.configure(project)
  clock.play()
  const advance = (target: number) => {
    while (now < target - 1e-8) {
      now = Math.min(target, now + 0.01)
      follower.tick()
    }
  }
  const note = (key: number, live = true) =>
    follower.note({
      id: 'key',
      source: 'keys',
      channel: 0,
      trackId: lead.id,
      key,
      velocity: 100,
      on: true,
      when: now,
      live,
    })
  return { project, clock, follower, advance, note }
}
for (const [name, speed] of [
  ['faster', 1.3],
  ['slower', 0.7],
] as const)
  it(`converges for a steady ${name} performance with position error below a beat`, () => {
    const r = rig()
    let error = 0
    for (let i = 0; i < 60; i++) {
      r.advance((i * 0.5) / speed)
      error = Math.max(error, Math.abs(r.clock.tick - i * 480))
      r.note(60 + (i % 16))
    }
    expect(r.follower.factor).toBeCloseTo(speed, 3)
    expect(error).toBeLessThan(480)
  })
it('tracks accelerando and ignores twenty percent nonmatching wrong notes', () => {
  const r = rig()
  let time = 0,
    error = 0,
    speed = 1
  for (let i = 0; i < 60; i++) {
    speed = 1 + i * 0.006
    r.advance(time)
    error = Math.max(error, Math.abs(r.clock.tick - i * 480))
    if (i % 5 !== 2) r.note(60 + (i % 16))
    else {
      const factor = r.follower.factor
      r.note(30)
      expect(r.follower.factor).toBe(factor)
    }
    time += 0.5 / speed
  }
  expect(r.follower.factor).toBeCloseTo(speed, 1)
  expect(error).toBeLessThan(480)
})
it('keeps running through a skipped bar and reacquires a dense melody', () => {
  const r = rig(120, 240)
  let error = 0
  for (let i = 0; i < 200; i++) {
    r.advance((i * 0.125) / 1.2)
    if (i >= 64 && i < 80) continue
    error = Math.max(error, Math.abs(r.clock.tick - i * 120))
    r.note(60 + (i % 16))
  }
  expect(r.follower.factor).toBeCloseTo(1.2, 2)
  expect(error).toBeLessThan(480)
  expect(r.clock.playing).toBe(true)
})
it('does not estimate twice from a chord, automation, releases or a cue hold', () => {
  const r = rig()
  r.note(60)
  r.advance(0.4)
  r.note(61)
  const factor = r.follower.factor
  r.note(61)
  r.note(62, false)
  expect(r.follower.factor).toBe(factor)
  r.clock.hold()
  r.follower.tick()
  r.advance(2)
  r.note(62)
  expect(r.follower.factor).toBe(factor)
  r.clock.release()
  r.follower.tick()
  r.note(62)
  expect(r.follower.factor).toBe(factor)
})
it('eases back to written speed over two bars and resets on stop', () => {
  const r = rig()
  for (let i = 0; i < 20; i++) {
    r.advance((i * 0.5) / 1.3)
    r.note(60 + (i % 16))
  }
  const start = r.clock.raw,
    before = r.clock.followFactor
  r.project.follow.mode = 'written'
  r.follower.configure(r.project)
  expect(r.clock.followFactor).toBe(before)
  while (r.clock.raw < start + 2) r.advance(r.clock.now() + 0.01)
  expect(r.clock.followFactor).toBeGreaterThan(1)
  expect(r.clock.followFactor).toBeLessThan(before)
  expect(r.clock.followFactor).toBeCloseTo(1 + (before - 1) / 2, 2)
  while (r.clock.raw < start + 4.01) r.advance(r.clock.now() + 0.01)
  expect(r.clock.followFactor).toBe(1)
  r.clock.pause()
  r.follower.tick()
  expect(r.clock.followFactor).toBe(1)
})
it('keeps a learned factor without notes, clamps its estimate and resets on stop', () => {
  const r = rig()
  r.project.follow.range = [0.8, 1.1]
  r.follower.configure(r.project)
  for (let i = 0; i < 16; i++) {
    r.advance((i * 0.5) / 1.4)
    r.note(60 + (i % 16))
  }
  expect(r.follower.factor).toBe(1.1)
  const factor = r.follower.factor
  r.advance(r.clock.now() + 3)
  expect(r.follower.factor).toBe(factor)
  expect(r.clock.followFactor).toBe(factor)
  expect(r.clock.holding).toBe(false)
  r.clock.pause()
  r.follower.tick()
  expect(r.clock.followFactor).toBe(1)
})
it('normalizes intervals to the written tempo map and the user speed', () => {
  const r = rig()
  r.project.tempos = [
    { tick: 0, bpm: 120 },
    { tick: 9600, bpm: 160 },
  ]
  r.clock.setMap(new TimeMap(r.project))
  r.clock.setRate(0.75)
  r.follower.configure(r.project)
  let error = 0
  for (let i = 0; i < 50; i++) {
    const tick = i * 480
    r.advance(r.clock.map.tickToSec(tick) / (0.75 * 1.2))
    error = Math.max(error, Math.abs(r.clock.tick - tick))
    r.note(60 + (i % 16))
  }
  expect(r.follower.factor).toBeCloseTo(1.2, 2)
  expect(error).toBeLessThan(480)
})
it('matches across loop boundaries without resetting the learned tempo', () => {
  const r = rig()
  r.project.loop = { enabled: true, startTick: 480, endTick: 2400 }
  r.clock.setLoop(r.project.loop)
  r.follower.configure(r.project)
  let error = 0
  for (let i = 0; i < 40; i++) {
    r.advance((i * 0.5) / 1.2)
    error = Math.max(error, Math.abs(r.clock.raw - i * 0.5) * 960)
    const index = i < 5 ? i : 1 + ((i - 5) % 4)
    r.note(60 + index)
  }
  expect(r.follower.factor).toBeCloseTo(1.2, 2)
  expect(error).toBeLessThan(480)
})
it('ignores count-in notes and starts a fresh interval after a seek', () => {
  const r = rig()
  r.clock.pause()
  r.clock.seek(0)
  r.clock.play(2)
  r.note(60)
  expect(r.follower.expected?.tick).toBe(0)
  r.advance(2)
  r.note(60)
  r.advance(2.4)
  r.note(61)
  expect(r.follower.factor).toBeGreaterThan(1)
  const learned = r.follower.factor
  r.clock.seek(4800)
  r.follower.reset()
  r.note(70)
  expect(r.follower.factor).toBe(learned)
  expect(r.follower.expected?.tick).toBe(5280)
})
it('applies a phase correction for a full beat rather than only until the next grid line', () => {
  const r = rig()
  r.note(60)
  r.advance(0.45)
  r.note(61)
  const adjusted = r.clock.followFactor,
    start = r.clock.raw
  expect(adjusted).toBeGreaterThan(r.follower.factor)
  while (r.clock.raw < start + 0.25) r.advance(r.clock.now() + 0.005)
  expect(r.clock.followFactor).toBe(adjusted)
  while (r.clock.raw < start + 0.51) r.advance(r.clock.now() + 0.005)
  expect(r.clock.followFactor).toBe(r.follower.factor)
})
it('starts a fresh estimate interval when the user changes Speed', () => {
  const r = rig()
  for (let i = 0; i < 12; i++) {
    r.advance((i * 0.5) / 1.2)
    r.note(60 + (i % 16))
  }
  const learned = r.follower.factor
  r.clock.setRate(0.75)
  r.follower.tick()
  r.advance(r.clock.now() + 0.1)
  r.note(r.follower.expected!.keys[0])
  expect(r.follower.factor).toBe(learned)
})
it('tracks accelerando without missed notes', () => {
  const r = rig()
  let time = 0,
    error = 0
  for (let i = 0; i < 60; i++) {
    r.advance(time)
    error = Math.max(error, Math.abs(r.clock.tick - i * 480))
    r.note(60 + (i % 16))
    time += 0.5 / (1 + i * 0.006)
  }
  expect(r.follower.factor).toBeCloseTo(1 + 59 * 0.006, 1)
  expect(error).toBeLessThan(480)
})
it('converges with exactly twenty percent of expected notes replaced by wrong pitches', () => {
  const r = rig()
  let wrong = 0,
    error = 0
  for (let i = 0; i < 60; i++) {
    r.advance((i * 0.5) / 1.2)
    error = Math.max(error, Math.abs(r.clock.tick - i * 480))
    if (i % 5 === 2) {
      r.note(30)
      wrong++
    } else r.note(60 + (i % 16))
  }
  expect(wrong / 60).toBe(0.2)
  expect(r.follower.factor).toBeCloseTo(1.2, 2)
  expect(error).toBeLessThan(480)
})
it('recovers gradually when the performer jumps forward by a bar', () => {
  const r = rig()
  let recoveredError = 0
  for (let i = 0; i < 60; i++) {
    r.advance((i * 0.5) / 1.2)
    const score = i < 16 ? i : i + 4
    if (i > 36)
      recoveredError = Math.max(
        recoveredError,
        Math.abs(r.clock.tick - score * 480),
      )
    r.note(60 + (score % 16))
  }
  expect(r.follower.factor).toBeCloseTo(1.2, 2)
  expect(recoveredError).toBeLessThan(480)
})
