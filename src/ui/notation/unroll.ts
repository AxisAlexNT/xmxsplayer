import {
  children,
  descendants,
  parseXml,
  serializeXml,
  type XmlElement,
} from './xml'
export interface UnrolledScore {
  musicxml: string
  sequence: number[]
  warning?: string
}
export function unrollScore(musicxml: string): UnrolledScore {
  const doc = parseXml(musicxml),
    root = doc.documentElement,
    parts = children(root, 'part'),
    measures = children(parts[0] ?? root, 'measure'),
    identity = measures.map((_, i) => i)
  const jumps =
    descendants(root, 'sound').some((n) =>
      ['dacapo', 'dalsegno', 'tocoda', 'segno', 'coda'].some((a) =>
        n.hasAttribute(a),
      ),
    ) ||
    ['segno', 'coda'].some((n) => descendants(root, n).length > 0) ||
    descendants(root, 'words').some((n) =>
      /\bD\.?\s*[CS]\.?\b|\bcoda\b|\bsegno\b/i.test(n.textContent ?? ''),
    )
  if (jumps)
    return {
      musicxml,
      sequence: identity,
      warning:
        'Repeat/jump structure not understood — staff may be misaligned; use Unroll Repeats in MuseScore',
    }
  const frames: { start: number; end: number; times: number }[] = [],
    stack: number[] = [],
    endings: {
      start: number
      end: number
      passes: number[]
      frame?: number
    }[] = []
  let open: (typeof endings)[number] | undefined
  measures.forEach((m, i) => {
    for (const bar of children(m, 'barline')) {
      for (const end of children(bar, 'ending')) {
        if (end.getAttribute('type') === 'start') {
          if (open) open.end = i - 1
          open = {
            start: i,
            end: measures.length - 1,
            passes: (end.getAttribute('number') ?? '1')
              .split(/[, ]+/)
              .map(Number)
              .filter((n) => n > 0),
          }
          endings.push(open)
        } else if (open) {
          open.end = i
          open = undefined
        }
      }
      for (const repeat of children(bar, 'repeat')) {
        if (repeat.getAttribute('direction') === 'forward') stack.push(i)
        else if (repeat.getAttribute('direction') === 'backward')
          frames.push({
            start: stack.pop() ?? 0,
            end: i,
            times: Math.max(
              1,
              Math.min(64, Number(repeat.getAttribute('times')) || 2),
            ),
          })
      }
    }
  })
  for (const ending of endings) {
    let distance = Infinity
    frames.forEach((f, i) => {
      const d =
        ending.start <= f.end && ending.end >= f.start
          ? 0
          : Math.abs(ending.start - f.end)
      if (d < distance) {
        distance = d
        ending.frame = i
      }
    })
  }
  const passes = frames.map(() => 1),
    sequence: number[] = []
  let i = 0,
    steps = 0
  while (i < measures.length) {
    if (++steps > 100000 || sequence.length > 10000)
      throw Error('Repeat expansion exceeds 10,000 measures')
    const ending = endings.find((e) => i >= e.start && i <= e.end),
      pass = ending?.frame !== undefined ? passes[ending.frame] : 1
    if (!ending || ending.passes.includes(pass)) sequence.push(i)
    const endingFrames = frames
      .map((f, index) => ({ ...f, index }))
      .filter((f) => f.end === i)
      .sort((a, b) => a.end - a.start - (b.end - b.start))
    let jumped = false
    for (const f of endingFrames) {
      if (passes[f.index] < f.times) {
        passes[f.index]++
        for (let n = 0; n < frames.length; n++)
          if (
            n !== f.index &&
            frames[n].start >= f.start &&
            frames[n].end <= f.end
          )
            passes[n] = 1
        i = f.start
        jumped = true
        break
      }
    }
    if (!jumped) i++
  }
  for (const part of parts) {
    const original = children(part, 'measure'),
      state = new Map<string, XmlElement>(),
      snapshots: XmlElement[][] = []
    for (const m of original) {
      for (const a of children(m, 'attributes'))
        for (const el of children(a))
          state.set(`${el.localName}:${el.getAttribute('number') ?? ''}`, el)
      snapshots.push(
        [...state.values()].map((el) => el.cloneNode(true) as XmlElement),
      )
    }
    if (original.length !== measures.length)
      throw Error('Score parts have different measure counts')
    for (const m of original) part.removeChild(m)
    sequence.forEach((index, n) => {
      const clone = original[index].cloneNode(true) as XmlElement
      clone.setAttribute('number', String(n + 1))
      if (n === 0 || index !== sequence[n - 1] + 1) {
        for (const a of children(clone, 'attributes')) clone.removeChild(a)
        const attrs = doc.createElementNS(clone.namespaceURI, 'attributes')
        const previous = new Map(
          (n ? snapshots[sequence[n - 1]] : []).map((el) => [
            `${el.localName}:${el.getAttribute('number') ?? ''}`,
            serializeXml(el),
          ]),
        )
        for (const el of snapshots[index])
          if (
            previous.get(
              `${el.localName}:${el.getAttribute('number') ?? ''}`,
            ) !== serializeXml(el)
          )
            attrs.appendChild(el.cloneNode(true))
        if (children(attrs).length) clone.insertBefore(attrs, clone.firstChild)
      }
      for (const el of [
        clone,
        ...Array.from(clone.getElementsByTagName('*')),
      ]) {
        el.removeAttribute('id')
        el.removeAttribute('xml:id')
      }
      for (const bar of children(clone, 'barline'))
        if (children(bar, 'repeat').length || children(bar, 'ending').length)
          for (const style of children(bar, 'bar-style'))
            if (
              /^(heavy-light|light-heavy|heavy-heavy)$/.test(
                style.textContent ?? '',
              )
            )
              bar.removeChild(style)
      for (const direction of children(clone, 'direction')) {
        const words = descendants(direction, 'words')
        if (
          words.length === 1 &&
          /^repeat\s+\d+\s+times?[.!]?$/i.test(
            words[0].textContent?.trim() ?? '',
          ) &&
          frames.some((frame) => frame.end === index)
        )
          clone.removeChild(direction)
      }
      for (const name of ['repeat', 'ending'])
        for (const el of descendants(clone, name))
          el.parentNode?.removeChild(el)
      for (const bar of children(clone, 'barline'))
        if (!children(bar).length) clone.removeChild(bar)
      part.appendChild(clone)
    })
  }
  return { musicxml: serializeXml(doc), sequence }
}
