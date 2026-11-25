import { expect, it } from 'vitest'
import { liveProject } from '../../src/shared/template'
import { displayProject } from '../../src/ui/stores/display'

it('extends only the displayed score and clips closed notes at the completed bar', () => {
  const project = liveProject('Take')
  const piano = project.tracks[0]
  if (piano.kind !== 'midi') throw Error('Expected piano track')
  piano.armed = true
  const original = piano.notes.slice()
  const display = displayProject(project, project.lengthTicks + 1920, {
    scope: 'test', takeId: 'one', barEnd: 1920,
    tracks: [{ trackId: piano.id, closed: [[1800, 240, 60, 90], [2000, 80, 63, 80]],
      open: [{ key: 65, tick: 1900, vel: 70 }] }],
  })
  expect(display.lengthTicks).toBe(project.lengthTicks + 1920)
  expect(display.tracks[0]).toMatchObject({ notes: [...original, [1800,120,60,90]] })
  expect(piano.notes).toEqual(original)
})
