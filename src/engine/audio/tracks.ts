import type { Project, AudioTrack as Track } from '../../shared/model'
import type { Bus } from '../../shared/bus'
import type { TransportClock } from '../transport/clock'
import { AudioDecoder, type DecodedAudio } from './decode'
import { AudioGraph } from './graph'
import { AudioTrack } from './audio-track'
export class AudioTracks {
  readonly decoder: AudioDecoder
  private players = new Map<string, AudioTrack>()
  private configs = new Map<string, string>()
  private project?: Project
  private serial = Promise.resolve()
  private revision = 0
  private aligned = 0
  private dirty = true
  private lastDeadline: number | null = null
  private scope: string | undefined
  constructor(
    private graph: AudioGraph,
    private clock: TransportClock,
    private deadline: () => number | null,
    private bus: () => Bus | undefined,
    private warn: (message: string) => void,
  ) {
    this.decoder = new AudioDecoder(
      graph.context,
      (file, sampleRate) =>
        this.bus()!.request('audio:resolve', { file, sampleRate }),
      async (file, key, data) => {
        await this.bus()!.request('audio:cache', { file, key, data })
      },
      warn,
    )
  }
  setScope(folder: string): void {
    if (this.scope === folder) return
    this.scope = folder
    this.revision++
    for (const player of this.players.values()) player.close()
    this.players.clear()
    this.configs.clear()
    this.decoder.clear()
  }
  async load(trackId: string, file: string): Promise<DecodedAudio> {
    const scope = this.scope
    this.bus()?.send('audio:state', { trackId, loading: true })
    try {
      const data = await this.decoder.load(file)
      if (scope !== this.scope)
        throw Error('Audio import cancelled because the project changed')
      this.bus()?.send('audio:peaks', {
        trackId,
        file,
        key: data.key,
        durationSec: data.durationSec,
        sampleRate: data.sampleRate,
        peaks: data.peaks,
      })
      this.bus()?.send('audio:state', { trackId, loading: false })
      return data
    } catch (e) {
      if (scope === this.scope)
        this.bus()?.send('audio:state', {
          trackId,
          loading: false,
          error: String(e),
        })
      throw e
    }
  }
  synchronize(project: Project): Promise<void> {
    this.project = project
    const revision = ++this.revision
    const work = this.serial.then(async () => {
      if (revision !== this.revision) return
      const tracks = project.tracks.filter(
          (t): t is Track => t.kind === 'audio',
        ),
        ids = new Set(tracks.map((t) => t.id))
      for (const [id, player] of this.players)
        if (!ids.has(id)) {
          player.close()
          this.players.delete(id)
          this.configs.delete(id)
        }
      for (const track of tracks) {
        if (revision !== this.revision) return
        const route = this.graph.route(track.toCue),
          config = JSON.stringify([
            track,
            route.context === this.graph.context ? 'main' : 'cue',
            this.clock.playing,
          ])
        let player = this.players.get(track.id)
        if (
          this.configs.get(track.id) === config &&
          player?.route.destination === route.destination
        ) {
          const data = player!.decoded
          this.bus()?.send('audio:peaks', {
            trackId: track.id,
            file: track.file,
            key: data.key,
            durationSec: data.durationSec,
            sampleRate: data.sampleRate,
            peaks: data.peaks,
          })
          continue
        }
        try {
          const decoded = await this.load(track.id, track.file)
          if (revision !== this.revision) return
          if (
            !player ||
            player.decoded.key !== decoded.key ||
            player.route.context !== route.context ||
            player.route.destination !== route.destination
          ) {
            player?.close()
            player = await AudioTrack.create(route, decoded)
            if (revision !== this.revision) {
              player.close()
              return
            }
            this.players.set(track.id, player)
          }
          player.configure(
            track,
            track.mode === 'auto' &&
              (!project.tracks.some((t) => t.solo) || track.solo),
          )
          this.configs.set(track.id, config)
          this.dirty = true
        } catch (e) {
          this.warn(String(e))
          player?.close()
          this.players.delete(track.id)
          this.configs.delete(track.id)
        }
      }
      this.refresh(true)
      this.decoder.prune(
        new Set([...this.players.values()].map((p) => p.decoded.key)),
      )
    })
    this.serial = work.catch((e) => this.warn(String(e)))
    return work
  }
  refresh(force = false): void {
    if (!this.project) return
    if (force || this.dirty) {
      this.lastDeadline = this.deadline()
      const solo = this.project.tracks.some((t) => t.solo)
      for (const track of this.project.tracks) {
        if (track.kind !== 'audio') continue
        const player = this.players.get(track.id)
        if (!player) continue
        player.configure(track, track.mode === 'auto' && (!solo || track.solo))
        player.schedule(track, this.clock, this.deadline())
      }
      this.dirty = false
      this.aligned = this.clock.now()
    }
  }
  tick(): void {
    if (this.deadline() !== this.lastDeadline) this.refresh(true)
    if (
      this.clock.playing &&
      this.clock.now() - this.aligned >= 5 &&
      [...this.players.values()].some(
        (p) => p.route.context !== this.graph.context,
      )
    )
      this.refresh(true)
    for (const player of this.players.values()) player.tick(this.clock.now())
  }
  activity(): import('../../shared/activity').ActivityRoute[] {
    if (!this.project || !this.clock.playing || this.clock.holding) return []
    if (this.clock.contextAt(this.clock.raw) > this.clock.now() + 1e-7)
      return []
    const solo = this.project.tracks.some((t) => t.solo),
      song = this.clock.songAt()
    return this.project.tracks.flatMap((track) =>
      track.kind === 'audio' &&
      track.mode === 'auto' &&
      (!solo || track.solo) &&
      this.players.has(track.id) &&
      song >= track.offsetSec &&
      song < track.offsetSec + track.durationSec
        ? [{ sourceId: `audio:${track.id}`, trackId: track.id }]
        : [],
    )
  }
  get latency(): number {
    return Math.max(0, ...[...this.players.values()].map((p) => p.latency))
  }
}
