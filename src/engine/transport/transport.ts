import { BeatGrid } from './beat-grid'
import { Metronome } from './metronome'
import { AudioGraph } from '../audio/graph'
import { AudioTracks } from '../audio/tracks'
import type { Project, SoundFontRef } from '../../shared/model'
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
  readonly clock: TransportClock
  readonly scheduler: Scheduler
  readonly actions: Actions
  readonly audio: AudioTracks
  readonly grid: BeatGrid
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
        const m = this.project?.metronome
        if (m?.audible)
          this.metronome.click(
            when,
            this.clock.map.tickToBarBeat(tick).beat === 1,
            m.toCue,
          )
      },
      () => this.metronome.cancel(),
    )
    this.scheduler = new Scheduler(this.clock, this.output)
    this.audio = new AudioTracks(
      graph,
      this.clock,
      () => this.scheduler.audioDeadline(),
      this.bus,
      warn,
    )
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
      patch: (patch) => this.bus()?.send('doc:patch', patch),
      app: (cmd) => this.bus()?.send('app', { cmd }),
      pending: (cmd) => warn(`${cmd} is not available yet`),
    })
    this.worker.onmessage = () => {
      if (this.syncing) return
      this.scheduler.tick()
      this.audio.tick()
      this.metronome.tick(this.context.currentTime)
      this.report()
      this.armDeadline()
    }
  }
  synchronize(project: Project): Promise<void> {
    if (
      this.project?.metronome.audible !== project.metronome.audible ||
      this.project.metronome.toCue !== project.metronome.toCue
    )
      this.metronome.cancel()
    this.project = project
    const signature = JSON.stringify({
      tempos: project.tempos,
      timeSigs: project.timeSigs,
      keySigs: project.keySigs,
      beatAnchors: project.beatAnchors,
      mapOwner: project.mapOwner,
      lengthTicks: project.lengthTicks,
      loop: project.loop,
      soundfonts: project.soundfonts,
      instruments: project.instruments,
      patch: project.base.patch,
      tracks: [...project.tracks]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((t) =>
          t.kind === 'midi'
            ? {
                id: t.id,
                kind: t.kind,
                notes: t.notes,
                events: t.events,
                mode: t.mode,
                solo: t.solo,
                volume: t.volume,
                pan: t.pan,
              }
            : { id: t.id, mode: t.mode, solo: t.solo },
        ),
    })
    if (signature === this.signature) {
      if (this.gridSeek !== undefined) {
        this.clock.seek(this.gridSeek)
        this.gridSeek = undefined
        this.scheduler.invalidate(false)
      }
      return this.audio.synchronize(project).then(() => this.changed())
    }
    this.signature = signature
    const epoch = ++this.epoch
    this.scheduler.invalidate(false)
    this.syncing = true
    this.worker.postMessage('stop')
    clearTimeout(this.deadline)
    const work = this.serial.then(async () => {
      if (epoch !== this.epoch) return
      this.clock.setMap(new TimeMap(project))
      this.clock.setLoop(project.loop)
      if (this.gridSeek !== undefined) {
        this.clock.seek(this.gridSeek)
        this.gridSeek = undefined
      }
      await this.output.synchronize(project)
      if (epoch !== this.epoch) return
      this.scheduler.setProject(project)
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
      if (this.project && this.clock.tick >= this.project.lengthTicks)
        this.clock.seek(
          this.project.loop.enabled ? this.project.loop.startTick : 0,
        )
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
  seek(tick: number): void {
    this.clock.seek(Math.min(this.project?.lengthTicks ?? tick, tick))
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
    if (!this.syncing) this.scheduler.tick()
    this.audio.refresh(true)
    this.report()
    this.armDeadline()
  }
  private report(): void {
    const c = this.clock
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
  stop(): void {
    this.playRevision++
    this.starting = false
    this.clock.pause()
    this.scheduler.clearActions()
    this.scheduler.invalidate(false)
    this.changed()
  }
}
