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
    private context: AudioContext,
    backend: SynthBackend,
    load: (font: SoundFontRef) => Promise<void>,
    private bus: () => Bus | undefined,
    private warn: (message: string) => void,
  ) {
    this.clock = new TransportClock(
      new TimeMap(newProject()),
      () => context.currentTime,
    )
    this.output = new SequenceOutput(
      backend,
      load,
      () => context.currentTime,
      warn,
      () => undefined,
    )
    this.scheduler = new Scheduler(this.clock, this.output)
    this.scheduler.onEnd = () => this.changed()
    this.scheduler.onBoundary = () => this.changed()
    this.actions = new Actions({
      clock: this.clock,
      scheduler: this.scheduler,
      project: () => this.project,
      play: () => this.play(),
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
      this.report()
      this.armDeadline()
    }
  }
  synchronize(project: Project): Promise<void> {
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
    if (signature === this.signature) return this.serial
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
      await this.output.synchronize(project)
      if (epoch !== this.epoch) return
      this.scheduler.setProject(project)
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
      this.clock.play()
      this.scheduler.invalidate(false)
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
    this.worker.postMessage(
      this.clock.playing && !this.syncing ? 'start' : 'stop',
    )
    window.engineHost.setPlaying(this.clock.playing)
    if (!this.syncing) this.scheduler.tick()
    this.report()
    this.armDeadline()
  }
  private report(): void {
    const c = this.clock
    this.bus()?.send('transport', {
      playing: c.playing,
      holding: c.holding,
      recording: c.recording,
      tick: c.tick,
      rate: c.rate,
      followFactor: c.followFactor,
      perfTime: performance.timeOrigin + performance.now(),
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
