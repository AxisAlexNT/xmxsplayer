import { z } from 'zod'
import type { Condition, Project, Settings } from './model'

const num = z.number().finite()
const tick = num.nonnegative()
const int = z.int()
const byte = int.min(0).max(127)
const unit = num.min(0).max(1)
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const path = z
  .string()
  .min(1)
  .refine(
    (s) =>
      !s.startsWith('/') &&
      !s.includes('\\') &&
      !s.split('/').some((p) => p === '..' || p === '.') &&
      !s.includes(':') &&
      !s.includes('\0'),
    'Expected a relative project path',
  )
const record = <T extends z.ZodType>(value: T) => z.record(z.string(), value)
const enums = <T extends string>(values: T[]) => z.enum(values)
export const keySchema = z.union([
  byte,
  z
    .string()
    .regex(/^[A-Ga-g][#b]?-?\d+$/)
    .transform((s, ctx) => {
      const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s)!
      const semis: Record<string, number> = {
        C: 0,
        D: 2,
        E: 4,
        F: 5,
        G: 7,
        A: 9,
        B: 11,
      }
      const key =
        (Number(match[3]) + 1) * 12 +
        semis[match[1].toUpperCase()] +
        (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0)
      if (key < 0 || key > 127) {
        ctx.addIssue({ code: 'custom', message: 'Key outside MIDI range' })
        return z.NEVER
      }
      return key
    }),
])
export function noteName(key: number): string {
  return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][key % 12]}${Math.floor(key / 12) - 1}`
}
const timing = enums(['now', 'beat', 'bar'])
const mode = enums(['auto', 'live', 'mute'])
const beatChase = enums(['off', 'top', 'bottom', 'all'])
export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ reg: int.min(0).max(7), on: z.boolean() }),
    z.strictObject({ scene: id }),
    z.strictObject({ bars: z.tuple([num.min(1), num.min(1)]) }),
    z.strictObject({ playing: z.boolean() }),
    z.strictObject({ all: conditionSchema.array() }),
    z.strictObject({ any: conditionSchema.array() }),
    z.strictObject({ not: conditionSchema }),
  ]),
)
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('transport'),
    cmd: enums([
      'toggle',
      'play',
      'pause',
      'stop',
      'record',
      'rewind',
      'forward',
      'toStart',
      'loopToggle',
      'loopStartHere',
      'loopEndHere',
      'tap',
      'tapBeat',
      'metronome',
      'scrub',
      'skipHold',
    ]),
  }),
  z.strictObject({
    type: z.literal('scene'),
    cmd: enums(['activate', 'next', 'prev', 'clear']),
    sceneId: id.optional(),
  }),
  z.strictObject({
    type: z.literal('register'),
    cmd: enums(['toggle', 'set', 'momentary']),
    index: int.min(0).max(7),
    on: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('note'),
    trackId: id,
    key: keySchema,
    velocity: z.union([z.literal('control'), byte]),
  }),
  z.strictObject({
    type: z.literal('param'),
    target: enums([
      'rate',
      'masterVolume',
      'track.volume',
      'track.pan',
      'instrument.volume',
      'instrument.reverb',
      'instrument.chorus',
      'audio.semitones',
      'audio.filterFreq',
    ]),
    id: id.optional(),
    min: num,
    max: num,
  }),
  z.strictObject({
    type: z.literal('trackMode'),
    trackId: id,
    mode: z.union([mode, z.literal('cycle')]),
  }),
  z.strictObject({
    type: z.literal('follow'),
    mode: enums(['written', 'waitNotes', 'tempoTrack', 'cycle']),
  }),
  z.strictObject({
    type: z.literal('cue'),
    cmd: enums(['fireNext', 'fire', 'prev', 'next']),
    cueId: id.optional(),
  }),
  z.strictObject({
    type: z.literal('clip'),
    cmd: enums([
      'launch',
      'stop',
      'sweep',
      'pitch',
      'gain',
      'stopAll',
      'stopGroup',
    ]),
    clipId: id.optional(),
    group: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal('app'),
    cmd: enums([
      'save',
      'undo',
      'redo',
      'quantize',
      'toggleFollowView',
      'toggleLanes',
      'zoomIn',
      'zoomOut',
    ]),
  }),
  z.strictObject({ type: z.literal('script'), fn: z.string().min(1) }),
])
export const bindingSchema = z.strictObject({
  control: z.string().min(1),
  edge: enums(['press', 'release', 'change']),
  when: conditionSchema.optional(),
  at: timing.optional(),
  action: actionSchema,
})
const zoneSchema = z
  .strictObject({
    id,
    lo: keySchema,
    hi: keySchema,
    trackIds: id.array(),
    transpose: int,
    velocity: z.union([enums(['linear', 'soft', 'hard']), num.positive()]),
    color,
  })
  .refine((v) => v.lo <= v.hi, { path: ['hi'], message: 'Must be at least lo' })
const patchSchema = z.strictObject({
  id,
  trackId: id,
  instrumentId: id,
  when: conditionSchema.optional(),
  transpose: int.optional(),
})
export const setupSchema = z.strictObject({
  zones: zoneSchema.array(),
  patch: patchSchema.array(),
  bindings: bindingSchema.array(),
  trackModes: record(mode),
  padColors: record(color),
  beatChase,
})
export const sceneSchema = setupSchema.partial().extend({
  id,
  name: z.string(),
  color,
  registers: z.boolean().nullable().array().length(8).optional(),
})
export const mappingSchema = z.strictObject({
  bindings: bindingSchema.array(),
  padColors: record(color),
  beatChase: beatChase.optional(),
  scenes: record(
    z.strictObject({
      bindings: bindingSchema.array().optional(),
      padColors: record(color).optional(),
    }),
  ),
})
export const clipSchema = z
  .strictObject({
    id,
    name: z.string(),
    color,
    file: path,
    startSec: tick,
    endSec: num.positive(),
    loop: z.boolean(),
    sync: z.boolean(),
    beats: num.positive(),
    launch: enums(['toggle', 'hold', 'oneShot', 'retrigger']),
    quantize: timing,
    group: z.string().optional(),
    gain: tick,
    pan: num.min(-1).max(1),
    toCue: z.boolean(),
    pressureToGain: z.boolean(),
    semitones: num,
    pitchMode: enums(['keepTempo', 'tape']),
    fadeMs: tick,
    sweep: z.strictObject({
      mode: enums(['moving', 'position', 'pitchOnly']),
      range: z.tuple([num, num]),
      releaseMs: tick,
      offBelow: unit,
    }),
  })
  .refine((v) => v.endSec > v.startSec, {
    path: ['endSec'],
    message: 'Must be after startSec',
  })
  .refine((v) => !(v.sync && v.pitchMode === 'tape'), {
    path: ['pitchMode'],
    message: 'Tape pitch cannot be tempo synced',
  })
const trackBase = {
  id,
  name: z.string(),
  color,
  mode,
  solo: z.boolean(),
  volume: unit,
  pan: num.min(-1).max(1),
  height: num.positive(),
}
export const noteSchema = z.tuple([tick, num.positive(), keySchema, byte])
export const trackSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...trackBase,
    kind: z.literal('midi'),
    notes: noteSchema.array(),
    events: z
      .strictObject({
        tick,
        type: enums(['cc', 'bend']),
        num: byte,
        value: num,
      })
      .array(),
    link: z
      .strictObject({
        sourceId: id,
        key: z.string(),
        state: enums(['synced', 'ahead']),
      })
      .optional(),
    view: enums(['staff', 'roll']),
    clef: enums(['auto', 'treble', 'bass']),
    quantGrid: num.positive(),
    armed: z.boolean(),
    leads: z.boolean(),
  }),
  z.strictObject({
    ...trackBase,
    kind: z.literal('audio'),
    file: path,
    offsetSec: num,
    durationSec: tick,
    semitones: num,
    cents: num,
    toCue: z.boolean(),
    channelMode: enums(['stereo', 'left', 'right', 'mid', 'side']),
    filter: z.strictObject({
      enabled: z.boolean(),
      type: enums(['bandpass', 'lowpass', 'highpass']),
      freq: num.positive(),
      q: num.positive(),
    }),
  }),
])
export const projectSchema = z
  .strictObject({
    version: z.literal(1),
    name: z.string().min(1),
    tempos: z.strictObject({ tick, bpm: num.positive() }).array().min(1),
    timeSigs: z
      .strictObject({
        tick,
        num: int.positive(),
        den: int.positive().refine((v) => (v & (v - 1)) === 0),
      })
      .array()
      .min(1),
    keySigs: z
      .strictObject({ tick, fifths: int.min(-7).max(7), minor: z.boolean() })
      .array(),
    beatAnchors: z.strictObject({ tick, sec: tick }).array(),
    mapOwner: id.nullable(),
    lengthTicks: tick,
    soundfonts: z
      .strictObject({
        id,
        file: z
          .string()
          .min(1)
          .refine((s) => !/[\\/:]/.test(s)),
      })
      .array(),
    instruments: z
      .strictObject({
        id,
        name: z.string(),
        color,
        backend: enums(['default', 'web', 'fluid', 'midi']),
        soundfontId: id.optional(),
        bank: int.min(0).max(16383),
        program: byte,
        isDrum: z.boolean(),
        midiOut: z
          .strictObject({ portName: z.string(), channel: int.min(0).max(15) })
          .optional(),
        volume: unit,
        pan: num.min(-1).max(1),
        reverb: unit,
        chorus: unit,
        transpose: int,
      })
      .array(),
    tracks: trackSchema.array(),
    sources: z
      .strictObject({
        id,
        file: path,
        kind: enums(['mscz', 'mid', 'musicxml']),
        lastSync: z.string().optional(),
        error: z.string().optional(),
      })
      .array(),
    registers: z
      .strictObject({
        name: z.string(),
        mode: enums(['toggle', 'exclusive']),
        group: z.string().optional(),
      })
      .array()
      .length(8),
    base: setupSchema,
    scenes: sceneSchema.array(),
    cues: z
      .strictObject({
        id,
        tick,
        name: z.string(),
        trigger: enums(['auto', 'armed', 'wait']),
        control: z.string().optional(),
        at: timing.optional(),
        actions: actionSchema.array(),
      })
      .array(),
    clips: clipSchema.array(),
    mappings: z.record(id, mappingSchema),
    script: z.string(),
    loop: z
      .strictObject({ enabled: z.boolean(), startTick: tick, endTick: tick })
      .refine((v) => v.endTick > v.startTick, {
        path: ['endTick'],
        message: 'Must be after startTick',
      }),
    follow: z.strictObject({
      mode: enums(['written', 'waitNotes', 'tempoTrack']),
      strictness: enums(['any', 'all']),
      chordWindowMs: tick,
      earlyMs: tick,
      range: z.tuple([num.positive(), num.positive()]),
      smoothing: unit,
      phaseGain: tick,
    }),
    metronome: z.strictObject({
      audible: z.boolean(),
      visualScreen: z.boolean(),
      visualPads: z.boolean(),
      countInBars: int.nonnegative(),
      toCue: z.boolean(),
    }),
    view: z.strictObject({
      lanes: enums(['staff', 'roll', 'per-track']),
      follow: enums(['page', 'center']),
      staffScale: num.positive(),
      staffTheme: enums(['dark', 'paper']),
      pxPerQuarter: num.positive(),
      laneZoom: num.positive(),
    }),
  })
  .superRefine((p, ctx) => {
    const anchors = p.beatAnchors
      .map((anchor, index) => ({ ...anchor, index }))
      .sort((a, b) => a.tick - b.tick)
    for (let i = 1; i < anchors.length; i++)
      if (
        anchors[i].tick <= anchors[i - 1].tick ||
        anchors[i].sec <= anchors[i - 1].sec
      )
        ctx.addIssue({
          code: 'custom',
          path: ['beatAnchors', anchors[i].index, 'sec'],
          message: 'Beat anchors must advance in ticks and audio seconds',
        })
    for (const kind of [
      'tracks',
      'sources',
      'soundfonts',
      'instruments',
      'scenes',
      'cues',
      'clips',
    ] as const) {
      const seen = new Set<string>()
      p[kind].forEach((item, i) => {
        if (seen.has(item.id))
          ctx.addIssue({
            code: 'custom',
            path: [kind, i, 'id'],
            message: 'Duplicate id',
          })
        seen.add(item.id)
      })
    }
  }) satisfies z.ZodType<Project>
const controlSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  kind: enums(['pad', 'button', 'knob', 'fader', 'encoder']),
  msg: z
    .strictObject({
      type: enums(['note', 'cc']),
      channel: int.min(0).max(15).nullable(),
      number: byte,
    })
    .optional(),
  mode: enums(['momentary', 'absolute', 'relative64']),
  ledId: byte.optional(),
  ui: z.strictObject({
    group: z.string(),
    row: int.nonnegative(),
    col: int.nonnegative(),
  }),
})
export const deviceProfileSchema = z.strictObject({
  id,
  name: z.string(),
  ports: z
    .strictObject({
      role: enums(['main', 'aux']),
      match: z.string().array(),
      dir: enums(['in', 'out', 'both']),
    })
    .array(),
  controls: controlSchema.array(),
  feedback: z.literal('arturia-mk3').optional(),
})
export const settingsSchema = z.strictObject({
  chaseCuesOnSeek: z.boolean().default(true),
  audio: z.strictObject({
    defaultSynth: enums(['web', 'fluid']),
    bufferSize: z.union([
      z.literal(0),
      z.literal(128),
      z.literal(256),
      z.literal(512),
      z.literal(1024),
    ]),
    sampleRate: z.union([z.literal(44100), z.literal(48000)]),
    limiter: z.boolean(),
    mainDeviceId: z.string(),
    cue: z.strictObject({
      mode: enums(['off', 'channels34', 'device']),
      deviceId: z.string(),
    }),
    compensationMs: z.strictObject({ web: num, fluid: num, midi: num }),
    inputLatencyMs: tick,
  }),
  fluid: z.strictObject({
    path: z.string(),
    driver: z.string(),
    periodSize: int.positive(),
    periods: int.positive(),
    gain: tick,
    extraArgs: z.string().array(),
  }),
  musescorePath: z.string(),
  soundfontDirs: z.string().array(),
  devices: z.strictObject({
    userProfiles: deviceProfileSchema.array(),
    assignments: record(z.string()),
    arturiaForceProgram: z.boolean(),
  }),
  trustedScripts: z.string().array(),
  recent: z.string().array(),
}) satisfies z.ZodType<Settings>
