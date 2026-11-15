import { expect, it } from 'vitest'
import { sanitizeSvgXml } from '../../src/ui/notation/svg-page'
import { descendants, parseXml } from '../../src/ui/notation/xml'
it('removes active and external SVG content before it reaches browser parsing', () => {
  const clean = sanitizeSvgXml(
    '<svg xmlns="http://www.w3.org/2000/svg" id="page"><style>path{fill:red}</style><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><g id="note" onclick="bad()" style="color:red"><use href="#glyph"/><use href="https://example.com/image.svg"/><path fill="black" stroke="none"/></g></svg>',
    'prefix-',
  )
  expect(clean).not.toMatch(
    /<style|<script|foreignObject|onclick|style=|https:/,
  )
  expect(clean).toContain('id="prefix-note"')
  expect(clean).toContain('href="#prefix-glyph"')
  expect(clean).toContain('fill="currentColor"')
  expect(descendants(parseXml(clean), 'use')[1].hasAttribute('href')).toBe(
    false,
  )
})
