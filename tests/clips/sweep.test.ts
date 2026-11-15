import { expect, it } from 'vitest'
import { Sweep } from '../../src/engine/clips/sweep'
import { clip } from './fixture'
it('starts moving on the first change, extends its release only on movement and stops at the deadline', () => {
  const sweep = new Sweep(clip().sweep)
  expect(sweep.change(0, 0)).toMatchObject({
    start: true,
    stop: false,
    semitones: -12,
    deadline: 300,
  })
  expect(sweep.change(0.5, 200)).toMatchObject({
    start: false,
    semitones: 0,
    deadline: 500,
  })
  expect(sweep.change(0.5, 400).deadline).toBe(500)
  expect(sweep.tick(499).stop).toBe(false)
  expect(sweep.tick(500)).toMatchObject({ stop: true, deadline: null })
  expect(sweep.tick(501).stop).toBe(false)
  expect(sweep.change(1, 600)).toMatchObject({ start: true, semitones: 12 })
})
it('keeps a position sweep running while still and maps the useful range above its off threshold', () => {
  const sweep = new Sweep({ ...clip().sweep, mode: 'position', offBelow: 0.02 })
  expect(sweep.change(0.02, 0)).toMatchObject({
    start: false,
    stop: false,
    semitones: -12,
  })
  expect(sweep.change(0.51, 20)).toMatchObject({
    start: true,
    semitones: 0,
    deadline: null,
  })
  expect(sweep.tick(100000).stop).toBe(false)
  expect(sweep.change(0.51, 100010).start).toBe(false)
  expect(sweep.change(0, 100020)).toMatchObject({ stop: true, semitones: -12 })
  const disabled = new Sweep({ ...clip().sweep, mode: 'position', offBelow: 1 })
  expect(disabled.change(1, 0)).toMatchObject({ start: false, semitones: -12 })
})
it('changes pitch without gating a pad-started clip in pitchOnly mode', () => {
  const sweep = new Sweep({ ...clip().sweep, mode: 'pitchOnly' })
  expect(sweep.change(0.75, 0)).toMatchObject({
    semitones: 6,
    start: false,
    stop: false,
    deadline: null,
  })
  expect(sweep.change(0, 30)).toMatchObject({
    semitones: -12,
    start: false,
    stop: false,
  })
  expect(sweep.tick(100000).stop).toBe(false)
})
it('accumulates relative encoders from the current pitch, clamps values and handles reversed ranges', () => {
  const sweep = new Sweep({ ...clip().sweep, mode: 'pitchOnly' }, 0)
  expect(sweep.change(0, 0, 0)).toMatchObject({ value: 0.5, start: false })
  expect(sweep.change(0, 1, 127).semitones).toBe(12)
  expect(sweep.change(0, 2, -254).semitones).toBe(-12)
  const reverse = new Sweep(
    { ...clip().sweep, mode: 'pitchOnly', range: [12, -12] },
    0,
  )
  expect(reverse.change(0.25, 0).semitones).toBe(6)
  expect(reverse.change(NaN, 1).semitones).toBe(6)
})
it('resets a gate without pretending a stationary moving control moved', () => {
  const sweep = new Sweep(clip().sweep)
  sweep.change(0.5, 0)
  sweep.reset()
  expect(sweep.change(0.5, 100).start).toBe(false)
  expect(sweep.change(0.51, 101).start).toBe(true)
  const position = new Sweep({ ...clip().sweep, mode: 'position' })
  position.change(0.5, 0)
  position.reset()
  expect(position.change(0.5, 100).start).toBe(true)
})
