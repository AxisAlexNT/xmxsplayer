import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en, formatMessage, translate } from '../../src/shared/i18n-en'

import { tours } from '../../src/ui/tutorial/tours'

function* sources(dir: string): Generator<string> {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) yield* sources(path)
    else if (/\.(ts|vue)$/.test(item.name)) yield readFileSync(path, 'utf8')
  }
}

describe('English catalogue', () => {
  it('uses every key and supplies each named placeholder', () => {
    const used = new Set<string>()
    for (const tour of tours) {
      for (const key of [tour.titleKey, ...tour.steps.flatMap(step => [step.titleKey, step.bodyKey])]) {
        expect(en[key]).toBeTruthy()
        expect(en[key]).not.toMatch(/\{\w+\}/)
        used.add(key)
      }
    }
    for (const source of sources('src')) {
      for (const match of source.matchAll(/\bt\(\s*['"]([\w.]+)['"](?:\s*,\s*\{([^}]*)\})?/g)) {
        const key = match[1] as keyof typeof en
        expect(en).toHaveProperty([key])
        used.add(key)
        const required = [...en[key].matchAll(/\{(\w+)\}/g)].map(m => m[1])
        const supplied = (match[2] ?? '').split(',').map(p => p.split(':')[0].trim()).filter(Boolean)
        expect(supplied.sort()).toEqual(required.sort())
      }
    }
    expect([...used].sort()).toEqual(Object.keys(en).sort())
  })
  it('formats counts, names and invalid locale preferences', () => {
    const count = { one: '{count} note', other: '{count} notes' }
    expect(formatMessage(count, { count: 1 }, 'en')).toBe('1 note')
    expect(formatMessage(count, { count: 1200 }, 'de')).toBe('1.200 notes')
    expect(translate('conflict.changed', { name: 'setup.yaml' }, '!')).toContain('setup.yaml')
  })
})
