import type { Action, Project } from '../../shared/model'
import { orchestraSections } from '../../shared/orchestra'

export const PAD_SOURCE = 'application/x-xmxsplayer-pad-source'

export function dragPadSource(event: DragEvent, source: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(PAD_SOURCE, source)
  event.dataTransfer.effectAllowed = 'link'
}

export function padAction(project: Project, source: string): Action {
  if (source.startsWith('orchestra:')) {
    const orchestra = project.orchestras?.find(
      (o) => 'orchestra:' + o.id === source,
    )
    if (orchestra)
      return { type: 'orchestra', cmd: 'select', orchestraId: orchestra.id }
  } else if (source.startsWith('section:')) {
    const target = orchestraSections(project).find((s) => s.id === source)
    if (target?.section.register != null)
      return { type: 'register', cmd: 'toggle', index: target.section.register }
  } else if (source.startsWith('instrument:')) {
    const instrument = project.instruments.find(
      (i) => 'instrument:' + i.id === source,
    )
    if (instrument)
      return {
        type: 'note',
        instrumentId: instrument.id,
        key: instrument.isDrum ? 36 : 60,
        velocity: 'control',
      }
  }
  throw Error('This item is no longer available for pad assignment.')
}
