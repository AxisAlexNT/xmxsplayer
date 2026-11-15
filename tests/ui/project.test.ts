import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parse, stringify } from 'yaml'
import { newProject } from '../../src/shared/defaults'
import { toFiles } from '../../src/shared/project-files'
import { useProjectStore } from '../../src/ui/stores/project'
import type { FileChanges } from '../../src/shared/api'

beforeEach(() => setActivePinia(createPinia()))
function opened() {
  const store = useProjectStore()
  store.load({ folder: '/project', files: toFiles(newProject()), hashes: {} })
  return store
}
function setupChange(name: string): FileChanges {
  const setup = parse(toFiles(newProject())['setup.yaml'] as string)
  setup.registers[0].name = name
  return {
    folder: '/project',
    files: { 'setup.yaml': stringify(setup) },
    hashes: { 'setup.yaml': name },
  }
}
describe('project store', () => {
  it('tracks dirty files and undo/redo using shared immutable roots', () => {
    const store = opened()
    const root = store.project
    store.update((p) => {
      p.name = 'New name'
    })
    expect(store.project.base).toBe(root.base)
    expect(store.dirtyFiles).toEqual(['project.yaml'])
    store.undo()
    expect(store.project).toBe(root)
    expect(store.dirtyFiles).toEqual([])
    store.redo()
    expect(store.project.name).toBe('New name')
    for (let n = 0; n < 210; n++)
      store.update((p) => {
        p.name = String(n)
      })
    expect(store.history).toHaveLength(200)
  })
  it('applies a file reload undoably without overwriting another dirty file', () => {
    const store = opened()
    store.update((p) => {
      p.name = 'My title'
    })
    expect(store.reload(setupChange('Strings'))).toEqual(['setup.yaml'])
    expect(store.project.registers[0].name).toBe('Strings')
    expect(store.project.name).toBe('My title')
    expect(store.dirtyFiles).toEqual(['project.yaml'])
    store.undo()
    expect(store.project.registers[0].name).toBe('Register 1')
    expect(store.dirtyFiles).toContain('setup.yaml')
  })
  it.each([true, false])(
    'resolves same-file conflicts: keepMine=%s',
    (keepMine) => {
      const store = opened()
      store.update((p) => {
        p.registers[0].name = 'Mine'
      })
      store.reload(setupChange('Disk'))
      expect(store.project.registers[0].name).toBe('Mine')
      expect(Object.keys(store.conflicts)).toEqual(['setup.yaml'])
      store.resolve('setup.yaml', keepMine)
      expect(store.project.registers[0].name).toBe(keepMine ? 'Mine' : 'Disk')
      expect(store.dirtyFiles).toEqual(keepMine ? ['setup.yaml'] : [])
      expect(store.diskHashes['setup.yaml']).toBe('Disk')
      expect(store.conflicts).toEqual({})
    },
  )
  it('keeps the document on invalid external edits and ignores other projects', () => {
    const store = opened()
    const root = store.project
    expect(() =>
      store.reload({
        folder: '/project',
        files: { 'setup.yaml': 'registers: invalid' },
        hashes: {},
      }),
    ).toThrow()
    expect(store.project).toBe(root)
    store.reload({ ...setupChange('Other'), folder: '/other' })
    expect(store.project).toBe(root)
  })
  it('preserves raw contents of semantically unchanged files when saving', async () => {
    const store = useProjectStore()
    const files = toFiles(newProject())
    files['setup.yaml'] = '# Keep this comment\n' + files['setup.yaml']
    store.load({ folder: '/project', files, hashes: {} })
    const save = vi.fn(
      async (contents: Record<string, string | Uint8Array>) => {
        expect(contents['setup.yaml']).toBe(files['setup.yaml'])
        return {}
      },
    )
    vi.stubGlobal('window', { xm: { project: { save } } })
    store.update((p) => {
      p.name = 'New title'
    })
    await store.save()
    expect(save.mock.calls[0][0]['setup.yaml']).toBe(files['setup.yaml'])
    expect(store.dirtyFiles).toEqual([])
    vi.unstubAllGlobals()
  })
  it('remains dirty when edited during an async save', async () => {
    const store = opened()
    let finish!: (value: Record<string, string>) => void
    vi.stubGlobal('window', {
      xm: {
        project: {
          save: () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        },
      },
    })
    store.update((p) => {
      p.name = 'Before save'
    })
    const saving = store.save()
    store.update((p) => {
      p.name = 'During save'
    })
    finish({})
    await saving
    expect(store.dirtyFiles).toEqual(['project.yaml'])
    vi.unstubAllGlobals()
  })
})
