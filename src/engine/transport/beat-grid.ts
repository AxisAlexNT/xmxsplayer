import { editTempo } from '../../shared/bar-edit'
import type { Project, TempoMode } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'
import { TapTempo, applyBeatMap } from '../../shared/beat-grid'
import type { TransportClock } from './clock'
export class BeatGrid {
  tempoMode: TempoMode = 'scale'
  private tempo = new TapTempo()
  private session: EventMap['grid:taps'] = {
    active: false,
    trackId: null,
    anchors: [],
    unit: 'beat',
  }
  constructor(
    private clock: TransportClock,
    private project: () => Project | undefined,
    private rate: (rate: number) => void,
    private apply: (patch: Partial<Project>, tick?: number) => void,
    private report: (state: EventMap['grid:taps']) => void,
    private warn: (message: string) => void,
  ) {}
  tap(): void {
    const bpm = this.tempo.tap(this.clock.now()),
      p = this.project()
    if (!bpm || !p) return
    if (this.clock.playing)
      this.rate(
        Math.max(
          0.25,
          Math.min(2, bpm / this.clock.map.tempoAt(this.clock.tick)),
        ),
      )
    else {
      try {
        const { tempos, lengthTicks } = editTempo(
          p,
          this.clock.tick,
          bpm,
          this.tempoMode,
        )
        this.apply({ tempos, lengthTicks })
      } catch (error) {
        this.warn(String(error))
      }
    }
  }
  setSession(value: {
    active: boolean
    trackId: string
    unit: 'beat' | 'bar'
    discard?: boolean
  }): void {
    const p = this.project()
    if (!p) return
    if (value.active) {
      if (p.mapOwner !== null) throw Error('The linked score owns the bar grid')
      if (p.loop.enabled)
        throw Error('Turn looping off before tapping a beat map')
      if (!p.tracks.some((t) => t.kind === 'audio' && t.id === value.trackId))
        throw Error('Select an audio track first')
      this.session = {
        active: true,
        trackId: value.trackId,
        unit: value.unit,
        anchors: [],
      }
    } else if (this.session.active) {
      if (!value.discard)
        this.applyAnchors(this.session.trackId!, this.session.anchors)
      this.session = { ...this.session, active: false }
    }
    this.report(this.session)
  }
  tapBeat(): void {
    if (!this.session.active) return
    const p = this.project(),
      track = p?.tracks.find((t) => t.id === this.session.trackId)
    if (track?.kind !== 'audio' || !this.clock.playing) return
    if (this.clock.contextAt(this.clock.raw) > this.clock.now()) return
    const sec = this.clock.songAt() - track.offsetSec,
      last = this.session.anchors.at(-1)
    if (sec < 0 || sec > track.durationSec) return
    if (last && sec <= last.sec + 0.02) return
    const sig = this.clock.map.signatureAt(last?.tick ?? 0),
      step = ((480 * 4) / sig.den) * (this.session.unit === 'bar' ? sig.num : 1)
    this.session = {
      ...this.session,
      anchors: [
        ...this.session.anchors,
        { tick: last ? last.tick + step : 0, sec },
      ],
    }
    this.report(this.session)
  }
  applyAnchors(trackId: string, anchors: Project['beatAnchors']): void {
    const p = this.project()
    if (!p) return
    const result = applyBeatMap(p, trackId, anchors, this.clock.songAt())
    this.apply(result.patch, result.tick)
  }
  reset(): void {
    this.tempo.reset()
    this.session = { active: false, trackId: null, anchors: [], unit: 'beat' }
    this.report(this.session)
  }
}
