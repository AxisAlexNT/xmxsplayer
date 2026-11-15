import { expect, it } from 'vitest'
import { liveProject } from '../../src/shared/template'
import { sequenceSignature } from '../../src/engine/transport/signature'
it('separates mixer and view changes from events that require resequencing', () => {
  const p = liveProject('Mix'),
    initial = sequenceSignature(p)
  p.tracks[0].volume = 0.4
  p.tracks[0].pan = -0.3
  p.instruments[0].volume = 0.2
  p.instruments[0].reverb = 0.7
  p.view.follow = 'center'
  p.name = 'Renamed'
  expect(sequenceSignature(p)).toBe(initial)
  p.instruments[0].program = 48
  expect(sequenceSignature(p)).not.toBe(initial)
})
it('preserves the event timeline through scene routing, preset and mode edits', async () => {
  const { eventSignature } =
    await import('../../src/engine/transport/signature')
  const p = liveProject('Routing'),
    initial = eventSignature(p)
  p.instruments[0].program = 60
  p.base.patch[0].transpose = 12
  p.tracks[0].mode = 'auto'
  p.tracks[0].solo = true
  expect(eventSignature(p)).toBe(initial)
  if (p.tracks[0].kind === 'midi') p.tracks[0].notes = [[0, 480, 60, 100]]
  expect(eventSignature(p)).not.toBe(initial)
})
