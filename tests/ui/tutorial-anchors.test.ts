import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { tours } from '../../src/ui/tutorial/tours'

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(path)
    return entry.name.endsWith('.vue') ? [readFileSync(path, 'utf8')] : []
  })
}

it('provides an actual Vue anchor for every step in all six tours', () => {
  const anchors = new Set(vueFiles('src/ui').flatMap(source =>
    Array.from(source.matchAll(/\bdata-tour="([\w-]+)"/g), match => match[1])))
  expect(tours.map(tour => tour.steps.length)).toEqual([9, 7, 5, 6, 6, 6])
  for (const tour of tours)
    for (const step of tour.steps)
      expect(anchors.has(step.anchor), step.id).toBe(true)
})
