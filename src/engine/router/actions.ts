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
  onSeek?: () => void
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
    const seek = (tick: number): void => {
      c.recording = false
      c.seek(tick)
      h.scheduler.clearActions()
      h.onSeek?.()
    }
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
        if (this.stopped) seek(p.loop.enabled ? p.loop.startTick : 0)
        this.stopped = true
        h.scheduler.clearActions()
        break
      case 'recordMode':
        if (!c.recording)
          h.patch({
            record: {
              mode: p.record?.mode === 'replace' ? 'overdub' : 'replace',
              preRollBars: p.record?.preRollBars ?? 0,
            },
          })
        return
      case 'record':
        if (
          !c.recording &&
          !p.tracks.some((t) => t.kind === 'midi' && t.armed)
        ) {
          h.app('record:armRequired')
          return
        }
        if (!c.recording) {
          const bars = p.record?.preRollBars ?? 0
          c.punchRaw = c.raw
          if (!c.playing && bars && c.tick < p.lengthTicks) {
            const punch = c.tick
            const pos = c.map.tickToBarBeat(punch)
            seek(
              pos.bar <= bars
                ? 0
                : c.map.barToTick(pos.bar - bars) +
                    punch -
                    c.map.barToTick(pos.bar),
            )
            c.punchRaw = c.map.tickToSec(punch)
          } else if (!c.playing && p.loop.enabled && c.tick >= p.lengthTicks) c.punchRaw = 0
        }
        c.recording = !c.recording
        if (c.recording && !c.playing) void h.play()
        break
      case 'toStart':
        seek(0)
        break
      case 'rewind': {
        const pos = c.map.tickToBarBeat(c.tick)
        seek(
          c.map.barToTick(
            Math.max(1, pos.bar - Math.max(1, Math.round(value))),
          ),
        )
        break
      }
      case 'forward':
        seek(
          Math.min(
            p.lengthTicks,
            c.map.barToTick(
              c.map.tickToBarBeat(c.tick).bar + Math.max(1, Math.round(value)),
            ),
          ),
        )
        break
      case 'scrub':
        seek(Math.max(0, Math.min(p.lengthTicks, c.tick + value * 480)))
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
