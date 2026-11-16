import { parseXml, serializeXml } from './xml'
import { PPQ } from '../../shared/model'
import type { NotationInfo } from './protocol'
import type { AxisPoint } from './protocol'
export interface StaffClip {
  center: number
  top: number
  bottom: number
}
export interface NotationPage {
  page: number
  id: string
  svg: SVGSVGElement
  width: number
  height: number
  clips: StaffClip[]
  points: AxisPoint[]
  notes: Map<string, { el: SVGElement; rect: DOMRect }>
}
const allowed = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'use',
  'text',
  'tspan',
  'rect',
  'line',
  'polyline',
  'polygon',
  'circle',
  'ellipse',
  'desc',
  'title',
  'clipPath',
])
export function sanitizeSvgXml(svg: string, prefix: string): string {
  const parsed = parseXml(svg),
    root = parsed.documentElement
  if (root.localName !== 'svg') throw Error('Invalid notation SVG')
  // Sanitize before browser parsing; SVG style elements can otherwise trigger CSP violations.
  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (!allowed.has(el.localName ?? el.tagName)) {
      el.parentNode?.removeChild(el)
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      if (
        /^on/i.test(attr.name) ||
        attr.name === 'style' ||
        attr.name === 'color'
      )
        el.removeAttribute(attr.name)
      else if (attr.localName === 'href') {
        if (attr.value.startsWith('#'))
          el.setAttributeNS(
            attr.namespaceURI,
            attr.name,
            '#' + prefix + attr.value.slice(1),
          )
        else el.removeAttribute(attr.name)
      } else if (attr.name === 'id') {
        el.setAttribute('data-vrv-id', attr.value)
        el.setAttribute('id', prefix + attr.value)
      } else if (/url\(/i.test(attr.value)) {
        if (/^url\(#[\w.-]+\)$/.test(attr.value))
          el.setAttribute(
            attr.name,
            attr.value.replace('url(#', `url(#${prefix}`),
          )
        else el.removeAttribute(attr.name)
      } else if (
        (attr.name === 'fill' || attr.name === 'stroke') &&
        attr.value !== 'none'
      )
        el.setAttribute(attr.name, 'currentColor')
    }
  }
  return serializeXml(parsed)
}
export function safeSvg(svg: string, prefix: string): SVGSVGElement {
  const native = new DOMParser().parseFromString(
    sanitizeSvgXml(svg, prefix),
    'image/svg+xml',
  )
  if (native.querySelector('parsererror')) throw Error('Invalid notation SVG')
  const result = document.importNode(
    native.documentElement,
    true,
  ) as unknown as SVGSVGElement
  result.classList.add('xm-vrv-page')
  return result
}

function rectangle(root: SVGSVGElement, el: SVGGraphicsElement): DOMRect {
  const b = el.getBBox(),
    ctm = el.getScreenCTM(),
    r = root.getScreenCTM()
  if (!ctm || !r) throw Error('Notation geometry is not attached')
  const matrix = r.inverse().multiply(ctm),
    a = new DOMPoint(b.x, b.y).matrixTransform(matrix),
    z = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(matrix)
  return new DOMRect(
    Math.min(a.x, z.x),
    Math.min(a.y, z.y),
    Math.abs(z.x - a.x),
    Math.abs(z.y - a.y),
  )
}
export function measurePage(
  svg: SVGSVGElement,
  page: number,
  info: NotationInfo,
  width: number,
): NotationPage {
  const box = svg.viewBox.baseVal,
    height = (box.height * width) / box.width
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  // Layout units and CSS pixels coincide after this outer coordinate normalization.
  const units = width / box.width
  const rect = (el: SVGGraphicsElement): DOMRect => {
    const r = rectangle(svg, el)
    return new DOMRect(
      r.x * units,
      r.y * units,
      r.width * units,
      r.height * units,
    )
  }
  const first = info.timemap
    .filter((n) => n.page === page + 1)
    .sort((a, b) => a.qstamp - b.qstamp)
  const earliest = first[0]?.qstamp
  const heads = first
    .filter((n) => n.qstamp === earliest)
    .flatMap((n) => {
      const el = [
        ...svg.querySelectorAll<SVGGraphicsElement>('[data-vrv-id]'),
      ].find((e) => e.getAttribute('data-vrv-id') === n.id)
      if (!el) return []
      const r = rect(el.querySelector<SVGGraphicsElement>('.notehead') ?? el)
      return [r.x + r.width / 2]
    })
  const lead = Math.min(...heads)
  if (lead < 96 && width > 96) {
    const scale = (width - 96) / (width - lead),
      shift = 96 - scale * lead
    const content = document.createElementNS(svg.namespaceURI, 'g')
    content.setAttribute('transform', `translate(${shift} 0) scale(${scale} 1)`)
    for (const node of [...svg.children])
      if (node.localName !== 'defs') content.appendChild(node)
    svg.appendChild(content)
  }
  const byId = new Map(
      [...svg.querySelectorAll<SVGGraphicsElement>('[data-vrv-id]')].map(
        (el) => [el.getAttribute('data-vrv-id')!, el],
      ),
    ),
    points: AxisPoint[] = [],
    notes = new Map<string, { el: SVGElement; rect: DOMRect }>()
  for (const entry of info.timemap.filter((n) => n.page === page + 1)) {
    const el = byId.get(entry.id)
    if (!el) continue
    const head = el.querySelector<SVGGraphicsElement>('.notehead') ?? el,
      r = rect(head)
    points.push({ tick: entry.qstamp * PPQ, x: r.x + r.width / 2 })
    if (entry.key !== undefined) notes.set(entry.id, { el, rect: r })
  }
  const measureElements = [
    ...svg.querySelectorAll<SVGGraphicsElement>('g.measure'),
  ]
  for (const entry of info.measures.filter((m) => m.page === page + 1)) {
    const el = byId.get(entry.id)
    if (!el) continue
    const staff = el.querySelector<SVGGraphicsElement>('g.staff')
    const lines = staff
      ? [...staff.children].filter(
          (n): n is SVGGraphicsElement =>
            n.localName === 'path' &&
            (n as SVGGraphicsElement).getBBox().height < 1,
        )
      : []
    const r = lines.map(rect).sort((a, b) => b.width - a.width)[0] ?? rect(el)
    const tick = entry.qstamp * PPQ
    points.push({
      tick,
      bar: true,
      x:
        entry === info.measures.find((m) => m.page === page + 1)
          ? Math.max(96, r.x)
          : r.x,
    })
    points.push({ tick: entry.end * PPQ, bar: true, x: r.x + r.width })
  }

  const staves = [
      ...(measureElements[0]?.querySelectorAll<SVGGraphicsElement>('g.staff') ??
        []),
    ],
    centres = staves.map((staff) => {
      const lines = [...staff.children].filter(
        (n): n is SVGGraphicsElement =>
          n.localName === 'path' &&
          (n as SVGGraphicsElement).getBBox().height < 1,
      )
      const boxes = (lines.length ? lines : [staff]).map(rect)
      return (
        (Math.min(...boxes.map((r) => r.y)) +
          Math.max(...boxes.map((r) => r.y + r.height))) /
        2
      )
    }),
    clips = centres.map((center, i) => ({
      center,
      top: i ? (centres[i - 1] + center) / 2 : 0,
      bottom: i + 1 < centres.length ? (center + centres[i + 1]) / 2 : height,
    }))
  if (!clips.length) throw Error('Notation page contains no staves')
  return { page, id: svg.id, svg, width, height, clips, points, notes }
}
