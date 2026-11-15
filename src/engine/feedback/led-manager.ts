import type { ControlEvent } from '../midi/profile'
import type { ControllerDevice } from '../midi/device-manager'
import type { DeviceFeedback } from '../../shared/feedback'
import { TimeMap } from '../../shared/time-map'
import {
  connect,
  display,
  programChanged,
  rgb,
  selectProgram,
  setColor,
} from './arturia-mk3'
import { controlFrame, screenLines, type FeedbackState } from './frame'
import { DiffOutput, FeedbackBudget, type FeedbackOutput } from './diff-output'
export interface LedHost {
  now(): number
  state(): FeedbackState | undefined
  devices(): readonly ControllerDevice[]
  output(id: string): FeedbackOutput | undefined
  forceProgram(): boolean
  queued(deviceId: string): ReadonlySet<string>
  report(frame: DeviceFeedback): void
  warn(message: string): void
}
interface Session {
  device: ControllerDevice
  profileId: string
  outputId?: string
  sender?: DiffOutput
  flashes: Map<string, number>
  forceProgram: boolean
  screen: string
  frame: string
  report: string
}
export class LedManager {
  private budget = new FeedbackBudget()
  private sessions = new Map<string, Session>()
  private beats: { tick: number; when: number }[] = []
  private beat?: { tick: number; when: number }
  private timer?: ReturnType<typeof setInterval>
  private beatTimer?: ReturnType<typeof setTimeout>
  private serial = 0
  private retiring = new Map<string, Promise<void>>()
  private closing?: Promise<void>
  private stopping = false
  constructor(private host: LedHost) {}
  start(): void {
    if (!this.timer && !this.stopping) {
      this.tick()
      this.timer = setInterval(() => this.tick(), 20)
    }
  }
  beatAt(tick: number, when: number): void {
    if (this.stopping || !Number.isFinite(when)) return
    if (
      !this.beats.some((b) => b.tick === tick && Math.abs(b.when - when) < 0.5)
    )
      this.beats.push({ tick, when })
    this.beats.sort((a, b) => a.when - b.when)
    this.armBeat()
  }
  private armBeat(): void {
    clearTimeout(this.beatTimer)
    if (this.beats[0] && !this.stopping)
      this.beatTimer = setTimeout(
        () => this.tick(),
        Math.max(1, Math.ceil(this.beats[0].when - this.host.now())),
      )
  }
  invalidate(keepBeat = false): void {
    clearTimeout(this.beatTimer)
    this.beats = []
    if (!keepBeat) this.beat = undefined
    for (const session of this.sessions.values())
      session.sender?.invalidateFuture()
  }
  control(event: ControlEvent): void {
    const session = this.sessions.get(event.deviceId)
    if (!session) return
    if (event.controlId.startsWith('pad.') && event.pressed)
      session.flashes.set(event.controlId, this.host.now() + 110)
    if (event.edge === 'release') {
      const id = session.device.profile.controls.find(
        (c) => c.id === event.controlId,
      )?.ledId
      // A conservative refresh also works with firmware that repaints on release.
      if (id !== undefined) session.sender?.forget(`rgb:${id}`)
    }
    this.tick()
  }
  sysex(deviceId: string, data: Uint8Array): void {
    if (programChanged(data) === null) return
    const session = this.sessions.get(deviceId)
    if (session?.sender) {
      session.sender.reset()
      session.screen = ''
      session.frame = ''
      session.sender.write('connect', connect(), this.host.now(), -100)
      this.tick()
    }
  }
  private sync(): void {
    const devices = this.host.devices()
    for (const [id, session] of this.sessions) {
      const device = devices.find((d) => d.id === id)
      if (
        !device ||
        device.profile.id !== session.profileId ||
        device.outputId !== session.outputId
      ) {
        this.sessions.delete(id)
        const outputId = session.outputId
        const work = this.retire(session)
        if (outputId) {
          this.retiring.set(outputId, work)
          void work.finally(() => {
            if (this.retiring.get(outputId) === work)
              this.retiring.delete(outputId)
          })
        }
        this.host.report({ deviceId: id, status: 'off', controls: {} })
      }
    }
    for (const device of devices) {
      if (device.outputId && this.retiring.has(device.outputId)) continue
      let session = this.sessions.get(device.id)
      if (!session) {
        const output =
          device.profile.feedback === 'arturia-mk3' && device.outputId
            ? this.host.output(device.outputId)
            : undefined
        session = {
          device,
          profileId: device.profile.id,
          outputId: device.outputId,
          flashes: new Map(),
          forceProgram: this.host.forceProgram(),
          screen: '',
          frame: '',
          report: '',
          ...(output
            ? {
                sender: new DiffOutput(
                  output,
                  `${device.id}:${++this.serial}`,
                  this.budget,
                  () => this.host.now(),
                  (message) => this.host.warn(`${device.name}: ${message}`),
                ),
              }
            : {}),
        }
        this.sessions.set(device.id, session)
        if (session.sender) {
          if (session.forceProgram)
            session.sender.write(
              'program',
              selectProgram(0),
              this.host.now(),
              -200,
            )
          session.sender.write('connect', connect(), this.host.now(), -100)
        }
      } else {
        session.device = device
        if (
          this.host.forceProgram() &&
          !session.forceProgram &&
          session.sender
        ) {
          session.sender.reset()
          session.screen = ''
          session.frame = ''
          session.sender.write(
            'program',
            selectProgram(0),
            this.host.now(),
            -200,
          )
          session.sender.write('connect', connect(), this.host.now(), -100)
        }
        session.forceProgram = this.host.forceProgram()
      }
    }
  }
  private blink(state: FeedbackState, time: number): boolean {
    const map = new TimeMap(state.project),
      pos = map.tickToBarBeat(state.tick),
      beatMs =
        ((60000 / map.tempoAt(state.tick)) * 4) /
        pos.den /
        Math.max(0.01, state.rate)
    return state.playing && !state.holding
      ? this.beat
        ? (time - this.beat.when) % beatMs < beatMs / 2
        : pos.tickInBeat / ((480 * 4) / pos.den) < 0.5
      : time % beatMs < beatMs / 2
  }
  private hardware(
    session: Session,
    frame: DeviceFeedback['controls'],
    when: number,
  ): void {
    for (const control of session.device.profile.controls) {
      if (control.ledId === undefined || !frame[control.id]) continue
      const value = frame[control.id]
      session.sender?.write(
        `rgb:${control.ledId}`,
        setColor(control.ledId, rgb(value.color, value.level)),
        when,
      )
    }
  }
  tick(): void {
    if (this.stopping) return
    const state = this.host.state()
    if (!state) return
    this.sync()
    const now = this.host.now()
    let promoted = false
    while (this.beats[0]?.when <= now) {
      this.beat = this.beats.shift()
      promoted = true
    }
    for (const session of this.sessions.values()) {
      for (const [id, until] of session.flashes)
        if (until <= now) session.flashes.delete(id)
      const position = state.playing && this.beat ? this.beat.tick : state.tick,
        current = { ...state, tick: position },
        map = new TimeMap(state.project),
        options = {
          time: now,
          blink: this.blink(current, now),
          ...(state.playing && this.beat
            ? { beat: map.tickToBarBeat(this.beat.tick).beat }
            : {}),
          flashes: session.flashes,
          queued: this.host.queued(session.device.id),
        },
        controls = controlFrame(session.device.profile, current, options),
        signature = JSON.stringify(controls)
      session.sender?.advance()
      if (signature !== session.frame) {
        if (session.sender?.hasFuture()) session.sender.invalidateFuture()
        session.frame = signature
      }
      this.hardware(
        session,
        controls,
        promoted && this.beat ? this.beat.when : now,
      )
      for (const beat of this.beats) {
        if (beat.when > now + 30) break
        const next = { ...state, tick: beat.tick },
          future = controlFrame(session.device.profile, next, {
            ...options,
            time: beat.when,
            blink: true,
            beat: map.tickToBarBeat(beat.tick).beat,
          })
        this.hardware(session, future, beat.when)
      }
      const lines = screenLines(current),
        screen = JSON.stringify([
          lines[0],
          map.tickToBarBeat(position).bar,
          Math.round(state.rate * 100),
          state.project.follow.mode,
          state.holding,
        ])
      if (session.sender && screen !== session.screen) {
        session.sender.write('display', display(...lines), now, 1)
        session.screen = screen
      }
      session.sender?.flush()
      const result: DeviceFeedback = {
          deviceId: session.device.id,
          status: session.sender?.error
            ? 'error'
            : session.sender
              ? 'active'
              : 'off',
          controls,
          ...(session.sender?.error ? { error: session.sender.error } : {}),
        },
        report = JSON.stringify(result)
      if (report !== session.report) {
        session.report = report
        this.host.report(result)
      }
    }
    this.armBeat()
  }
  private async retire(session: Session): Promise<void> {
    const sender = session.sender
    if (!sender || (session.outputId && !this.host.output(session.outputId)))
      return
    sender.reset()
    sender.write('disconnect', connect(false), this.host.now(), -300)
    const deadline = this.host.now() + 1250
    do {
      sender.flush()
      if (sender.empty || sender.error) break
      await new Promise((resolve) => setTimeout(resolve, 10))
    } while (this.host.now() < deadline)
    if (!sender.empty && !sender.error)
      this.host.warn(`${session.device.name}: feedback disconnect timed out`)
    if (!sender.error) await new Promise((resolve) => setTimeout(resolve, 25))
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.stopping = true
    clearInterval(this.timer)
    clearTimeout(this.beatTimer)
    this.timer = undefined
    this.closing = Promise.all([
      ...this.retiring.values(),
      ...[...this.sessions.values()].map((s) => this.retire(s)),
    ]).then(() => {
      this.sessions.clear()
      this.beats = []
      this.beat = undefined
    })
    return this.closing
  }
}
