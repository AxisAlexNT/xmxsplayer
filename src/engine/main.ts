import { Scenes } from './performance/scenes'
import { LedManager } from './feedback/led-manager'
import { Bindings } from './router/bindings'
import {
  parameterValue,
  parameterPatch,
  type ParamAction,
} from '../shared/parameters'
import type { Action } from '../shared/model'
import type { ControlEvent } from './midi/profile'
import { TimeMap } from '../shared/time-map'
import { applyMetadata } from '../shared/project-sync'
import { Bus } from '../shared/bus'
import type {
  Instrument,
  Project,
  Settings,
  SoundFontRef,
} from '../shared/model'
import type { CommandMap, RuntimeState } from '../shared/protocol'
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
let bindings: Bindings | undefined
let leds: LedManager | undefined
let engineClosing = false
const runtimeState: RuntimeState = {
  activeSceneId: null,
  registers: Array(8).fill(false),
  armedCueId: null,
  pendingActions: [],
  expectedNext: null,
  clips: {},
  effective: { zones: [], patch: [] },
}
const scenes = new Scenes({
  queue: (at, run) => {
    if (transport) return transport.queue(at, run)
    run()
    return 0
  },
  context: () => ({
    bar: transport?.clock.map.tickToBarBeat(transport.clock.tick).bar ?? 1,
    playing: transport?.clock.playing ?? false,
  }),
  changed: () => applyPerformance(),
})
let runtimeSignature = ''
function performanceProject(): Project | undefined {
  return scenes.effectiveProject([], false)
}
function publishRuntime(): void {
  if (!project) return
  const setup = scenes.setup()
  if (!setup) return
  runtimeState.activeSceneId = scenes.activeId
  runtimeState.registers = scenes.registers.values
  runtimeState.effective = { zones: setup.zones, patch: setup.patch }
  const signature = JSON.stringify(runtimeState)
  if (signature !== runtimeSignature) {
    runtimeSignature = signature
    const effective = performanceProject()
    if (effective) router?.setProject(effective)
    bus?.send('runtime', runtimeState)
  }
}
function applyPerformance(): void {
  const effective = performanceProject()
  if (!effective) return
  router?.setProject(effective)
  transport?.applyPerformance(effective)
  leds?.invalidate(true)
  publishRuntime()
}
let masterVolume = 1
const pendingParameters = new Map<string, { value: number; time: number }>()
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
  if (engineClosing) return
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
      new Set(
        performanceProject()?.base.zones.flatMap((z) => z.trackIds) ?? [],
      ),
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
function currentParameter(action: ParamAction): number | undefined {
  if (action.target === 'rate') return transport?.clock.rate
  if (action.target === 'masterVolume') return masterVolume
  const pending = pendingParameters.get(`${action.target}|${action.id}`)
  if (pending && performance.now() - pending.time < 250) return pending.value
  return project ? parameterValue(project, action) : undefined
}
function runAction(
  action: Action,
  value = 1,
  pressed = true,
  source = 'action',
): void {
  if (!project) return
  if (action.type === 'scene') {
    scenes.run(action)
    return
  }
  if (action.type === 'register') {
    scenes.register(action, source, pressed)
    return
  }
  if (action.type === 'note') {
    router?.note(
      source,
      0,
      action.key,
      action.velocity === 'control'
        ? Math.max(1, Math.round(value * 127))
        : action.velocity,
      pressed,
      undefined,
      action.trackId,
      undefined,
      true,
    )
    return
  }
  if (action.type === 'param' && action.target !== 'rate') {
    const unit = Math.max(0, Math.min(1, value))
    if (action.target === 'masterVolume') {
      masterVolume = Math.max(
        0,
        Math.min(1, action.min + (action.max - action.min) * unit),
      )
      graph?.master.gain.setTargetAtTime(
        masterVolume,
        graph.context.currentTime,
        0.01,
      )
    } else {
      const patch = parameterPatch(project, action, unit)
      if (patch) {
        const next = parameterValue({ ...project, ...patch }, action)
        if (next !== undefined)
          pendingParameters.set(`${action.target}|${action.id}`, {
            value: next,
            time: performance.now(),
          })
        bus?.send('param:change', { action, value: unit })
      }
    }
    return
  }
  transport?.actions.run(action, value)
}
function receiveControl(event: ControlEvent): void {
  if (engineClosing) return
  bus?.send('control', event)
  leds?.control(event)
  try {
    bindings?.receive(event)
  } catch (error) {
    log('error', 'bindings', String(error))
  }
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
    router = new Router(
      rack,
      reportKeys,
      (note) => transport?.recorder.note(note),
      () => scenes.context,
    )
    transport = new Transport(
      graph,
      backend,
      load,
      () => bus,
      (message) => log('warn', 'transport', message),
    )
    transport.inputLatencyMs = value.audio.inputLatencyMs
    transport.resolveProject = (source) => performanceProject() ?? source
    transport.conditionContext = (tick) => ({
      ...scenes.context,
      bar: transport!.clock.map.tickToBarBeat(tick).bar,
    })
    transport.onPosition = publishRuntime
    if (project) {
      router.setProject(performanceProject() ?? project)
      await Promise.all([
        rack.synchronize(project),
        transport.synchronize(project),
      ])
    }
    midi = new DeviceManager(
      settings?.devices ?? value.devices,
      receiveMidi,
      receiveControl,
      (ports) => bus?.send('midi:ports', ports),
      (source) => {
        bindings?.disconnect(source)
        transport?.recorder.disconnect(source)
        router?.disconnect(source)
        for (const owner of previews.keys())
          if (JSON.parse(owner)[0] === source) previewNote(owner, 0, 0, false)
      },
      (message) => log('warn', 'midi', message),
      (deviceId, control) => bus?.send('learn:captured', { deviceId, control }),
      (deviceId, data) => leds?.sysex(deviceId, data),
    )
    bindings = new Bindings({
      project: () => project,
      context: () => ({
        activeSceneId: runtimeState.activeSceneId,
        registers: runtimeState.registers,
        bar: transport?.clock.map.tickToBarBeat(transport.clock.tick).bar ?? 1,
        playing: transport?.clock.playing ?? false,
        holding: transport?.clock.holding ?? false,
      }),
      profile: (id) => midi?.devices().find((d) => d.id === id)?.profile,
      queue: (at, run) => transport?.queue(at, run) ?? 0,
      cancel: (id) => transport?.cancelAction(id),
      isQueued: (id) => transport?.scheduler.isQueued(id) ?? false,
      run: runAction,
      parameter: currentParameter,
    })
    leds = new LedManager({
      now: () => performance.now(),
      state: () =>
        project && transport
          ? {
              project,
              runtime: runtimeState,
              playing: transport.clock.playing,
              recording: transport.clock.recording,
              holding: transport.clock.holding,
              tick: transport.clock.tick,
              rate: transport.clock.speed,
            }
          : undefined,
      devices: () => midi?.devices() ?? [],
      output: (id) => midi?.output(id),
      forceProgram: () => settings?.devices.arturiaForceProgram ?? false,
      queued: (id) => bindings?.queued(id) ?? new Set(),
      report: (frame) => bus?.send('feedback', frame),
      warn: (message) => log('warn', 'feedback', message),
    })
    transport.onTimingChange = (keepBeat) => leds?.invalidate(keepBeat)
    transport.onBeat = (tick, when) => {
      const ctx = graph!.context,
        stamp = ctx.getOutputTimestamp()
      const perf =
        stamp.contextTime && stamp.performanceTime
          ? stamp.performanceTime + (when - stamp.contextTime) * 1000
          : performance.now() +
            (when - ctx.currentTime + ctx.baseLatency + ctx.outputLatency) *
              1000
      leds?.beatAt(tick, perf)
    }
    publishRuntime()
    leds.start()
    void midi
      .start(!window.engineHost.smoke && !engineClosing)
      .catch((error) => log('warn', 'midi', String(error)))
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
  router?.setProject(performanceProject() ?? project)
  await Promise.all([
    rack.synchronize(project),
    transport?.synchronize(project),
  ])
  if (revision !== syncRevision) return
  router?.setProject(performanceProject() ?? project)
  publishRuntime()
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
    if (engineClosing) return
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
        runtimeSignature = ''
        publishRuntime()
        reportKeys()
      },
      (error) => log('error', 'audio', String(error)),
    )
  })
  bus.respond('device:profiles', () => midi?.profiles() ?? [])
  bus.on('learn:start', ({ deviceId, controlId, control }) => {
    const device = midi?.devices().find((d) => !deviceId || d.id === deviceId)
    const target =
      control ??
      device?.profile.controls.find((c) =>
        controlId ? c.id === controlId : !c.msg,
      )
    if (device && target) midi?.learn.start(device.id, target)
    else
      log(
        'warn',
        'midi',
        'Select a connected controller and a control to learn',
      )
  })
  bus.on('learn:stop', () => midi?.learn.stop())
  bus.on('audio:scope', ({ folder }) => {
    bindings?.clear()
    scenes.reset(false)
    runtimeSignature = ''
    leds?.invalidate()
    pendingParameters.clear()
    transport?.recorder.setScope(folder)
    transport?.audio.setScope(folder)
    transport?.grid.reset()
  })
  bus.on('project:meta', (value) => {
    if (engineClosing) return
    const old = project
    project = applyMetadata(value, old)
    scenes.configure(project)
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
  bus.respond('recording:close', () => {
    if (transport?.clock.recording) transport.stop()
    return undefined
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
      transport?.queue(at ?? 'now', () => runAction(action, value))
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
  bus.on('scene:activate', ({ sceneId }) => scenes.activate(sceneId))
  bus.on('register:set', ({ index, on }) =>
    scenes.register({ type: 'register', cmd: 'set', index, on }, 'ui'),
  )
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
    bindings?.clear()
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

window.engineHost.onShutdown(async () => {
  engineClosing = true
  await initialization?.catch(() => undefined)
  bindings?.clear()
  transport?.stop()
  midi?.close()
  router?.panic()
  await leds?.close()
})
