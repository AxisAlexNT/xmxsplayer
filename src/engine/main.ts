import { zeroCrossing } from './clips/zero-crossing'
import { clipSchema } from '../shared/schema'
import { ClipActions, type ClipActionContext } from './clips/actions'
import { ScriptHost } from './script/script-host'
import { ScriptSession } from './script/script-session'
import { NoteHooks } from './script/note-hooks'
import { ScriptTimeline, combineTimelines } from './script/timeline'
import { createApi } from './script/api'
import { Activity } from './performance/activity'
import { Cues } from './performance/cues'
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
import { FluidSynthBackend } from './synth/fluid-synth'
import { MidiOutSynthBackend } from './synth/midi-out-synth'
import type { SynthBackend } from './synth/backend'
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
let fluidBackend: FluidSynthBackend | undefined
let midiBackend: MidiOutSynthBackend | undefined
let rack: InstrumentRack | undefined
let router: Router | undefined
let midi: DeviceManager | undefined
let transport: Transport | undefined
let bindings: Bindings | undefined
let leds: LedManager | undefined
let cues: Cues | undefined
let cueNoteSerial = 0
let activity: Activity | undefined
let clipActions: ClipActions | undefined
let script: ScriptHost | undefined
let scriptSession: ScriptSession | undefined
let noteHooks: NoteHooks | undefined
let scriptTimeline: ScriptTimeline | undefined
let scriptPads: Record<string, string> = {}
let scriptDisplay: [string, string] | undefined
let scriptTransportSignature = ''
let scriptNoteSerial = 0
let scriptCommandRevision = 0
const scriptNotes = new Map<
  string,
  { key: number; trackId: string; timer: ReturnType<typeof setTimeout> }
>()
function releaseScriptNotes(): void {
  for (const [source, note] of scriptNotes) {
    clearTimeout(note.timer)
    router?.note(source, 0, note.key, 0, false, undefined, note.trackId)
  }
  scriptNotes.clear()
}
function resetScriptEffects(): void {
  clipActions?.clearSources((source) => source.startsWith('script:'))
  releaseScriptNotes()
  scriptPads = {}
  scriptDisplay = undefined
  scenes.clearScript()
  scriptTimeline?.reset()
  leds?.invalidate(true)
}

