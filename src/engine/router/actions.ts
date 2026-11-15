import type { Action, Project } from '../../shared/model'
import type { TransportClock } from '../transport/clock'
import type { Scheduler } from '../transport/scheduler'
export interface ActionHost {
  clock: TransportClock
  scheduler: Scheduler
  project: () => Project | undefined
  play: () => Promise<void>
  cancelPlay: () => void
  tap: () => void
  tapBeat: () => void
  rate: (rate: number) => void
  changed: () => void
  patch: (patch: Partial<Project>) => void
  app: (cmd: string) => void
  pending: (cmd: string) => void
}
export class Actions {
  private stopped = false
  constructor(private host: ActionHost) {}
  run(action: Action, value = 1): void {
    const h = this.host,
      p = h.project()
    if (!p) return
    if (action.type === 'param' && action.target === 'rate') {
      h.rate(
        Math.max(
          0.25,
          Math.min(
            2,
            action.min +
              (action.max - action.min) * Math.max(0, Math.min(1, value)),
          ),
        ),
      )
      return
    }
    if (action.type === 'app') {
      h.app(action.cmd)
      return
    }
    if (action.type !== 'transport') {
      h.pending(action.type)
      return
    }
    const cmd = action.cmd,
      c = h.clock
    if (cmd !== 'stop') this.stopped = false
    switch (cmd) {
      case 'toggle':
        if (c.playing) {
          h.cancelPlay()
          c.pause()
        } else {
          void h.play()
          return
        }
        break
      case 'play':
        void h.play()
        return
      case 'pause':
        h.cancelPlay()
        c.pause()
        break
      case 'stop':
        h.cancelPlay()
        c.pause()
        if (this.stopped) c.seek(p.loop.enabled ? p.loop.startTick : 0)
        this.stopped = true
        h.scheduler.clearActions()
        break
      case 'record':
        if (
          !c.recording &&
          !p.tracks.some((t) => t.kind === 'midi' && t.armed)
        ) {
          h.app('record:armRequired')
          return
        }
        c.recording = !c.recording
        if (c.recording && !c.playing) void h.play()
        break
      case 'toStart':
        c.seek(0)
        break
      case 'rewind': {
        const pos = c.map.tickToBarBeat(c.tick)
        c.seek(
          c.map.barToTick(
            Math.max(1, pos.bar - Math.max(1, Math.round(value))),
          ),
        )
        break
      }
      case 'forward':
        c.seek(
          Math.min(
            p.lengthTicks,
            c.map.barToTick(
              c.map.tickToBarBeat(c.tick).bar + Math.max(1, Math.round(value)),
            ),
          ),
        )
        break
      case 'scrub':
        c.seek(Math.max(0, Math.min(p.lengthTicks, c.tick + value * 480)))
        break
      case 'loopToggle':
        h.patch({ loop: { ...p.loop, enabled: !p.loop.enabled } })
        break
      case 'loopStartHere':
        h.patch({
          loop: {
            ...p.loop,
            startTick: Math.min(Math.round(c.tick), p.loop.endTick - 1),
          },
        })
        break
      case 'loopEndHere':
        h.patch({
          loop: {
            ...p.loop,
            endTick: Math.max(Math.round(c.tick), p.loop.startTick + 1),
          },
        })
        break
      case 'metronome':
        h.patch({
          metronome: { ...p.metronome, audible: !p.metronome.audible },
        })
        break
      case 'skipHold':
        h.scheduler.releaseHold()
        break
      case 'tap':
        h.tap()
        return
      case 'tapBeat':
        h.tapBeat()
        return
    }
    h.scheduler.invalidate(cmd === 'skipHold')
    h.changed()
  }
}
