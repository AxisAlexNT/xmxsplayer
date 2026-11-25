import { fromFiles, toFiles } from '../../src/shared/project-files'
import { expect, it } from 'vitest'
import { Recorder } from '../../src/engine/transport/recorder'
import { TransportClock } from '../../src/engine/transport/clock'
import { TimeMap } from '../../src/shared/time-map'
import { liveProject } from '../../src/shared/template'
import type { RecordedTake, RecordingProgress } from '../../src/shared/recording'
function rig(latency = 0) {
  const p = liveProject('Record')
  const track = p.tracks[0]
  if (track.kind !== 'midi') throw Error('Expected MIDI')
  track.armed = true
  let now = 0
  const clock = new TransportClock(new TimeMap(p), () => now),
    progress: RecordingProgress[] = [],
    takes: RecordedTake[] = [],
    recorder = new Recorder(
      clock,
      () => p,
      () => latency,
      (t) => takes.push(t),
      frame => progress.push(frame),
    )
  recorder.setScope('project')
  const note = (on: boolean, key = 60, id = 'key') =>
    recorder.note({
      id,
      source: 'keys',
      channel: 0,
      trackId: track.id,
      key,
      velocity: 100,
      on,
    })
  return {
    p,
    track,
    clock,
    recorder,
    takes,
    progress,
    note,
    set: (t: number) => {
      now = t
    },
    start: (rate = 1, lead = 0) => {
      clock.setRate(rate)
      clock.recording = true
      clock.play(lead)
      recorder.clockChanged()
    },
    stop: () => {
      clock.pause()
      recorder.clockChanged()
    },
  }
}
it('maps compensated notes at 60 percent speed and emits one stopped take', () => {
  const r = rig(100)
  r.start(0.6)
  r.set(0.5)
  r.note(true)
  r.set(1)
  r.note(false)
  expect(r.takes).toEqual([])
  r.stop()
  expect(r.takes[0].tracks[0].notes).toEqual([[230, 288, 60, 100]])
})
it('splits a held note at loop wrap and continues from the loop start', () => {
  const r = rig()
  r.clock.setLoop({ enabled: true, startTick: 480, endTick: 960 })
  r.start(0.6)
  r.set(1.5)
  r.note(true)
  r.set(1.7)
  r.recorder.tick()
  expect(r.takes[0].tracks[0].notes).toEqual([[864, 96, 60, 100]])
  r.set(2)
  r.note(false)
  r.stop()
  expect(r.takes[1].tracks[0].notes).toEqual([[480, 192, 60, 100]])
})
it('delays wrap finalization for input latency and preserves notes arriving near the boundary', () => {
  const r = rig(100)
  r.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  r.start()
  r.set(1.02)
  r.recorder.tick()
  expect(r.takes).toHaveLength(0)
  r.note(true)
  r.set(1.2)
  r.recorder.tick()
  expect(r.takes[0].tracks[0].notes).toEqual([[883, 77, 60, 100]])
  r.set(1.3)
  r.note(false)
  r.stop()
  expect(r.takes[1].tracks[0].notes).toEqual([[0, 192, 60, 100]])
})
it('ignores count-in notes, captures controllers and remembers pedal release across routing changes', () => {
  const r = rig()
  r.start(1, 1)
  r.set(0.2)
  r.note(true)
  r.set(0.3)
  r.note(false)
  r.set(1.2)
  r.recorder.control('keys', 0, 'cc', 64, 127, [r.track.id])
  r.note(true)
  r.set(1.4)
  r.note(false)
  r.set(1.5)
  r.recorder.control('keys', 0, 'bend', 0, 12000, [r.track.id])
  r.set(1.6)
  r.recorder.control('keys', 0, 'cc', 1, 80, [r.track.id])
  r.set(1.7)
  r.recorder.control('keys', 0, 'cc', 64, 0, [])
  r.stop()
  const t = r.takes[0].tracks[0]
  expect(t.notes).toEqual([[192, 192, 60, 100]])
  expect(t.events).toContainEqual({ tick: 672, type: 'cc', num: 64, value: 0 })
  expect(t.events).toContainEqual({
    tick: 480,
    type: 'bend',
    num: 0,
    value: 12000,
  })
  expect(t.events).toContainEqual({ tick: 576, type: 'cc', num: 1, value: 80 })
})
it('keeps an active overdub intact when note data reloads with equivalent maps', () => {
  const r = rig()
  r.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  r.start()
  r.set(1.1)
  r.recorder.tick()
  r.clock.setMap(new TimeMap(r.p))
  r.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  r.recorder.clockChanged()
  r.note(true)
  r.set(1.4)
  r.note(false)
  r.stop()
  expect(r.takes).toHaveLength(1)
  expect(r.takes[0].tracks[0].notes).toEqual([[96, 288, 60, 100]])
})
it('splits a take on seek and discards pending input when the project changes', () => {
  const r = rig()
  r.start()
  r.set(0.2)
  r.note(true)
  r.set(0.5)
  r.clock.seek(1920)
  r.recorder.clockChanged()
  expect(r.takes[0].tracks[0].notes).toEqual([[192, 288, 60, 100]])
  r.note(false)
  r.note(true)
  r.recorder.setScope('other')
  r.stop()
  expect(r.takes).toHaveLength(1)
})
it('uses the previous clock segment for latency around a speed change', () => {
  const r = rig(100)
  r.start()
  r.set(0.5)
  r.clock.setRate(0.5)
  r.recorder.clockChanged()
  r.set(0.55)
  r.recorder.note({
    id: 'late',
    source: 'keys',
    channel: 0,
    trackId: r.track.id,
    key: 64,
    velocity: 80,
    on: true,
    when: 0.48,
  })
  r.set(1.1)
  r.recorder.note({
    id: 'late',
    source: 'keys',
    channel: 0,
    trackId: r.track.id,
    key: 64,
    velocity: 80,
    on: false,
    when: 1.1,
  })
  r.stop()
  expect(r.takes[0].tracks[0].notes).toEqual([[365, 355, 64, 80]])
})
it('groups armed tracks in the same take', () => {
  const r = rig()
  r.p.tracks.push({ ...r.track, id: 'second' })
  r.start()
  r.set(0.1)
  for (const trackId of [r.track.id, 'second'])
    r.recorder.note({
      id: trackId,
      source: 'keys',
      channel: 0,
      trackId,
      key: 60,
      velocity: 100,
      on: true,
    })
  r.set(0.3)
  r.stop()
  expect(r.takes).toHaveLength(1)
  expect(r.takes[0].tracks).toHaveLength(2)
})
it('replaces through silence at half speed and keeps the last loop pass', () => {
  const r = rig()
  r.p.record = { mode: 'replace', preRollBars: 0 }
  r.clock.setLoop({ enabled: true, startTick: 0, endTick: 960 })
  r.start(0.5)
  r.set(0.25)
  r.note(true)
  r.set(0.5)
  r.note(false)
  r.set(2.5)
  r.stop()
  expect(r.takes).toHaveLength(1)
  expect(r.takes[0].tracks[0]).toMatchObject({
    covered: [
      [0, 960],
      [0, 240],
    ],
    notes: [],
  })
})
it('starts coverage and accepts notes only from the punch tick', () => {
  const r = rig()
  r.p.record = { mode: 'replace', preRollBars: 1 }
  r.clock.punchRaw = 1
  r.start()
  r.set(0.5)
  r.note(true)
  r.set(1.5)
  r.stop()
  expect(r.takes[0].tracks[0]).toMatchObject({
    covered: [[960, 1440]],
    notes: [],
  })
})
it('publishes open notes at bar boundaries and coalesces closes during fast playing', () => {
  const r = rig()
  r.start(1, 1)
  r.set(0.3)
  r.recorder.tick()
  expect(r.progress).toHaveLength(0)
  r.set(2.99)
  r.note(true)
  r.set(3)
  r.recorder.tick()
  expect(r.progress.at(-1)).toMatchObject({ barEnd: 1920, tracks: [{open:[{key:60}], closed:[]}] })
  const count = r.progress.length
  r.set(3.01)
  r.note(false)
  expect(r.progress).toHaveLength(count)
  r.set(3.11)
  r.recorder.tick()
  expect(r.progress.at(-1)?.tracks[0].open).toEqual([])
  expect(r.progress.at(-1)?.tracks[0].closed).toHaveLength(1)
  r.stop()
  expect(r.takes[0].takeId).toBe(r.progress.at(-1)?.takeId)
})

