import { TimeMap } from '../shared/time-map'
import { applyMetadata } from '../shared/project-sync'
import { Bus } from '../shared/bus'
import type {
  Instrument,
  Project,
  Settings,
  SoundFontRef,
} from '../shared/model'
import type { CommandMap } from '../shared/protocol'
import { AudioGraph } from './audio/graph'
import { WebSynthBackend } from './synth/web-synth'
import type { MidiMessage } from './midi/midi-io'
import { DeviceManager } from './midi/device-manager'
import { Router } from './router/router'
import { InstrumentRack } from './synth/rack'
import { Transport } from './transport/transport'

let bus: Bus | undefined
let project: Project | undefined
let settings: Settings | undefined
let graph: AudioGraph | undefined
let backend: WebSynthBackend | undefined
let rack: InstrumentRack | undefined
let router: Router | undefined
let midi: DeviceManager | undefined
let transport: Transport | undefined
let keysTimer: ReturnType<typeof setTimeout> | undefined
let syncRevision = 0
let initialization: Promise<void> | undefined
let audition: CommandMap['audition:select'] = null
const previews = new Map<
  string,
  { token: object; slot?: string; key: number }
>()
const log = (
  level: 'info' | 'warn' | 'error' | 'ok',
  source: string,
  message: string,
): void => bus?.send('log', { level, source, message })
function reportKeys(): void {
  if (keysTimer) return
  keysTimer = setTimeout(() => {
    keysTimer = undefined
    const held = router?.keys().held ?? []
    for (const entry of previews.values())
      if (!held.some((h) => h.key === entry.key))
        held.push({ key: entry.key, trackIds: [] })
    bus?.send('keys', { held })
  }, 34)
}
function liveNote(
  source: string,
  channel: number,
  key: number,
  velocity: number,
  on: boolean,
  when?: number,
): void {
  const owner = JSON.stringify([source, channel, key])
  if ((on && audition) || (!on && previews.has(owner)))
    previewNote(owner, key, velocity, on)
  else
    router?.note(source, channel, key, velocity, on, undefined, undefined, when)
}
function receiveMidi(message: MidiMessage): void {
  const when = graph
    ? graph.context.currentTime + (message.timestamp - performance.now()) / 1000
    : undefined
  if (message.type === 'cc' || message.type === 'bend')
    transport?.recorder.control(
      message.source,
      message.channel,
      message.type === 'cc' ? 'cc' : 'bend',
      message.type === 'cc' ? message.cc : 0,
      message.value,
      new Set(project?.base.zones.flatMap((z) => z.trackIds) ?? []),
      when,
    )
  if (message.type === 'note')
    liveNote(
      message.source,
      message.channel,
      message.key,
      message.velocity,
      message.on,
      graph
        ? graph.context.currentTime +
            (message.timestamp - performance.now()) / 1000
        : undefined,
    )
  else if (message.type === 'cc')
    router?.cc(message.source, message.channel, message.cc, message.value)
  else if (message.type === 'bend')
    router?.pitchBend(message.source, message.channel, message.value)
  else if (message.type === 'pressure')
    router?.pressure(message.source, message.channel, message.value)
  else if (message.type === 'poly')
    router?.polyPressure(
      message.source,
      message.channel,
      message.key,
      message.value,
    )
}
const fontLoads = new Map<string, { file: string; loading: Promise<void> }>()
async function load(font: SoundFontRef): Promise<void> {
  if (!backend || !bus) throw new Error('Audio engine is not initialized')
  const previous = fontLoads.get(font.id)
  if (previous?.file === font.file) return previous.loading
  const loading = (async () => {
    const url = await bus!.request('soundfont:resolve', font)
    if (!url)
      throw new Error(
        `${font.file}: missing soundfont. Use Locate in Soundfonts.`,
      )
    await backend!.loadSoundFont(font, url)
  })()
  fontLoads.set(font.id, { file: font.file, loading })
  try {
    await loading
  } catch (error) {
    if (fontLoads.get(font.id)?.loading === loading) fontLoads.delete(font.id)
    throw error
  }
}
async function initialize(value: Settings): Promise<void> {
  if (initialization) {
    await initialization
    await graph!.apply(value.audio)
    if (transport) transport.inputLatencyMs = value.audio.inputLatencyMs
    if (project) await transport?.audio.synchronize(project)
    return
  }
  initialization = (async () => {
    graph = new AudioGraph(
      value.audio,
      (latency) => bus?.send('latency', latency),
      (message) => log('warn', 'audio', message),
    )
    await graph.apply(value.audio)
    backend = await WebSynthBackend.create(graph.context, graph.main)
    rack = new InstrumentRack(
      backend,
      load,
      (message) => log('warn', 'synth', message),
      true,
    )
    router = new Router(rack, reportKeys, (note) =>
      transport?.recorder.note(note),
    )
    transport = new Transport(
      graph,
      backend,
      load,
      () => bus,
      (message) => log('warn', 'transport', message),
    )
    transport.inputLatencyMs = value.audio.inputLatencyMs
    if (project) {
      router.setProject(project)
      await Promise.all([
        rack.synchronize(project),
        transport.synchronize(project),
      ])
    }
    midi = new DeviceManager(
      settings?.devices ?? value.devices,
      receiveMidi,
      (event) => bus?.send('control', event),
      (ports) => bus?.send('midi:ports', ports),
      (source) => {
        transport?.recorder.disconnect(source)
        router?.disconnect(source)
        for (const owner of previews.keys())
          if (JSON.parse(owner)[0] === source) previewNote(owner, 0, 0, false)
      },
      (message) => log('warn', 'midi', message),
    )
    void midi.start().catch((error) => log('warn', 'midi', String(error)))
  })()
  try {
    await initialization
  } catch (error) {
    await graph?.close()
    graph = undefined
    backend?.destroy()
    backend = undefined
    initialization = undefined
    throw error
  }
}
async function synchronize(): Promise<void> {
  if (!rack || !project) return
  const revision = ++syncRevision
  bus?.send('synth:state', { loading: true, readyIds: [] })
  router?.setProject(project)
  await Promise.all([
    rack.synchronize(project),
    transport?.synchronize(project),
  ])
  if (revision !== syncRevision) return
  bus?.send('synth:state', {
    loading: false,
    readyIds: project.instruments
      .filter((i) => rack?.get(i.id))
      .map((i) => i.id),
  })
  for (const id of fontLoads.keys())
    if (!project.soundfonts.some((sf) => sf.id === id)) fontLoads.delete(id)
  backend?.prune(new Set(project.soundfonts.map((sf) => sf.id)))
}
function previewNote(
  owner: string,
  key: number,
  velocity: number,
  on: boolean,
  preset = audition,
): void {
  reportKeys()
  const previous = previews.get(owner)
  if (previous) {
    if (previous.slot) {
      backend?.noteOff(previous.slot, previous.key)
      const old = previous.slot
      setTimeout(() => backend?.release(old), 1500)
    }
    previews.delete(owner)
  }
  if (!on || !preset || !project || !backend) return
  const token = {}
  previews.set(owner, { token, key })
  const font = project.soundfonts.find((sf) => sf.id === preset.soundfontId)
  if (!font) {
    previews.delete(owner)
    return
  }
  void (async () => {
    await load(font)
    const instrument: Instrument = {
      id: 'audition',
      name: 'Audition',
      color: '#4cc2ff',
      backend: 'web',
      soundfontId: preset.soundfontId,
      bank: preset.bank,
      program: preset.program,
      isDrum: preset.isDrum,
      volume: 0.8,
      pan: 0,
      reverb: 0.15,
      chorus: 0,
      transpose: 0,
    }
    const slot = await backend!.allocate(instrument)
    if (previews.get(owner)?.token !== token) {
      backend!.release(slot)
      return
    }
    previews.set(owner, { token, key, slot })
    backend!.noteOn(slot, key, velocity)
  })().catch((error) => {
    if (previews.get(owner)?.token === token) previews.delete(owner)
    log('error', 'audition', String(error))
  })
}
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
  bus.on('settings:set', (value) => {
    settings = value
    midi?.configure(value.devices)
    void initialize(value).catch((error) =>
      log('error', 'audio', String(error)),
    )
  })
  bus.on('ping', () => {
    void (
      initialization ?? Promise.reject(new Error('Audio settings not received'))
    ).then(
      () => {
        bus!.send('ready', undefined)
        midi?.report()
        reportKeys()
      },
      (error) => log('error', 'audio', String(error)),
    )
  })
  bus.on('audio:scope', ({ folder }) => {
    transport?.recorder.setScope(folder)
    transport?.audio.setScope(folder)
    transport?.grid.reset()
  })
  bus.on('project:meta', (value) => {
    const old = project
    project = applyMetadata(value, old)
    if (old?.name !== value.name || old.tracks.length !== value.tracks.length)
      log(
        'info',
        'project',
        `Project synchronized: ${value.name} (${value.tracks.length} tracks)`,
      )
    midi?.report()
    void synchronize().catch((error) => log('error', 'synth', String(error)))
  })
  bus.on('track:notes', ({ trackId, notes }) => {
    const track = project?.tracks.find((t) => t.id === trackId)
    if (track?.kind === 'midi') {
      track.notes = notes
      if (project)
        void transport
          ?.synchronize(project)
          .catch((error) => log('error', 'transport', String(error)))
    }
  })
  bus.respond('audio:load', async ({ trackId, file }) => {
    if (!transport || !file) throw Error('Select an audio file first')
    const data = await transport.audio.load(trackId, file)
    return {
      durationSec: data.durationSec,
      sampleRate: data.sampleRate,
      peaks: data.peaks,
    }
  })
  bus.respond('audio:devices', () => graph?.devices() ?? [])
  bus.respond('soundfont:presets', async ({ soundfontId }) => {
    const font = project?.soundfonts.find((sf) => sf.id === soundfontId)
    if (!font) throw new Error('Select a soundfont first')
    await load(font)
    await synchronize()
    return backend!.listPresets(soundfontId)
  })
  bus.respond('recording:flush', () => {
    transport?.stop()
    return undefined
  })
  bus.on('track:audition', (value) =>
    router?.note(
      value.source,
      0,
      value.key,
      value.vel,
      value.on,
      undefined,
      value.trackId,
    ),
  )
  bus.on('audition', (value) =>
    router?.note(
      `instrument-audition-${value.instrumentId}`,
      0,
      value.key,
      100,
      value.on,
      value.instrumentId,
    ),
  )
  bus.on('live:note', (value) =>
    liveNote(value.source ?? 'ui', 0, value.key, value.vel, value.on),
  )
  bus.on('audition:select', (value) => {
    audition = value
  })
  bus.on('audition:preset', (value) =>
    previewNote(
      JSON.stringify(['audition', 0, value.key]),
      value.key,
      100,
      value.on,
      value,
    ),
  )
  bus.on('grid:tapMap', (value) => {
    try {
      transport?.grid.setSession(value)
    } catch (error) {
      log('error', 'grid', String(error))
    }
  })
  bus.on('grid:apply', ({ trackId, anchors }) => {
    try {
      transport?.grid.applyAnchors(trackId, anchors)
    } catch (error) {
      log('error', 'grid', String(error))
    }
  })
  bus.on('grid:barOne', ({ trackId }) => {
    if (!project || project.mapOwner !== null || !transport) return
    const sec = new TimeMap(project).tickToSec(transport.clock.tick)
    transport.applyPatch(
      {
        tracks: project.tracks.map((t) =>
          t.id === trackId && t.kind === 'audio'
            ? { ...t, offsetSec: t.offsetSec - sec }
            : t,
        ),
        beatAnchors: [],
      },
      0,
    )
  })
  bus.on('action:run', ({ action, value, at }) => {
    try {
      transport?.scheduler.queue(at ?? 'now', () =>
        transport?.actions.run(action, value),
      )
    } catch (error) {
      log('error', 'transport', String(error))
    }
  })
  bus.on('transport:seek', ({ tick }) => {
    try {
      transport?.seek(tick)
    } catch (error) {
      log('error', 'transport', String(error))
    }
  })
  bus.on('transport:setRate', ({ rate }) => {
    try {
      transport?.rate(rate)
    } catch (error) {
      log('error', 'transport', String(error))
    }
  })
  bus.on('transport:setLoop', (loop) => {
    bus?.send('doc:patch', { loop })
  })
  bus.on('panic', () => {
    transport?.stop()
    previews.forEach((entry) => {
      if (entry.slot) backend?.release(entry.slot)
    })
    previews.clear()
    router?.panic()
    reportKeys()
    log(
      'info',
      'engine',
      `All notes stopped · ${settings?.audio.defaultSynth ?? 'web'}`,
    )
  })
})
