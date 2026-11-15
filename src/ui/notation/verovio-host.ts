import type { VerovioToolkit } from 'verovio/esm'
import type { VerovioOptions } from 'verovio'
import {
  child,
  descendants,
  parseXml,
  serializeXml,
  type XmlElement,
} from './xml'
import type { NotationInfo, NotationOptions } from './protocol'
export function layoutOptions(options: NotationOptions): VerovioOptions {
  if (!Number.isFinite(options.pageWidth) || !Number.isFinite(options.scale))
    throw Error('Invalid notation layout')
  const scale = Math.max(10, Math.min(100, options.scale))
  return {
    breaks: 'auto',
    systemMaxPerPage: 1,
    adjustPageHeight: true,
    pageWidth: Math.max(500, Math.round((options.pageWidth * 100) / scale)),
    scale,
    header: 'none',
    footer: 'none',
    pageMarginLeft: 0,
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,
    svgViewBox: true,
    unit: 12,
    condense: 'none',
    minLastJustification: 0,
    xmlIdChecksum: true,
  }
}
export class VerovioHost {
  private loaded = false
  private midiData = ''
  constructor(readonly toolkit: VerovioToolkit) {}
  load(xml: string, options: NotationOptions): NotationInfo {
    this.loaded = false
    const doc = parseXml(xml)
    if (doc.documentElement.localName !== 'score-partwise')
      throw Error('Expected a MusicXML partwise score')
    if (!this.toolkit.setOptions(layoutOptions(options)))
      throw Error('Verovio rejected layout options')
    for (const name of ['part-name', 'part-abbreviation'])
      for (const el of descendants(doc, name))
        el.setAttribute('print-object', 'no')
    if (!this.toolkit.loadData(serializeXml(doc)))
      throw Error(this.toolkit.getLog() || 'Verovio could not load the score')
    this.loaded = true
    return this.info()
  }
  relayout(options: NotationOptions): NotationInfo {
    if (!this.loaded) throw Error('Load a score before laying it out')
    if (!this.toolkit.setOptions(layoutOptions(options)))
      throw Error('Verovio rejected layout options')
    this.toolkit.redoLayout()
    return this.info()
  }
  render(page: number): string {
    if (
      !this.loaded ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > this.toolkit.getPageCount()
    )
      throw Error('Invalid notation page')
    return this.toolkit.renderToSVG(page)
  }
  midi(): string {
    if (!this.loaded) throw Error('Load a score before exporting MIDI')
    return this.midiData
  }
  private info(): NotationInfo {
    this.midiData = this.toolkit.renderToMIDI()
    const mei = parseXml(this.toolkit.getMEI()),
      staves = new Map<string, number>()
    for (const staff of descendants(mei, 'staff')) {
      const n = Number(staff.getAttribute('n'))
      for (const el of [
        staff,
        ...Array.from(staff.getElementsByTagName('*')),
      ]) {
        const id = el.getAttribute('xml:id')
        if (id) staves.set(id, Number(el.getAttribute('staff')) || n)
      }
    }
    const entries = this.toolkit.renderToTimemap({
        includeMeasures: true,
        includeRests: true,
      }),
      notes: NotationInfo['timemap'] = [],
      measures: NotationInfo['measures'] = [],
      active = new Map<string, (typeof notes)[number]>()
    let end = 0
    for (const entry of entries) {
      const qstamp = entry.qstamp ?? 0
      end = Math.max(end, qstamp)
      for (const id of [...(entry.off ?? []), ...(entry.restsOff ?? [])]) {
        const note = active.get(id)
        if (note) note.end = qstamp
        active.delete(id)
      }
      if (entry.measureOn)
        measures.push({
          qstamp,
          id: entry.measureOn,
          page: this.toolkit.getPageWithElement(entry.measureOn),
          end: qstamp,
        })
      for (const id of [...(entry.on ?? []), ...(entry.restsOn ?? [])]) {
        const rest = entry.restsOn?.includes(id),
          note = {
            qstamp,
            id,
            page: this.toolkit.getPageWithElement(id),
            staff: staves.get(id) ?? 1,
            ...(!rest
              ? { key: this.toolkit.getMIDIValuesForElement(id).pitch }
              : {}),
          }
        notes.push(note)
        active.set(id, note)
      }
    }
    // A final empty measure may have no timemap note-offs; MEI still supplies its metrical duration.
    if (measures.length && end <= measures.at(-1)!.qstamp) {
      const scoreDef = child(descendants(mei, 'score')[0], 'scoreDef') as
        XmlElement | undefined
      const sig = scoreDef?.getAttribute('meter.count'),
        unit = scoreDef?.getAttribute('meter.unit')
      end =
        measures.at(-1)!.qstamp + (4 * (Number(sig) || 4)) / (Number(unit) || 4)
    }
    for (let i = 0; i < measures.length; i++)
      measures[i].end = measures[i + 1]?.qstamp ?? end
    return {
      pageCount: this.toolkit.getPageCount(),
      timemap: notes,
      measures,
      end,
      version: this.toolkit.getVersion(),
    }
  }
}
