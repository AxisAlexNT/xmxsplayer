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
