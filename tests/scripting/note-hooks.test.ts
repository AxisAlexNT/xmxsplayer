import { expect, it } from 'vitest'
import { NoteHooks } from '../../src/engine/script/note-hooks'
import type { KeyEvent } from '../../src/shared/script-api'
it('releases transformed layers using press-time keys across reload, drops and disconnect', () => {
  const sent: { note: KeyEvent; inputKey?: number }[] = []
  let transpose = true
  const hooks = new NoteHooks(
    (e) =>
      transpose
        ? e.key === 61
          ? []
          : [
              { ...e, key: 72 },
              { ...e, key: 67 },
            ]
        : [e],
    (note, _source, _when, inputKey) => sent.push({ note, inputKey }),
  )
  const note: KeyEvent = {
    deviceId: 'keys',
    channel: 0,
    key: 60,
    vel: 100,
    on: true,
  }
  hooks.receive(note)
  hooks.receive({ ...note, key: 61 })
  transpose = false
  hooks.receive({ ...note, key: 61, on: false })
  hooks.receive({ ...note, on: false })
  expect(sent.map((s) => [s.note.key, s.note.on, s.inputKey])).toEqual([
    [72, true, 60],
    [67, true, 60],
    [72, false, 60],
    [67, false, 60],
  ])
  hooks.receive({ ...note, key: 62 })
  hooks.disconnect('other')
  expect(sent).toHaveLength(5)
  hooks.disconnect('keys')
  expect(sent.at(-1)).toMatchObject({
    note: { key: 62, on: false },
    inputKey: 62,
  })
})
