import type {
  FollowMode,
  Timing,
  TrackMode,
  XmApi,
  Zone,
} from '../../shared/script-api'
import type { Project } from '../../shared/model'
import { zoneSchema } from '../../shared/schema'
export interface ApiHost {
  project(): Project
  position(): {
    bar: number
    beat: number
    tick: number
    playing: boolean
    rate: number
  }
  play(): void | Promise<void>
  stop(): void
  seekBar(bar: number): void
  setRate(rate: number): void
  hold(): void
  release(): void
  scene(): string | null
  activate(id: string | null, at: Timing): void
  registers(): readonly boolean[]
  register(index: number, on: boolean): void
  zones(zones: Zone[]): void
  patch(trackId: string, instrumentIds: string[]): void
  mode(trackId: string): TrackMode
  setMode(trackId: string, mode: TrackMode): void
  playNote(trackId: string, key: number, vel: number, beats: number): void
  clip(id: string): ReturnType<XmApi['clip']>
  follow(): FollowMode
  setFollow(mode: FollowMode): void
  pad(n: number): string
  setPad(n: number, color: string): void
  display(line1: string, line2: string): void
  log(message: string): void
  error(error: unknown): void
}
export function createApi(
  host: ApiHost,
  on: XmApi['on'],
  state: Record<string, unknown>,
  active: () => boolean,
): XmApi {
  function call<T>(fn: () => T, fallback: T): T {
    if (!active()) return fallback
    try {
      return fn()
    } catch (error) {
      host.error(error)
      return fallback
    }
  }
  function effect(fn: () => unknown): void {
    call(() => {
      const result = fn()
      if (result && typeof (result as PromiseLike<unknown>).then === 'function')
        void Promise.resolve(result).catch((error) => host.error(error))
    }, undefined)
  }
  function number(
    value: number,
    name: string,
    min: number,
    max: number,
    integer = false,
  ): number {
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new Error(
        `${name}: expected ${integer ? 'an integer ' : ''}between ${min} and ${max}`,
      )
    return value
  }
  const register = (index: number): number =>
    number(index, 'Register index', 0, 7, true)
  const pad = (index: number): number =>
    number(index, 'Pad number', 1, 16, true)
  function track(id: string): void {
    if (!host.project().tracks.some((track) => track.id === id))
      throw new Error(`Unknown track: ${id}`)
  }
  return {
    on,
    state,
    transport: {
      play: () => effect(() => host.play()),
      stop: () => effect(() => host.stop()),
      seekBar: (bar) =>
        effect(() =>
          host.seekBar(number(bar, 'Bar', 1, Number.MAX_SAFE_INTEGER, true)),
        ),
      get bar() {
        return call(() => host.position().bar, 1)
      },
      get beat() {
        return call(() => host.position().beat, 1)
      },
      get playing() {
        return call(() => host.position().playing, false)
      },
      get rate() {
        return call(() => host.position().rate, 1)
      },
      setRate: (rate) =>
        effect(() => host.setRate(number(rate, 'Rate', 0.25, 2))),
      hold: () => effect(() => host.hold()),
      release: () => effect(() => host.release()),
    },
    scene: {
      get current() {
        return call(() => host.scene(), null)
      },
      activate: (id, at = 'now') =>
        effect(() => {
          if (
            id !== null &&
            !host.project().scenes.some((scene) => scene.id === id)
          )
            throw new Error(`Unknown scene: ${id}`)
          if (!['now', 'beat', 'bar'].includes(at))
            throw new Error('Scene timing: choose now, beat or bar')
          host.activate(id, at)
        }),
    },
    registers: {
      get: (index) => call(() => !!host.registers()[register(index)], false),
      set: (index, on) =>
        effect(() => {
          if (typeof on !== 'boolean')
            throw new Error('Register value: expected a boolean')
          host.register(register(index), on)
        }),
      toggle: (index) =>
        effect(() => {
          const i = register(index)
          host.register(i, !host.registers()[i])
        }),
    },
    zones: {
      set: (zones) =>
        effect(() => {
          const parsed = zoneSchema.array().parse(zones)
          const ids = new Set<string>()
          for (const zone of parsed) {
            if (ids.has(zone.id)) throw new Error(`Duplicate zone: ${zone.id}`)
            ids.add(zone.id)
            for (const id of zone.trackIds)
              if (
                !host
                  .project()
                  .tracks.some((t) => t.id === id && t.kind === 'midi')
              )
                throw new Error(`Zone ${zone.id}: unknown MIDI track ${id}`)
          }
          host.zones(parsed)
        }),
    },
    patch: {
      set: (trackId, instrumentIds) =>
        effect(() => {
          if (
            !host
              .project()
              .tracks.some((t) => t.id === trackId && t.kind === 'midi')
          )
            throw new Error(`Unknown MIDI track: ${trackId}`)
          if (
            !Array.isArray(instrumentIds) ||
            instrumentIds.some(
              (id) => !host.project().instruments.some((i) => i.id === id),
            )
          )
            throw new Error('Patch: choose existing instrument IDs')
          host.patch(trackId, [...new Set(instrumentIds)])
        }),
    },
    track: (id) => ({
      get mode() {
        return call(() => {
          track(id)
          return host.mode(id)
        }, 'mute')
      },
      set mode(mode) {
        effect(() => {
          track(id)
          if (
            !['auto', 'live', 'mute'].includes(mode) ||
            (mode === 'live' &&
              host.project().tracks.find((t) => t.id === id)?.kind === 'audio')
          )
            throw new Error(
              'Track mode: choose auto/live/mute for MIDI or auto/mute for audio',
            )
          host.setMode(id, mode)
        })
      },
      playNote: (key, vel, beats) =>
        effect(() => {
          if (
            !host.project().tracks.some((t) => t.id === id && t.kind === 'midi')
          )
            throw new Error(`Unknown MIDI track: ${id}`)
          host.playNote(
            id,
            number(key, 'Key', 0, 127, true),
            number(vel, 'Velocity', 1, 127, true),
            number(beats, 'Note duration in quarter beats', 1 / 480, 4096),
          )
        }),
    }),
    clip: (id) => {
      const get = () => {
        if (!host.project().clips.some((clip) => clip.id === id))
          throw new Error(`Unknown clip: ${id}`)
        return host.clip(id)
      }
      return {
        launch: () => effect(() => get().launch()),
        stop: () => effect(() => get().stop()),
        get playing() {
          return call(() => get().playing, false)
        },
        get semitones() {
          return call(() => get().semitones, 0)
        },
        set semitones(value) {
          effect(() => {
            get().semitones = number(
              value,
              'Clip semitones',
              -Number.MAX_VALUE,
              Number.MAX_VALUE,
            )
          })
        },
        get gain() {
          return call(() => get().gain, 0)
        },
        set gain(value) {
          effect(() => {
            get().gain = number(value, 'Clip gain', 0, Number.MAX_VALUE)
          })
        },
      }
    },
    follow: {
      get mode() {
        return call(() => host.follow(), 'written')
      },
      set: (mode) =>
        effect(() => {
          if (!['written', 'waitNotes', 'tempoTrack'].includes(mode))
            throw new Error(
              'Follow mode: choose written, waitNotes or tempoTrack',
            )
          host.setFollow(mode)
        }),
    },
    pad: (n) => ({
      get color() {
        return call(() => host.pad(pad(n)), '#4cc2ff')
      },
      set color(color) {
        effect(() => {
          if (!/^#[a-f\d]{6}$/i.test(color))
            throw new Error('Pad colour: use #rrggbb')
          host.setPad(pad(n), color)
        })
      },
    }),
    display: (line1, line2) =>
      effect(() => {
        if (typeof line1 !== 'string' || typeof line2 !== 'string')
          throw new Error('Display: supply two text lines')
        host.display(line1.slice(0, 32), line2.slice(0, 32))
      }),
    log: (message) => effect(() => host.log(String(message))),
  }
}
