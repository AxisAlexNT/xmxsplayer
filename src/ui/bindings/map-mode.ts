import {
  ref,
  shallowRef,
  watchEffect,
  type ShallowRef,
  type Directive,
} from 'vue'
import type { Action } from '../../shared/model'
import { mappedBindings } from './map-targets'
import { useProjectStore } from '../stores/project'
import { useRuntimeStore } from '../stores/runtime'

export const mapActive = ref(false)
export interface MapTarget {
  continuous?: Action
  action: Action
  label: string
}
export const mapTarget = shallowRef<MapTarget | null>(null)
export const mapMenu = shallowRef<MapTarget | null>(null)
export const mapElements = new WeakMap<HTMLElement, MapTarget>()
const current = new WeakMap<HTMLElement, ShallowRef<MapTarget | undefined>>()
const dispose = new WeakMap<HTMLElement, () => void>()
export const mappable: Directive<HTMLElement, MapTarget | undefined> = {
  mounted(el, binding) {
    if (binding.value) mapElements.set(el, binding.value)
    const doc = useProjectStore(),
      runtime = useRuntimeStore()
    const targetRef = shallowRef(binding.value)
    current.set(el, targetRef)
    const stop = watchEffect(() => {
      const target = targetRef.value
      el.classList.toggle('xm-mappable', !!target)
      if (!mapActive.value || !target) {
        delete el.dataset.mapBadge
        return
      }
      const badges = runtime.midi.devices.flatMap((d) =>
        mappedBindings(
          doc.project,
          runtime.state.activeSceneId,
          d.profileId,
          target.action,
          target.continuous,
        ).map((b) =>
          b.control.replace(/^transport\./, '').replace(/^encoder\./, 'enc.'),
        ),
      )
      if (badges.length) el.dataset.mapBadge = [...new Set(badges)].join(', ')
      else delete el.dataset.mapBadge
    })
    dispose.set(el, stop)
  },
  updated(el, b) {
    if (b.value) mapElements.set(el, b.value)
    else mapElements.delete(el)
    const targetRef = current.get(el)
    if (targetRef) targetRef.value = b.value
  },
  unmounted(el) {
    dispose.get(el)?.()
    mapElements.delete(el)
  },
}
