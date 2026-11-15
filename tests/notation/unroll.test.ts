import { describe, expect, it } from 'vitest'
import { unrollScore } from '../../src/ui/notation/unroll'
import { descendants, parseXml, text } from '../../src/ui/notation/xml'
const score = (measures: string) =>
  `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`
const measure = (body = '', attrs = '') =>
  `<measure ${attrs}>${body}<note><rest/><duration>480</duration></note></measure>`
const forward =
    '<barline location="left"><repeat direction="forward"/></barline>',
  backward =
    '<barline location="right"><repeat direction="backward"/></barline>'
describe('repeat unrolling', () => {
  it('expands a simple repeat, strips repeat marks and removes duplicated IDs', () => {
    const r = unrollScore(score(measure(forward, 'id="m"') + measure(backward)))
    expect(r.sequence).toEqual([0, 1, 0, 1])
    const doc = parseXml(r.musicxml)
    expect(descendants(doc, 'repeat')).toHaveLength(0)
    expect(
      descendants(doc, 'measure').map((m) => m.getAttribute('number')),
    ).toEqual(['1', '2', '3', '4'])
    expect(descendants(doc, 'measure').some((m) => m.hasAttribute('id'))).toBe(
      false,
    )
  })
  it('handles first and second endings', () => {
    const xml = score(
      measure(forward) +
        measure('<barline><ending number="1" type="start"/></barline>') +
        measure(
          '<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline>',
        ) +
        measure('<barline><ending number="2" type="start"/></barline>') +
        measure('<barline><ending number="2" type="stop"/></barline>'),
    )
    expect(unrollScore(xml).sequence).toEqual([0, 1, 2, 0, 3, 4])
  })
  it('supports an implicit repeat from the start and nested repeats', () => {
    expect(unrollScore(score(measure() + measure(backward))).sequence).toEqual([
      0, 1, 0, 1,
    ])
    const r = unrollScore(
      score(
        measure(forward) +
          measure(forward) +
          measure(backward) +
          measure(backward),
      ),
    )
    expect(r.sequence).toEqual([0, 1, 2, 1, 2, 3, 0, 1, 2, 1, 2, 3])
  })
  it('restores inherited attributes when jumping back', () => {
    const r = unrollScore(
      score(
        measure(
          '<attributes><divisions>480</divisions><key><fifths>0</fifths></key></attributes>',
        ) +
          measure(forward) +
          measure(
            '<attributes><key><fifths>3</fifths></key></attributes>' + backward,
          ),
      ),
    )
    const ms = descendants(parseXml(r.musicxml), 'measure')
    expect(text(descendants(ms[3], 'key')[0], 'fifths')).toBe('0')
  })
  it('leaves jumps unchanged with a visible warning', () => {
    const xml = score(
        measure(
          '<direction><direction-type><words>D.S. al Coda</words></direction-type></direction>',
        ) + measure(backward),
      ),
      r = unrollScore(xml)
    expect(r.musicxml).toBe(xml)
    expect(r.warning).toMatch(/Repeat\/jump/)
    expect(r.sequence).toEqual([0, 1])
  })
})
