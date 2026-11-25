import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import create from 'verovio/wasm'
import { VerovioToolkit } from 'verovio/esm'
import { VerovioHost, layoutOptions } from '../../src/ui/notation/verovio-host'
import { parseMidi } from 'midi-file'
let host: VerovioHost
beforeAll(async () => {
  host = new VerovioHost(new VerovioToolkit(await create()))
})
afterAll(() => host.toolkit.destroy())
function xml(): string {
  const n = (key: string, duration: number) =>
    `<note><pitch><step>${key}</step><octave>4</octave></pitch><duration>${duration}</duration><type>${duration===960?'half':'quarter'}</type></note>`
  return `<score-partwise><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>480</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>${n('C', 480)}${n('D', 480)}${n('E', 960)}</measure>${[2, 3, 4].map((i) => `<measure number="${i}"><note><rest measure="yes"/><duration>1920</duration></note></measure>`).join('')}</part></score-partwise>`
}
describe('installed Verovio', () => {
  it('accepts all requested options and uses screen-width units', () => {
    const opts = layoutOptions({ pageWidth: 1200, scale: 40 })
    host.toolkit.setOptions(opts)
    const actual = host.toolkit.getOptions()
    for (const [k, v] of Object.entries(opts))
      expect(actual[k as keyof typeof actual]).toEqual(v)
  })
  it('renders timemap notes, rests, measures, staff indices and MIDI with one system per page', () => {
    const info = host.load(xml(), { pageWidth: 800, scale: 40 })
    expect(info.version).toMatch(/^6\.4\.1/)
    expect(info.pageCount).toBeGreaterThan(0)
    expect(
      info.timemap.filter((n) => n.key !== undefined).map((n) => n.key),
    ).toEqual([60, 62, 64])
    expect(
      info.timemap.filter((n) => n.key !== undefined).map((n) => n.end),
    ).toEqual([1, 2, 4])
    expect(info.measures).toHaveLength(4)
    expect(info.timemap.every((n) => n.staff === 1)).toBe(true)
    const svg = host.render(1)
    expect(svg.match(/class="system"/g)).toHaveLength(1)
    expect(svg).toContain('viewBox="0 0 800')
    const midi = parseMidi(new Uint8Array(Buffer.from(host.midi(), 'base64')))
    expect(midi.header.numTracks).toBe(2)
  })
  it('relayouts and rejects invalid pages and malformed XML', () => {
    host.load(xml(), { pageWidth: 800, scale: 40 })
    expect(
      host.relayout({ pageWidth: 400, scale: 60 }).pageCount,
    ).toBeGreaterThan(0)
    expect(() => host.render(0)).toThrow(/Invalid/)
    expect(() => host.load('<bad>', { pageWidth: 800, scale: 40 })).toThrow()
  })
})

it('renders both piano staves in one part and preserves melody duration', async () => {
  const {liveProject}=await import('../../src/shared/template')
  const {notesToMusicXml}=await import('../../src/ui/notation/notes-to-musicxml')
  const project=liveProject('Piano')
  project.lengthTicks=1920
  const track=project.tracks[0]
  if(track.kind!=='midi') throw Error('Expected MIDI')
  track.notes=[[0,960,72,100],[0,240,48,80],[240,240,55,80]]
  const info=host.load(notesToMusicXml(track,project),{pageWidth:800,scale:40})
  expect(info.timemap.find(n=>n.key===72)).toMatchObject({staff:1,end:2})
  expect(info.timemap.find(n=>n.key===55)).toMatchObject({staff:2})
  expect(host.render(1)).toContain('class="staff"')
})