let engineClosing = false
let controlCapture = false
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
  activated: (id) => script?.emit('scene', { id }),
})
let runtimeSignature = ''
function performanceProject(): Project | undefined {
  return scenes.effectiveProject([], false)
}
function publishRuntime(): void {
  if (!project) return
  const setup = performanceProject()?.base
  if (!setup) return
  runtimeState.scriptEnabled = script?.running ?? false
  runtimeState.scriptZones = !!script?.running && scenes.hasScriptZones
  runtimeState.trackModes = Object.fromEntries(
    (performanceProject()?.tracks ?? []).map((t) => [t.id, t.mode]),
  )
  runtimeState.followMode = performanceProject()?.follow.mode
  runtimeState.followHolding = transport?.waitNotes.holding ?? false
  runtimeState.expectedNext =
    transport?.waitNotes.expected ?? transport?.tempoTrack.expected ?? null
  runtimeState.armedCueId = cues?.armedId ?? null
  runtimeState.queuedCueIds = cues?.queuedIds ?? []
  runtimeState.pendingActions = cues?.pendingActions ?? []
  runtimeState.orchestras = { ...scenes.orchestras }
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
  { token: object; slot?: string; key: number; backend?: SynthBackend }
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
function routedLiveNote(
  source: string,
  channel: number,
  key: number,
  velocity: number,
  on: boolean,
  when?: number,
  inputKey = key,
): void {
  if (engineClosing) return
  const owner = JSON.stringify([source, channel, key])
  if ((on && audition) || (!on && previews.has(owner)))
    previewNote(owner, key, velocity, on)
  else {
    if (on && velocity > 0) {
      const effective = performanceProject()
      cues?.key(
        !!effective?.base.zones.some(
          (zone) =>
            key >= zone.lo &&
            key <= zone.hi &&
            zone.trackIds.some((id) =>
              effective.tracks.some(
                (t) => t.id === id && t.kind === 'midi' && t.mode === 'live',
              ),
            ),
        ),
      )
    }
    router?.note(
      source,
      channel,
      key,
      velocity,
      on,
      undefined,
      undefined,
      when,
      false,
      inputKey,
    )
  }
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
  if ((on && audition) || (!on && previews.has(owner)) || !noteHooks)
    routedLiveNote(source, channel, key, velocity, on, when)
  else
    noteHooks.receive(
      { deviceId: source, channel, key, vel: velocity, on, timestamp: when },
      when,
    )
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
  context?: ClipActionContext,
): void {
  if (!project || engineClosing) return
  if (action.type === 'clip') {
    clipActions?.run(action, value, pressed, source, context)
    return
  }
  if (action.type === 'script') {
    script?.invoke(action.fn)
    return
  }
  if (action.type === 'follow') {
    const modes = ['written', 'waitNotes', 'tempoTrack'] as const
    const current = performanceProject()?.follow.mode ?? 'written'
    scenes.setFollow(
      action.mode === 'cycle'
        ? modes[(modes.indexOf(current) + 1) % modes.length]
        : action.mode,
      'action',
    )
    return
  }
  if (action.type === 'orchestra') {
    scenes.selectOrchestra(action)
    return
  }
  if (action.type === 'trackMode') {
    scenes.mode(action)
    return
  }
  if (action.type === 'cue') {
    if (action.cmd === 'prev' || action.cmd === 'next')
      cues?.navigate(action.cmd)
    else cues?.fire(action.cmd === 'fire' ? action.cueId : undefined)
    return
  }
  if (
    action.type === 'transport' &&
    (action.cmd === 'skipHold' ||
      (action.cmd === 'forward' && transport?.clock.holding)) &&
    (cues?.skip() || transport?.waitNotes.skip())
  )
    return
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
      action.key,
      source.startsWith('binding:'),
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
  if (action.type === 'transport' && action.cmd === 'stop') {
    cues?.stop()
    releaseScriptNotes()
    scriptTimeline?.reset()
  }
}
function receiveControl(event: ControlEvent): void {
  if (engineClosing) return
  bus?.send('control', event)
  leds?.control(event)
  if (controlCapture) {
    bindings?.releaseControl(event)
    return
  }
  script?.emit('control', { ...event, id: event.controlId })
  try {
    if (
      !cues?.control(event.controlId, event.edge === 'press' && event.pressed)
    )
      bindings?.receive(event)
  } catch (error) {
    log('error', 'bindings', String(error))
  }
}
const fontLoads = new Map<string, { file: string; loading: Promise<void> }>()
function selectBackend(instrument: Instrument): SynthBackend {
  const target =
    instrument.backend === 'default'
      ? (settings?.audio.defaultSynth ?? 'web')
      : instrument.backend
  const selected =
    target === 'fluid'
      ? fluidBackend
      : target === 'web'
        ? backend
        : target === 'midi'
          ? midiBackend
          : undefined
  if (!selected)
    throw Error(`${instrument.name}: ${target} backend is not available`)
  return selected
}
function reportSynthReady(): void {
  bus?.send('synth:state', {
    loading: false,
    readyIds: (project?.instruments ?? [])
      .filter((instrument) => {
        const slot = rack?.get(instrument.id)
        return (
          slot &&
          (slot.backend !== fluidBackend || fluidBackend.available) &&
          (slot.backend !== midiBackend || midiBackend.available(instrument))
        )
      })
      .map((instrument) => instrument.id),
  })
}
async function load(
  font: SoundFontRef,
  target: SynthBackend | undefined = backend,
): Promise<void> {
  if (!target || !bus) throw new Error('Audio engine is not initialized')
  const key = `${target.id}:${font.id}`
  const previous = fontLoads.get(key)
  if (previous?.file === font.file) return previous.loading
  const loading = (async () => {
    const url = await bus!.request('soundfont:resolve', font)
    if (!url)
      throw new Error(
        `${font.file}: missing soundfont. Use Locate in Soundfonts.`,
      )
    await target.loadSoundFont(font, url)
  })()
  fontLoads.set(key, { file: font.file, loading })
  try {
    await loading
  } catch (error) {
    if (fontLoads.get(key)?.loading === loading) fontLoads.delete(key)
    throw error
  }
}
async function initialize(value: Settings): Promise<void> {
  if (initialization) {
    await initialization
    await graph!.apply(value.audio)
    await fluidBackend?.reconfigure({
      ...value.fluid,
      sampleRate: value.audio.sampleRate,
    })
    if (transport) transport.grid.tempoMode = value.tempoMode ?? 'scale'
    if (transport) transport.inputLatencyMs = value.audio.inputLatencyMs
    if (project)
      await transport?.audio.synchronize(performanceProject() ?? project)
    return
  }
  initialization = (async () => {
    graph = new AudioGraph(
      value.audio,
      (latency) =>
        bus?.send('latency', {
          ...latency,
          backend: settings?.audio.defaultSynth ?? 'web',
          fluidMs: fluidBackend ? fluidBackend.latencySec() * 1000 : 0,
        }),
      (message) => log('warn', 'audio', message),
    )
    await graph.apply(value.audio)
    backend = await WebSynthBackend.create(graph.context, graph.main)
    midiBackend = new MidiOutSynthBackend(
      () => midi?.outputs() ?? [],
      () => graph!.context.currentTime,
      (message) => log('warn', 'midi', message),
    )
    fluidBackend = new FluidSynthBackend(
      window.xm.fluid,
      () => graph!.context.currentTime,
      { ...value.fluid, sampleRate: value.audio.sampleRate },
      (message) => log('warn', 'fluid', message),
      (font) => bus!.request('soundfont:resolve', font),
      () => {
        if (!engineClosing) {
          router?.panic()
          void synchronize(false, true).catch((error) =>
            log('error', 'fluid', String(error)),
          )
        }
      },
      () => {
        if (!engineClosing) reportSynthReady()
      },
    )
    rack = new InstrumentRack(
      backend,
      load,
      (message) => log('warn', 'synth', message),
      true,
      selectBackend,
    )
    activity = new Activity(
      () => performance.now(),
      () => [...(router?.activity() ?? []), ...(transport?.activity() ?? [])],
      (state) => bus?.send('activity', state),
    )
    router = new Router(
      rack,
      reportKeys,
      (note) => transport?.liveNote(note),
      () => scenes.context,
      (route) => activity?.pulse(route),
    )
    transport = new Transport(
      graph,
      backend,
      load,
      () => bus,
      (message) => log('warn', 'transport', message),
      selectBackend,
      (target) => (settings?.audio.compensationMs[target.id] ?? 0) / 1000,
    )
    clipActions = new ClipActions(transport.clips, () => project)
    transport.onClipPreview = (state, error) =>
      bus?.send('clip:preview', { state, ...(error ? { error } : {}) })
    transport.onClips = (frame) => {
      runtimeState.clips = frame.states
      bus?.send('clips:progress', frame.progress)
      publishRuntime()
    }
    script = new ScriptHost(
      (on, state, active) =>
        createApi(
          {
            project: () => project!,
            position: () => ({
              ...transport!.clock.map.tickToBarBeat(transport!.clock.tick),
              tick: transport!.clock.tick,
              playing: transport!.clock.playing,
              rate: transport!.clock.rate,
            }),
            play: () => transport!.play(),
            stop: () => runAction({ type: 'transport', cmd: 'stop' }),
            seekBar: (bar) =>
              transport!.seek(transport!.clock.map.barToTick(bar)),
            setRate: (rate) => transport!.rate(rate),
            hold: () => {
              transport!.scheduler.holdAt(transport!.clock.tick)
              transport!.changed()
            },
            release: () => {
              if (!cues?.skip() && !transport!.waitNotes.skip())
                transport!.scheduler.releaseHold()
              transport!.changed()
            },
            orchestra: () => Object.values(scenes.orchestras)[0] ?? null,
            selectOrchestra: (id, at) =>
              scenes.selectOrchestra(
                { type: 'orchestra', cmd: 'select', orchestraId: id },
                at,
              ),
            scene: () => scenes.activeId,
            activate: (id, at) => {
              scenes.activate(id, at)
            },
            registers: () => scenes.registers.values,
            register: (index, on) =>
              scenes.register(
                { type: 'register', cmd: 'set', index, on },
                'script',
              ),
            zones: (zones) => scenes.setZones(zones),
            patch: (id, instruments) => scenes.setPatch(id, instruments),
            mode: (id) =>
              performanceProject()!.tracks.find((t) => t.id === id)!.mode,
            setMode: (id, mode) => scenes.setScriptMode(id, mode),
            playNote: (trackId, key, vel, beats) => {
              const source = `script:note:${++scriptNoteSerial}`
              router!.note(source, 0, key, vel, true, undefined, trackId)
              const duration =
                (beats * 60000) /
                transport!.clock.map.tempoAt(transport!.clock.tick) /
                transport!.clock.speed
              const timer = setTimeout(() => {
                router?.note(source, 0, key, 0, false, undefined, trackId)
                scriptNotes.delete(source)
              }, duration)
              scriptNotes.set(source, { trackId, key, timer })
            },
            clip: (id) => ({
              launch: () =>
                clipActions!.run(
                  { type: 'clip', cmd: 'launch', clipId: id },
                  1,
                  true,
                  'script:clip',
                ),
              stop: () =>
                clipActions!.run(
                  { type: 'clip', cmd: 'stop', clipId: id },
                  1,
                  true,
                  'script:clip',
                ),
              get playing() {
                return transport!.clips.playing(id)
              },
              get semitones() {
                return transport!.clips.pitch(id)
              },
              set semitones(value) {
                transport!.clips.setPitch(id, value)
              },
              get gain() {
                return transport!.clips.gain(id)
              },
              set gain(value) {
                transport!.clips.setGain(id, value)
              },
            }),
            follow: () => performanceProject()!.follow.mode,
            setFollow: (mode) => scenes.setFollow(mode),
            pad: (n) => scriptPads[`pad.${n}`] ?? '#4cc2ff',
            setPad: (n, color) => {
              scriptPads[`pad.${n}`] = color
              leds?.invalidate(true)
            },
            display: (a, b) => {
              scriptDisplay = [a, b]
              leds?.invalidate(true)
            },
            log: (message) => log('info', 'script', message),
            error: (error) => script?.error(error),
          },
          on,
          state,
          active,
        ),
      (entry) => bus?.send('log', entry),
    )
    scriptSession = new ScriptSession(script, resetScriptEffects, (status) => {
      bus?.send('script:status', status)
      publishRuntime()
    })
    noteHooks = new NoteHooks(
      (note) => script!.note(note),
      (note, source, when, inputKey) =>
        routedLiveNote(
          source,
          note.channel,
          note.key,
          note.vel,
          note.on,
          when,
          inputKey,
        ),
    )
    scriptTimeline = new ScriptTimeline(transport.clock, script)
    cues = new Cues({
      clock: transport.clock,
      queue: (at, run) => transport!.queue(at, run),
      cancel: (id) => transport!.cancelAction(id),
      isQueued: (id) => transport!.scheduler.isQueued(id),
      invalidate: () => transport!.scheduler.invalidate(true),
      changed: () => {
        transport!.changed()
        publishRuntime()
      },
      seek: (tick) => transport!.seek(tick),
      warn: (message) => log('error', 'cues', message),
      fired: (id) => script?.emit('cue', { id }),
      run: (action) => {
        if (action.type !== 'note') {
          runAction(action)
          return
        }
        const source = `cue-note:${++cueNoteSerial}`
        runAction(action, 1, true, source)
        const duration =
          15000 /
          transport!.clock.map.tempoAt(transport!.clock.tick) /
          transport!.clock.speed
        setTimeout(() => runAction(action, 0, false, source), duration)
      },
    })
    cues.chaseOnSeek = value.chaseCuesOnSeek ?? true
    transport.scheduler.timeline = combineTimelines(
      cues,
      scriptTimeline,
      transport.waitNotes,
    )
    transport.onSeek = () => {
      transport!.waitNotes.reset()
      transport!.tempoTrack.reset()
      cues!.seek()
      scriptTimeline?.reset()
    }
    transport.onStop = () => {
      transport!.waitNotes.reset()
      transport!.tempoTrack.reset(false)
      cues!.stop()
      scriptTimeline?.reset()
      releaseScriptNotes()
    }
    transport.grid.tempoMode = value.tempoMode ?? 'scale'
    transport.inputLatencyMs = value.audio.inputLatencyMs
    transport.resolveProject = (source) => performanceProject() ?? source
    transport.conditionContext = (tick) => ({
      ...scenes.context,
      bar: transport!.clock.map.tickToBarBeat(tick).bar,
    })
    transport.onPosition = () => {
      if (!transport!.clock.playing) cues?.pause()
      publishRuntime()
      const clock = transport!.clock
      const signature = JSON.stringify([
        clock.playing,
        clock.holding,
        clock.rate,
      ])
      if (signature !== scriptTransportSignature) {
        scriptTransportSignature = signature
        script?.emit('transport', {
          playing: clock.playing,
          holding: clock.holding,
          rate: clock.rate,
          tick: clock.tick,
        })
      }
    }
    if (project) {
      router.setProject(performanceProject() ?? project)
      await Promise.all([
        rack.synchronize(project),
        transport.synchronize(project),
      ])
      cues.configure(project.cues)
    }
    midi = new DeviceManager(
      settings?.devices ?? value.devices,
      receiveMidi,
      receiveControl,
      (ports) => {
        bus?.send('midi:ports', ports)
        midiBackend?.refresh()
        if (project && !engineClosing)
          void initialization
            ?.then(() => synchronize())
            .catch((error) => log('warn', 'midi', String(error)))
      },
      (source) => {
        noteHooks?.disconnect(source)
        bindings?.disconnect(source)
        clipActions?.disconnect(source)
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
      pressure: (action, value, source) =>
        clipActions?.pressure(action, value, source),
      parameter: currentParameter,
    })
    leds = new LedManager({
      now: () => performance.now(),
      state: () =>
        project && transport
          ? {
              project: performanceProject() ?? project,
              scriptPads,
              scriptDisplay,
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
    transport.onNoteActivity = (route, when) =>
      activity?.pulse(
        route,
        performance.now() + (when - graph!.context.currentTime) * 1000,
        'sequencer',
      )
    transport.onTimingChange = (keepBeat) => {
      leds?.invalidate(keepBeat)
      activity?.cancel('sequencer', keepBeat)
    }
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
    activity.start()
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
    await fluidBackend?.destroy()
    midiBackend?.destroy()
    midiBackend = undefined
    fluidBackend = undefined
    backend = undefined
    initialization = undefined
    throw error
  }
}
async function synchronize(
  forceScript = false,
  forceSynth = false,
): Promise<void> {
  if (!rack || !project) return
  const revision = ++syncRevision
  const commandRevision = scriptCommandRevision
  bus?.send('synth:state', { loading: true, readyIds: [] })
  if (forceSynth) {
    router?.panic()
    for (const owner of previews.keys()) previewNote(owner, 0, 0, false)
    reportKeys()
  }
  router?.setProject(performanceProject() ?? project)
  await Promise.all([
    rack.synchronize(project),
    transport?.synchronize(project, forceSynth),
  ])
  if (revision !== syncRevision) return
  cues?.configure(project.cues)
  clipActions?.configure()
  await scriptSession?.update(
    project.script,
    settings?.trustedScripts ?? [],
    forceScript && commandRevision === scriptCommandRevision,
  )
  if (revision !== syncRevision) return
  router?.setProject(performanceProject() ?? project)
  publishRuntime()
  reportSynthReady()
  for (const key of fontLoads.keys())
    if (
      !project.soundfonts.some(
        (sf) => key === `web:${sf.id}` || key === `fluid:${sf.id}`,
      )
    )
      fontLoads.delete(key)
  const ids = new Set(project.soundfonts.map((sf) => sf.id))
  backend?.prune(ids)
  fluidBackend?.prune(ids)
  graph?.latency()
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
      previous.backend?.noteOff(previous.slot, previous.key)
      const old = previous.slot
      setTimeout(() => previous.backend?.release(old), 1500)
    }
    previews.delete(owner)
  }
  if (!on || !preset || !project || !backend) return
  const token = {}
  previews.set(owner, { token, key })
  const font = project.soundfonts.find((sf) => sf.id === preset.soundfontId)
  if (!font && preset.backend !== 'midi') {
    previews.delete(owner)
    return
  }
  void (async () => {
    const instrument: Instrument = {
      id: 'audition',
      name: 'Audition',
      color: '#4cc2ff',
      backend: preset.backend ?? 'default',
      midiOut: preset.midiOut,
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
    const target = selectBackend(instrument)
    if (font && target.id !== 'midi') await load(font, target)
    const slot = await target.allocate(instrument)
    if (previews.get(owner)?.token !== token) {
      target.release(slot)
      return
    }
    previews.set(owner, { token, key, slot, backend: target })
    target.noteOn(slot, key, velocity)
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
  controlCapture = false
  bus = new Bus(event.ports[0], 'evt')
  bus.on('settings:set', (value) => {
    if (engineClosing) return
    const trustChanged =
      JSON.stringify(settings?.trustedScripts) !==
      JSON.stringify(value.trustedScripts)
    const synthChanged =
      !!settings &&
      (settings.audio.defaultSynth !== value.audio.defaultSynth ||
        JSON.stringify(settings.audio.compensationMs) !==
          JSON.stringify(value.audio.compensationMs) ||
        JSON.stringify(settings.fluid) !== JSON.stringify(value.fluid))
    settings = value
    if (trustChanged) scriptSession?.suspend()
    if (cues) cues.chaseOnSeek = value.chaseCuesOnSeek ?? true
    midi?.configure(value.devices)
    void initialize(value)
      .then(() => synchronize(false, synthChanged))
      .catch((error) => log('error', 'audio', String(error)))
  })
  bus.on('ping', () => {
    void (
      initialization ?? Promise.reject(new Error('Audio settings not received'))
    ).then(
      () => {
        bus!.send('ready', undefined)
        midi?.report()
        runtimeSignature = ''
        activity?.invalidate()
        publishRuntime()
        if (scriptSession) bus!.send('script:status', scriptSession.status)
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
  bus.respond('control:capture', ({ active }) => {
    controlCapture = active
    if (active) clipActions?.clear()
    return undefined
  })
  bus.on('control:capture', ({ active }) => {
    controlCapture = active
    if (active) clipActions?.clear()
  })
  bus.on('script:disable', () => {
    scriptCommandRevision++
    scriptSession?.stop()
  })
  bus.on('script:apply', () => {
    scriptCommandRevision++
    void synchronize(true).catch((error) =>
      log('error', 'script', String(error)),
    )
  })
  bus.on('audio:scope', ({ folder }) => {
    transport?.clipPreview.reset()
    clipActions?.clear()
    transport?.clips.reset()
    syncRevision++
    scriptCommandRevision++
    noteHooks?.clear()
    scriptSession?.clear()
    bindings?.clear()
    cues?.reset()
    activity?.clear()
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
    if (old?.script !== value.script) scriptSession?.suspend()
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
  bus.respond('clip:source', async ({ file }) => {
    if (!transport) throw Error('Wait for the engine to connect')
    const data = await transport.audio.decoder.load(file)
    return {
      key: data.key,
      durationSec: data.durationSec,
      sampleRate: data.sampleRate,
      channels: data.buffer.numberOfChannels,
      peaks: data.peaks,
    }
  })
  bus.respond('clip:snap', async ({ file, seconds }) => {
    if (!transport || !Number.isFinite(seconds))
      throw Error('Choose a valid clip position')
    const data = await transport.audio.decoder.load(file)
    return zeroCrossing(
      Array.from(
        { length: Math.min(2, data.buffer.numberOfChannels) },
        (_, i) => data.buffer.getChannelData(i),
      ),
      data.sampleRate,
      seconds,
    )
  })
  bus.on('clip:audition', (value) => {
    if (!transport || engineClosing) return
    try {
      if (!value) {
        transport.clipPreview.reset()
        return
      }
      const clip = clipSchema.parse({
        ...value,
        id: 'clip-preview',
        sync: false,
        quantize: 'now',
        launch: 'oneShot',
        loop: false,
      })
      transport.clipPreview.configure([clip])
      transport.clipPreview.launch(clip.id)
    } catch (error) {
      bus?.send('clip:preview', { state: 'stopped', error: String(error) })
    }
  })
  bus.respond('audio:spectrum', async ({ trackId }) => {
    const track = project?.tracks.find((t) => t.id === trackId)
    if (track?.kind !== 'audio' || !transport)
      throw Error('Unknown audio track')
    const { buffer } = await transport.audio.decoder.load(track.file)
    const worker = new Worker(
      new URL('./audio/spectrum.worker.ts', import.meta.url),
      { type: 'module' },
    )
    return new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (typeof data.progress === 'number') {
          bus?.send('audio:spectrumProgress', {
            trackId,
            fraction: data.progress,
          })
          return
        }
        worker.terminate()
        if (data.error) reject(Error(data.error))
        else resolve(data.result)
      }
      worker.onerror = (event) => {
        worker.terminate()
        reject(Error(event.message))
      }
      const left = buffer.getChannelData(0).slice(),
        right =
          buffer.numberOfChannels > 1
            ? buffer.getChannelData(1).slice()
            : undefined
      worker.postMessage(
        { left, right, mode: track.channelMode, rate: buffer.sampleRate },
        right ? [left.buffer, right.buffer] : [left.buffer],
      )
    })
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
  bus.on(
    'action:run',
    ({ action, value, at, pressed = true, source = 'action' }) => {
      try {
        if (action.type === 'clip')
          runAction(action, value, pressed, source, { at })
        else
          transport?.queue(at ?? 'now', () =>
            runAction(action, value, pressed, source),
          )
      } catch (error) {
        log('error', 'transport', String(error))
      }
    },
  )
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
    transport?.clipPreview.reset()
    clipActions?.clear()
    transport?.clips.stopAll()
    releaseScriptNotes()
    noteHooks?.clear()
    bindings?.clear()
    transport?.stop()
    previews.forEach((entry) => {
      if (entry.slot) entry.backend?.release(entry.slot)
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
  scriptSession?.clear()
  noteHooks?.clear()
  clipActions?.clear()
  transport?.clips.close()
  transport?.clipPreview.close()
  midi?.close()
  router?.panic()
  await leds?.close()
  activity?.close()
  await fluidBackend?.destroy()
  midiBackend?.destroy()
})