it('reopens held keys at the loop start in the next progress snapshot', () => {
  const r = rig()
  r.clock.setLoop({ enabled: true, startTick: 480, endTick: 960 })
  r.start()
  r.set(0.75)
  r.note(true)
  r.set(1)
  r.recorder.tick()
  expect(r.takes[0].tracks[0].notes).toEqual([[720, 240, 60, 100]])
  expect(r.progress.at(-1)?.tracks[0]).toMatchObject({
    closed: [], open: [{key:60, tick:480, vel:100}],
  })
})

it('exports a pedal held before record when modulation arrives before the first note', () => {
  const r = rig()
  r.recorder.control('keys', 0, 'cc', 64, 127, [])
  r.start()
  r.set(0.25)
  r.recorder.control('keys', 0, 'cc', 1, 80, [r.track.id])
  r.set(0.5)
  r.note(true)
  r.set(0.75)
  r.note(false)
  r.set(1)
  r.stop()
  r.track.notes = r.takes[0].tracks[0].notes
  r.track.events = r.takes[0].tracks[0].events
  const reopened = fromFiles(toFiles(r.p)).tracks[0]
  expect(reopened.kind === 'midi' && reopened.events).toEqual([
    {tick:240, type:'cc', num:1, value:80},
    {tick:480, type:'cc', num:64, value:127},
    {tick:960, type:'cc', num:64, value:0},
  ])
})

it('clears a disconnected controller pedal before the next recording', () => {
  const r = rig()
  r.recorder.control('keys', 0, 'cc', 64, 127, [])
  r.recorder.disconnect('keys')
  r.start()
  r.note(true)
  r.set(0.5)
  r.stop()
  expect(r.takes[0].tracks[0].events).toEqual([{tick:0, type:'cc', num:64, value:0}])
})

it('closes the previous loop with pedal up when a release crosses the wrap', () => {
  const r = rig()
  r.clock.setLoop({enabled:true, startTick:0, endTick:960})
  r.start()
  r.recorder.control('keys', 0, 'cc', 64, 127, [r.track.id])
  r.note(true)
  r.set(1.125)
  r.recorder.control('keys', 0, 'cc', 64, 0, [r.track.id])
  r.note(false)
  r.stop()
  expect(r.takes[0].tracks[0].events.at(-1)).toEqual({tick:960, type:'cc', num:64, value:0})
  expect(r.takes[1].tracks[0].events).toEqual([
    {tick:0, type:'cc', num:64, value:127},
    {tick:120, type:'cc', num:64, value:0},
  ])
})
