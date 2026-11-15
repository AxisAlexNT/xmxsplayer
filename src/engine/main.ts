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
import { InstrumentRack } from './synth/rack'

let bus: Bus | undefined
let project: Project | undefined
let settings: Settings | undefined
let graph: AudioGraph | undefined
let backend: WebSynthBackend | undefined
let rack: InstrumentRack | undefined
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
    rack = new InstrumentRack(backend, load, (message) =>
      log('warn', 'synth', message),
    )
    if (project) await rack.synchronize(project)
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
  await rack.synchronize(project)
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
    void initialize(value).catch((error) =>
      log('error', 'audio', String(error)),
    )
  })
  bus.on('ping', () => {
    void (
      initialization ?? Promise.reject(new Error('Audio settings not received'))
    ).then(
      () => bus!.send('ready', undefined),
      (error) => log('error', 'audio', String(error)),
    )
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
    void synchronize().catch((error) => log('error', 'synth', String(error)))
  })
  bus.on('track:notes', ({ trackId, notes }) => {
    const track = project?.tracks.find((t) => t.id === trackId)
    if (track?.kind === 'midi') track.notes = notes
  })
  bus.respond('audio:devices', () => graph?.devices() ?? [])
  bus.respond('soundfont:presets', async ({ soundfontId }) => {
    const font = project?.soundfonts.find((sf) => sf.id === soundfontId)
    if (!font) throw new Error('Select a soundfont first')
    await load(font)
    await synchronize()
    return backend!.listPresets(soundfontId)
  })
  bus.on('audition:select', (value) => {
    audition = value
  })
  bus.on('audition:preset', (value) =>
    previewNote(`audition:${value.key}`, value.key, 100, value.on, value),
  )
  bus.on('panic', () => {
    previews.forEach((entry) => {
      if (entry.slot) backend?.release(entry.slot)
    })
    previews.clear()
    rack?.panic()
    log(
      'info',
      'engine',
      `All notes stopped · ${settings?.audio.defaultSynth ?? 'web'}`,
    )
  })
})
