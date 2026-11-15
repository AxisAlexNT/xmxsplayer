import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useProjectStore } from './project'
import { engineBus } from '../bus'

export const useScriptStore = defineStore('script', () => {
  const doc = useProjectStore()
  const draft = ref(doc.project.script)
  const externalChange = ref(false)
  const trustRequest = ref(0)
  const dirty = computed(() => draft.value !== doc.project.script)
  watch(
    () => [doc.folder, doc.project.script] as const,
    ([folder, source], previous) => {
      if (
        !previous ||
        folder !== previous[0] ||
        draft.value === previous[1] ||
        draft.value === source
      ) {
        draft.value = source
        externalChange.value = false
      } else externalChange.value = true
    },
  )
  function takeProject(): void {
    draft.value = doc.project.script
    externalChange.value = false
  }
  async function commit(): Promise<boolean> {
    if (!dirty.value) return false
    const source = draft.value
    doc.update((project) => {
      project.script = source
    })
    externalChange.value = false
    await nextTick()
    return true
  }
  async function apply(): Promise<void> {
    trustRequest.value++
    if (!(await commit())) engineBus.value?.send('script:apply', undefined)
  }
  function disable(): void {
    engineBus.value?.send('script:disable', undefined)
  }
  return {
    trustRequest,
    draft,
    dirty,
    externalChange,
    takeProject,
    commit,
    apply,
    disable,
  }
})
