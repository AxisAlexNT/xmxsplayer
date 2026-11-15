import { beforeEach, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useProjectStore } from '../../src/ui/stores/project'
import { useRuntimeStore } from '../../src/ui/stores/runtime'
import { usePerformanceStore } from '../../src/ui/stores/performance'
import { toFiles } from '../../src/shared/project-files'
import { liveProject } from '../../src/shared/template'
beforeEach(() => setActivePinia(createPinia()))
it('stores scene edits as partial overrides and keeps base routing intact through undo', async () => {
  const doc = useProjectStore(),
    runtime = useRuntimeStore(),
    rig = usePerformanceStore()
  const project = liveProject('Performance')
  project.scenes.push({ id: 'reprise', name: 'Reprise', color: '#ffb020' })
  doc.load({ folder: '/tmp/performance', files: toFiles(project), hashes: {} })
  runtime.state.activeSceneId = 'reprise'
  await nextTick()
  rig.zones((zones) => {
    zones[0].hi = 59
  })
  rig.mode('piano', 'auto')
  expect(doc.project.base.zones[0].hi).toBe(127)
  expect(doc.project.tracks[0].mode).toBe('live')
  expect(doc.project.scenes[0].zones![0].hi).toBe(59)
  expect(doc.project.scenes[0].trackModes).toEqual({ piano: 'auto' })
  expect(doc.project.scenes[0].patch).toBeUndefined()
  doc.undo()
  expect(doc.project.scenes[0].trackModes).toBeUndefined()
  expect(doc.project.scenes[0].zones![0].hi).toBe(59)
  rig.editScene = false
  rig.patch((connections) => {
    connections[0].when = { reg: 0, on: true }
  })
  expect(doc.project.base.patch[0].when).toEqual({ reg: 0, on: true })
  expect(doc.project.scenes[0].patch).toBeUndefined()
  expect(rig.setup.patch[0].when).toEqual({ reg: 0, on: true })
})
