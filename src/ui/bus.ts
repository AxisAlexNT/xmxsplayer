import { shallowRef } from 'vue'
import { Bus } from '../shared/bus'
export const engineBus = shallowRef<Bus | null>(null)
window.addEventListener('message', (event) => {
  if (
    event.source !== window ||
    event.origin !== 'app://xmxsplayer' ||
    event.data?.type !== 'bus:port' ||
    !event.ports[0]
  )
    return
  engineBus.value?.close()
  engineBus.value = new Bus(event.ports[0], 'cmd')
})
