import { defineStore } from 'pinia'
import { computed, shallowRef, ref } from 'vue'
import { produce, type Draft } from 'immer'
import type { FileChanges, FileMap, ProjectSnapshot } from '../../shared/api'
import type { Project } from '../../shared/model'
import { newProject } from '../../shared/defaults'
import { fromFiles, sameContent, toFiles } from '../../shared/project-files'
import { projectSchema } from '../../shared/schema'

export const useProjectStore = defineStore('project', () => {
  const project = shallowRef<Project>(newProject())
  const folder = ref('')
  const loadRevision = ref(0)
  const baseline = shallowRef<FileMap>(toFiles(project.value))
  const diskContents = shallowRef<FileMap>({})
  const diskHashes = shallowRef<Record<string, string>>({})
  const conflicts = shallowRef<Record<string, FileChanges>>({})
  const history = shallowRef<Project[]>([])
  const future = shallowRef<Project[]>([])
  const dirtyFiles = computed(() => {
    const current = toFiles(project.value)
    return [
      ...new Set([...Object.keys(current), ...Object.keys(baseline.value)]),
    ].filter((p) => !sameContent(current[p], baseline.value[p]))
  })
  function replace(next: Project): void {
    if (next === project.value) return
    history.value = [...history.value.slice(-199), project.value]
    future.value = []
    project.value = next
  }
  function update(recipe: (draft: Draft<Project>) => void): void {
    const next = produce(project.value, recipe)
    projectSchema.parse(next)
    replace(next)
  }
  function undo(): void {
    const next = history.value.at(-1)
    if (!next) return
    future.value = [...future.value, project.value]
    history.value = history.value.slice(0, -1)
    project.value = next
  }
  function redo(): void {
    const next = future.value.at(-1)
    if (!next) return
    history.value = [...history.value.slice(-199), project.value]
    future.value = future.value.slice(0, -1)
    project.value = next
  }
  function load(snapshot: ProjectSnapshot): void {
    const next = fromFiles(snapshot.files)
    project.value = next
    baseline.value = toFiles(next)
    folder.value = snapshot.folder
    diskContents.value = snapshot.files
    diskHashes.value = snapshot.hashes
    conflicts.value = {}
    history.value = []
    future.value = []
    loadRevision.value++
  }
  async function save(): Promise<void> {
    if (Object.keys(conflicts.value).length)
      throw new Error('Resolve file conflicts before saving')
    const current = toFiles(project.value)
    const dirty = new Set(dirtyFiles.value)
    const files = Object.fromEntries(
      Object.entries(current).map(([path, value]) => [
        path,
        dirty.has(path) ? value : (diskContents.value[path] ?? value),
      ]),
    )
    const hashes = await window.xm.project.save(files, diskHashes.value)
    baseline.value = current
    diskContents.value = files
    diskHashes.value = hashes
  }
  function mergeFile(
    path: string,
    change: FileChanges,
    base: FileMap,
  ): FileMap {
    const files = { ...base }
    const content = change.files[path]
    if (content === null) delete files[path]
    else files[path] = content
    return files
  }
  function accept(
    paths: string[],
    change: FileChanges,
    keepMine: boolean,
  ): void {
    let files = toFiles(project.value)
    for (const path of paths) files = mergeFile(path, change, files)
    let incoming: Project | undefined
    try {
      incoming = fromFiles(files, project.value)
    } catch (error) {
      if (!keepMine) throw error
    }
    const contents = incoming ? toFiles(incoming) : files
    if (!keepMine && incoming) replace(incoming)
    const next = { ...baseline.value }
    const hashes = { ...diskHashes.value }
    const pending = { ...conflicts.value }
    for (const path of paths) {
      if (contents[path] === undefined) delete next[path]
      else next[path] = contents[path]
      hashes[path] = change.hashes[path]
      delete pending[path]
    }
    const disk = { ...diskContents.value }
    for (const path of paths) {
      if (change.files[path] === null) delete disk[path]
      else disk[path] = change.files[path]
    }
    diskContents.value = disk
    baseline.value = next
    diskHashes.value = hashes
    conflicts.value = pending
  }
  function reload(change: FileChanges): string[] {
    if (change.folder !== folder.value) return []
    const dirty = new Set(dirtyFiles.value)
    const applied: string[] = []
    for (const path of Object.keys(change.files)) {
      if (
        change.hashes[path] !== undefined &&
        change.hashes[path] === diskHashes.value[path]
      )
        continue
      if (dirty.has(path) || conflicts.value[path])
        conflicts.value = { ...conflicts.value, [path]: change }
      else applied.push(path)
    }
    if (applied.length) accept(applied, change, false)
    return applied
  }
  function resolve(path: string, keepMine: boolean): void {
    const change = conflicts.value[path]
    if (change) accept([path], change, keepMine)
  }
  return {
    project,
    folder,
    loadRevision,
    dirtyFiles,
    conflicts,
    history,
    future,
    diskHashes,
    update,
    undo,
    redo,
    load,
    save,
    reload,
    resolve,
  }
})
