import { expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { unpackMusicXml } from '../../src/main/score-xml'
it('reads the declared MusicXML root from a compressed score without writing ZIP entries', () => {
  const xml = '<score-partwise version="4.0"/>',
    bytes = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      'score.musicxml': strToU8(xml),
      'image.png': new Uint8Array(8),
    })
  expect(unpackMusicXml(bytes)).toBe(xml)
})
it('rejects malformed and missing-root compressed scores', () => {
  expect(() => unpackMusicXml(new Uint8Array([1, 2]))).toThrow()
  expect(() =>
    unpackMusicXml(zipSync({ 'part.musicxml': strToU8('<score/>') })),
  ).toThrow(/container/)
  expect(() =>
    unpackMusicXml(
      zipSync({ 'META-INF/container.xml': strToU8('<container/>') }),
    ),
  ).toThrow(/missing/)
})
