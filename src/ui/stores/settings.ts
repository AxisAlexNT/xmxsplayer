import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { defaultSettings } from '../../shared/defaults'
import { settingsSchema } from '../../shared/schema'
import type { Settings } from '../../shared/model'
function readSections(): Record<string, boolean> {
  try { const value = JSON.parse(localStorage.getItem('sections') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} }
}
export const useSettingsStore = defineStore('settings', () => {
  const value = shallowRef(defaultSettings())
  const sections = ref<Record<string, boolean>>(
    readSections(),
  )
  const collapsed = ref(localStorage.getItem('collapsed') === 'true')
  const leftWidth = ref(Number(localStorage.getItem('leftWidth')) || 372)
  async function load(): Promise<void> {
    value.value = await window.xm.settings.get()
  }
  async function save(next: Settings): Promise<void> {
    const parsed = settingsSchema.parse(next)
    await window.xm.settings.set(parsed)
    value.value = parsed
  }
  function toggle(section: string): void {
    sections.value[section] = sections.value[section] === false
    localStorage.setItem('sections', JSON.stringify(sections.value))
  }
  function collapse(): void {
    collapsed.value = !collapsed.value
    localStorage.setItem('collapsed', String(collapsed.value))
  }
  return { value, sections, collapsed, leftWidth, load, save, toggle, collapse }
})
