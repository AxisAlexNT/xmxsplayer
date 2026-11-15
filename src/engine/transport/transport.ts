import { WaitNotes } from '../follow/wait-notes'
import type { RoutedNote } from '../../shared/recording'
import type { ClipHost } from '../clips/clip-player'
import { ClipPlayer, type ClipFrame } from '../clips/clip-player'
import { AudioClipVoice } from '../clips/clip-voice'
import type { ActivityRoute } from '../../shared/activity'
import { allPatches } from '../../shared/patches'
import type { ConditionContext } from '../../shared/conditions'
import { eventSignature, sequenceSignature } from './signature'
import { Recorder } from './recorder'
import { BeatGrid } from './beat-grid'
import { Metronome } from './metronome'
import { AudioGraph } from '../audio/graph'
import { AudioTracks } from '../audio/tracks'
import type { Project, SoundFontRef, Timing } from '../../shared/model'
import type { Bus } from '../../shared/bus'
import { TimeMap } from '../../shared/time-map'
import { newProject } from '../../shared/defaults'
import type { SynthBackend } from '../synth/backend'
import { Actions } from '../router/actions'
import { TransportClock } from './clock'
import { Scheduler } from './scheduler'
import { SequenceOutput } from './sequence-output'
import TimerWorker from './timer.worker.ts?worker'
export class Transport {
  readonly waitNotes: WaitNotes
  readonly clock: TransportClock
  readonly scheduler: Scheduler
  readonly actions: Actions
  readonly audio: AudioTracks
  readonly clips: ClipPlayer
  readonly clipPreview: ClipPlayer
  readonly grid: BeatGrid
  readonly recorder: Recorder
  private metronome: Metronome
  private gridSeek: number | undefined
  private countUntil = 0
  private countStart = 0
  private countStep = 0
  private context: AudioContext
  private output: SequenceOutput
  private worker = new TimerWorker()
  private deadline?: ReturnType<typeof setTimeout>
  private project?: Project
  private signature = ''
  private eventsSignature = ''
  inputLatencyMs = 0
  resolveProject: (project: Project) => Project = (project) => project
  conditionContext: (tick: number) => ConditionContext = (tick) => ({
    registers: [],
    activeSceneId: null,
    bar: this.clock.map.tickToBarBeat(tick).bar,
    playing: this.clock.playing,
  })
  onClipPreview: (
    state: 'stopped' | 'queued' | 'playing',
    error?: string,
  ) => void = () => undefined
  onClips: (frame: ClipFrame) => void = () => undefined
  onPosition: () => void = () => undefined
  onSeek: () => void = () => undefined
  onStop: () => void = () => undefined
  onBeat: (tick: number, when: number) => void = () => undefined
  onTimingChange: (keepBeat: boolean) => void = () => undefined
  onNoteActivity: (route: ActivityRoute, when: number) => void = () => undefined
  private serial = Promise.resolve()
  private starting = false
  private playRevision = 0
  private epoch = 0
  private syncing = false
  constructor(
    graph: AudioGraph,
    backend: SynthBackend,
    load: (font: SoundFontRef) => Promise<void>,
    private bus: () => Bus | undefined,
    private warn: (message: string) => void,
  ) {
    this.context = graph.context
    const context = this.context
    this.clock = new TransportClock(
      new TimeMap(newProject()),
      () => context.currentTime,
    )
    this.recorder = new Recorder(
      this.clock,
      () => this.project,
      () => this.inputLatencyMs,
      (take) => this.bus()?.send('recorded', take),
    )
    this.metronome = new Metronome(graph)
    this.grid = new BeatGrid(
      this.clock,
      () => this.project,
      (rate) => this.rate(rate),
      (patch, tick) => this.applyPatch(patch, tick),
      (state) => this.bus()?.send('grid:taps', state),
      warn,
    )
    this.output = new SequenceOutput(
      backend,
      load,
      () => context.currentTime,
      warn,
      (tick, when) => {
        this.onBeat(tick, when)
        const m = this.project?.metronome
        if (m?.audible)
          this.metronome.click(
            when,
            this.clock.map.tickToBarBeat(tick).beat === 1,
            m.toCue,
          )
      },
      (keepHeld) => {
        this.metronome.cancel()
        this.onTimingChange(keepHeld)
      },
      (tick) => this.conditionContext(tick),
      (route, when) => this.onNoteActivity(route, when),
    )
    this.scheduler = new Scheduler(this.clock, this.output)
    this.waitNotes = new WaitNotes({
      clock: this.clock,
      invalidate: () => this.scheduler.invalidate(true),
      changed: () => this.changed(),
    })
    this.audio = new AudioTracks(
      graph,
      this.clock,
      () => this.scheduler.audioDeadline(),
      this.bus,
      warn,
    )
    const clipHost: Omit<ClipHost, 'report' | 'warn'> = {
      clock: this.clock,
      prepare: async (clip) => {
        const route = graph.route(clip.toCue)
        await route.context.resume()
        const decoded = await this.audio.decoder.load(clip.file)
        return AudioClipVoice.create(
          route,
          decoded,
          clip,
          route.context !== graph.context,
        )
      },
      validVoice: (voice, clip) => {
        const route = graph.route(clip.toCue)
        return (
          voice instanceof AudioClipVoice &&
          voice.route.context === route.context &&
          voice.route.destination === route.destination
        )
      },
      queue: (at, run) => this.queue(at, run),
      cancel: (id) => this.cancelAction(id),
      queuedTime: (id) => this.scheduler.queuedTime(id),
      holdDeadline: () => this.scheduler.holdDeadline(),
      advance: () => this.scheduler.tick(),
    }
    this.clips = new ClipPlayer({
      ...clipHost,
      report: (frame) => this.onClips(frame),
      warn: (message, clipId) => {
        warn(message)
        if (clipId) this.bus()?.send('clip:error', { clipId, message })
      },
    })
    this.clipPreview = new ClipPlayer({
      ...clipHost,
      report: (frame) =>
        this.onClipPreview(frame.states['clip-preview'] ?? 'stopped'),
      warn: (message) => {
        warn(message)
        this.onClipPreview('stopped', message)
      },
    })
    this.scheduler.onEnd = () => this.changed()
    this.scheduler.onBoundary = () => this.changed()
    this.actions = new Actions({
      clock: this.clock,
      scheduler: this.scheduler,
      project: () => this.project,
      play: () => this.play(),
      rate: (rate) => this.rate(rate),
      tap: () => this.grid.tap(),
      tapBeat: () => this.grid.tapBeat(),
      cancelPlay: () => {
        this.playRevision++
        this.starting = false
      },
      changed: () => this.changed(),
      onSeek: () => this.onSeek(),
      patch: (patch) => this.bus()?.send('doc:patch', patch),
      app: (cmd) => this.bus()?.send('app', { cmd }),
      pending: (cmd) => warn(`${cmd} is not available yet`),
    })
    this.worker.onmessage = () => {
      this.recorder.tick()
      if (this.syncing) return
      this.onPosition()
      this.scheduler.tick()
      this.audio.tick()
      this.metronome.tick(this.context.currentTime)
      this.report()
      this.armDeadline()
    }
  }
  synchronize(project: Project): Promise<void> {
    const available = allPatches(project)
    project = this.resolveProject(project)
    if (
      this.project?.metronome.audible !== project.metronome.audible ||
      this.project.metronome.toCue !== project.metronome.toCue
    )
      this.metronome.cancel()
    this.project = project
    this.clips.configure(project.clips)
    const followChanged = this.waitNotes.configure(project)
    const signature = sequenceSignature(project)
    if (signature === this.signature) {
      const seek = this.gridSeek
      this.gridSeek = undefined
      const work = this.serial.then(async () => {
        if (this.project !== project) return
        if (seek !== undefined) {
          this.clock.seek(seek)
          this.scheduler.clearActions()
          this.onSeek()
          this.scheduler.invalidate(false)
        }
        await this.output.synchronize(project, true, available, this.clock.tick)
        await this.audio.synchronize(project)
        if (seek !== undefined || followChanged) this.changed()
        else {
          this.report()
          this.armDeadline()
        }
      })
      this.serial = work.catch((error) => this.warn(String(error)))
      return work
    }
    this.signature = signature
    const events = eventSignature(project)
    const keepHeld = events === this.eventsSignature
    this.eventsSignature = events
    const epoch = ++this.epoch
    this.scheduler.invalidate(keepHeld)
    this.syncing = true
    this.worker.postMessage('stop')
    clearTimeout(this.deadline)
    const work = this.serial.then(async () => {
      if (epoch !== this.epoch) return
      this.clock.setMap(new TimeMap(project))
      this.clock.setLoop(project.loop)
      if (this.gridSeek !== undefined) {
        this.clock.seek(this.gridSeek)
        this.scheduler.clearActions()
        this.onSeek()
        this.gridSeek = undefined
      }
      await this.output.synchronize(
        project,
        keepHeld,
        available,
        this.clock.tick,
      )
      if (epoch !== this.epoch) return
      this.scheduler.setProject(project, keepHeld)
      await this.audio.synchronize(project)
      this.syncing = false
      this.changed()
    })
    this.serial = work.catch((e) => {
      if (epoch === this.epoch) {
        this.syncing = false
        this.stop()
      }
      this.warn(String(e))
    })
    return work
  }
  applyPerformance(project: Project): void {
    this.waitNotes.configure(project)
    this.project = project
    this.clips.configure(project.clips)
    this.signature = sequenceSignature(project)
    this.eventsSignature = eventSignature(project)
    this.scheduler.setProject(project, true)
    this.output.route(project.base.patch, this.clock.tick)
    void this.audio
      .synchronize(project)
      .catch((error) => this.warn(String(error)))
    this.changed()
  }
  applyPatch(patch: Partial<Project>, tick?: number): void {
    this.gridSeek = tick
    this.bus()?.send('doc:patch', patch)
  }
  async play(): Promise<void> {
    if (this.starting) return
    this.starting = true
    const revision = ++this.playRevision
    try {
      await this.serial
      await this.context.resume()
      if (revision !== this.playRevision) return
      if (this.project && this.clock.tick >= this.project.lengthTicks) {
        this.clock.seek(
          this.project.loop.enabled ? this.project.loop.startTick : 0,
        )
        this.scheduler.clearActions()
        this.onSeek()
      }
      const p = this.project!,
        sig = this.clock.map.signatureAt(this.clock.tick),
        beatSec =
          ((60 / this.clock.map.tempoAt(this.clock.tick)) * 4) /
          sig.den /
          this.clock.speed,
        beats = p.metronome.countInBars * sig.num
      this.countStart = this.context.currentTime + this.audio.latency
      this.countStep = beatSec
      this.countUntil = beats ? this.countStart + beats * beatSec : 0
      this.clock.play(this.audio.latency + beats * beatSec)
      this.scheduler.invalidate(false)
      if (beats)
        this.metronome.countIn(
          this.countStart,
          sig.num,
          beats,
          beatSec,
          p.metronome.toCue,
        )
      this.changed()
    } catch (e) {
      this.warn(String(e))
    } finally {
      if (revision === this.playRevision) this.starting = false
    }
  }
  queue(at: Timing, run: () => void): number {
    const id = this.scheduler.queue(at, run)
    if (id) this.armDeadline()
    return id
  }
  cancelAction(id: number): void {
    this.scheduler.cancelAction(id)
    this.armDeadline()
  }
  seek(tick: number): void {
    this.clock.seek(Math.min(this.project?.lengthTicks ?? tick, tick))
    this.waitNotes.reset()
    this.scheduler.clearActions()
    this.onSeek()
    this.scheduler.invalidate(false)
    this.changed()
  }
  rate(rate: number): void {
    this.clock.setRate(rate)
    this.scheduler.invalidate(true)
    this.changed()
  }
  setLoop(loop: Project['loop']): void {
    this.clock.setLoop(loop)
    this.scheduler.invalidate(false)
    this.changed()
  }
  changed(): void {
    this.waitNotes.pause()
    this.recorder.clockChanged()
    if (
      !this.clock.playing ||
      (this.countUntil > this.context.currentTime &&
        this.clock.contextAt(this.clock.raw) <= this.context.currentTime)
    ) {
      this.metronome.cancel(true)
      this.countUntil = 0
    }
    this.worker.postMessage(
      this.clock.playing && !this.syncing ? 'start' : 'stop',
    )
    window.engineHost.setPlaying(this.clock.playing)
    this.onPosition()
    this.clips.tick()
    if (!this.syncing) this.scheduler.tick()
    this.audio.refresh(true)
    this.report()
    this.armDeadline()
  }
  private report(): void {
    const c = this.clock
    this.output.reconcile(c.tick)
    this.bus()?.send('transport', {
      countInBeat:
        c.playing && this.context.currentTime < this.countUntil
          ? Math.max(
              1,
              Math.floor(
                (this.context.currentTime - this.countStart) / this.countStep,
              ) + 1,
            )
          : 0,
      playing: c.playing,
      holding: c.holding,
      recording: c.recording,
      tick: c.tick,
      rate: c.rate,
      followFactor: c.followFactor,
      perfTime:
        performance.timeOrigin +
        performance.now() +
        Math.max(0, c.contextAt(c.raw) - this.context.currentTime) * 1000,
    })
  }
  private armDeadline(): void {
    clearTimeout(this.deadline)
    if (this.syncing) return
    const time = this.scheduler.nextDeadline()
    if (time === null) return
    this.deadline = setTimeout(
      () => {
        this.scheduler.tick()
        this.report()
        this.armDeadline()
      },
      Math.max(1, (time - this.context.currentTime) * 1000),
    )
  }
  liveNote(note: RoutedNote): void {
    this.recorder.note(note)
    this.waitNotes.note({
      ...note,
      when: (note.when ?? this.clock.now()) - this.inputLatencyMs / 1000,
    })
  }
  activity(): ActivityRoute[] {
    return [
      ...this.output.activity(this.context.currentTime),
      ...this.audio.activity(),
    ]
  }
  stop(): void {
    this.playRevision++
    this.starting = false
    this.clock.pause()
    this.scheduler.clearActions()
    this.scheduler.invalidate(false)
    this.onStop()
    this.changed()
  }
}
