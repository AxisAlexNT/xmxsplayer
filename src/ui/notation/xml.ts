import {
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from '@xmldom/xmldom'
export type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom'
export function parseXml(xml: string): Document & { documentElement: Element } {
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw Error(message)
    },
  }).parseFromString(xml, 'application/xml')
  if (!doc.documentElement) throw Error('Empty XML document')
  return doc as Document & { documentElement: Element }
}
export const serializeXml = (node: Node): string =>
  new XMLSerializer().serializeToString(node)
export function children(node: Node, name?: string): Element[] {
  const result: Element[] = []
  for (let n = node.firstChild; n; n = n.nextSibling)
    if (n.nodeType === 1 && (!name || (n as Element).localName === name))
      result.push(n as Element)
  return result
}
export const child = (node: Node, name: string): Element | undefined =>
  children(node, name)[0]
export const text = (node: Node, name: string): string =>
  child(node, name)?.textContent?.trim() ?? ''
export const descendants = (
  node: Element | Document,
  name: string,
): Element[] => Array.from(node.getElementsByTagNameNS('*', name))
export function append(
  parent: Element,
  name: string,
  value?: string | number,
  attrs: Record<string, string | number> = {},
): Element {
  const doc = parent.ownerDocument!,
    el = doc.createElementNS(parent.namespaceURI, name)
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value))
  if (value !== undefined) el.appendChild(doc.createTextNode(String(value)))
  parent.appendChild(el)
  return el
}
