import { applyMetadata } from '../shared/project-sync'
import { Bus } from '../shared/bus'
import type { Project, Settings } from '../shared/model'
let bus: Bus | undefined
let project: Project | undefined
let settings: Settings | undefined
window.addEventListener('message', (event) => {
  if (
    event.source !== window ||
    event.origin !== 'app://xmxsplayer' ||
    event.data?.type !== 'bus:port' ||
    !event.ports[0]
  )
    return
  bus?.close()
  bus = new Bus(event.ports[0], 'evt')
  bus.on('ping', () => bus!.send('ready', undefined))
  bus.on('project:meta', (value) => {
    const old = project
    project = applyMetadata(value, old)
    if (old?.name !== value.name || old.tracks.length !== value.tracks.length) bus!.send('log', { level: 'info', source: 'project', message: `Project synchronized: ${value.name} (${value.tracks.length} tracks)` })
  })
  bus.on('track:notes', ({ trackId, notes }) => {
    const track = project?.tracks.find((t) => t.id === trackId)
    if (track?.kind === 'midi') track.notes = notes
  })
  bus.on('settings:set', (value) => {
    settings = value
  })
  bus.on('panic', () =>
    bus!.send('log', {
      level: 'info',
      source: 'engine',
      message: `Engine connected · ${project?.tracks.length ?? 0} tracks · ${settings?.audio.defaultSynth ?? 'web'}`,
    }),
  )
})
