import type { PdfDocument } from '../../shared/model'

export type PdfMarker = NonNullable<PdfDocument['markers']>[number]

/** Keep visible pages first, then warm the adjacent page on either side. */
export function renderPages(visible: ReadonlySet<number>, count: number): number[] {
  const pages = [...visible].filter(n => n >= 1 && n <= count).sort((a,b) => a-b)
  if (!pages.length) return []
  const candidates = [...pages, pages[0]-1, pages[pages.length-1]+1]
  return [...new Set(candidates.filter(n => n >= 1 && n <= count))].slice(0,6)
}

/** Page heights in CSS pixels. Mixed page sizes share the height of their tallest row. */
export function pagePositions(heights: number[], cols: PdfDocument['cols'], gap: number) {
  const tops: number[] = []
  let top = 0
  for (let start=0; start<heights.length; start+=cols) {
    const row = heights.slice(start,start+cols)
    tops.push(...row.map(() => top))
    top += Math.max(...row) + gap
  }
  return { tops, height: Math.max(0, top-gap) }
}

export function markerForBar(markers: readonly PdfMarker[], bar: number) {
  let selected: PdfMarker | undefined
  for (const marker of markers)
    if (marker.bar <= bar && (!selected || marker.bar >= selected.bar)) selected = marker
  return selected
}

export function markerScroll(marker: PdfMarker, tops: number[], heights: number[], viewport: number, total: number) {
  const index = marker.page-1
  if (tops[index] === undefined) return undefined
  const target = tops[index] + marker.y * heights[index] - viewport / 4
  return Math.max(0, Math.min(target, total - viewport))
}
