import { effectDefaults, effectParameters, effectTypes } from './effects'
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
const beatChase = enums(['off', 'top', 'bottom', 'all', 'bankB', 'bankBPhrase'])
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
    type: z.literal('orchestra'),
    cmd: enums(['select', 'next', 'prev']),
    orchestraId: id.optional(),
    trackId: id.optional(),
  }),
  z.strictObject({
    type: z.literal('transport'),
    cmd: enums([
      'toggle',
      'play',
      'pause',
      'stop',
      'record',
      'recordMode',
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
    trackId: id.optional(),
    instrumentId: id.optional(),
    key: keySchema,
    velocity: z.union([enums(['control', 'speed']), byte]),
    gateMs: int.positive().optional(),
  }).refine(a => Number(!!a.trackId) + Number(!!a.instrumentId) === 1, {message:'Choose a track or instrument', path:['trackId']}),
  z.strictObject({
    type: z.literal('param'),
    target: enums([
      'rate',
      'masterVolume',
      'orchestra.volume', 'orchestra.reverb', 'orchestra.chorus', 'orchestra.brightness',
      'tempo', 'member.gain',
      'section.gain',
      'effect.param',
      'track.volume',
      'track.pan',
      'instrument.pluginParam',
      'instrument.cc',
      'instrument.volume',
      'instrument.reverb',
      'instrument.chorus',
      'audio.semitones',
      'audio.filterFreq',
    ]),
    id: z.string().regex(/^(?:(?:instrument|orchestra):)?[a-z0-9]+(?:-[a-z0-9]+)*$|^section:[a-z0-9]+(?:-[a-z0-9]+)*:[0-9]+$/).optional(),
    cc: byte.optional(),
    effectId: id.optional(),
    param: z.string().min(1).optional(),
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
    type: z.literal('pdf'),
    cmd: enums(['next', 'prev', 'scroll', 'toggleTheme']),
    documentId: id.optional(),
    amount: num.optional(),
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
      'insertBar',
      'deleteBar',
      'appendBar',
    ]),
  }),
  z.strictObject({ type: z.literal('script'), fn: z.string().min(1) }),
])
export const bindingSchema = z.strictObject({
  every: int.positive().optional(),
  direction: enums(['any', 'up', 'down']).optional(),
  control: z.string().min(1),
  edge: enums(['press', 'release', 'change']),
  when: conditionSchema.optional(),
  at: timing.optional(),
  action: actionSchema,
})
export const zoneSchema = z
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
  z.strictObject({ ...trackBase, kind: z.literal('pdf'), documentId: id }),
  z.strictObject({
    ...trackBase,
    kind: z.literal('midi'),
    orchestraId: id.optional(),
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
        orphaned: z.boolean().optional(),
      })
      .optional(),
    view: enums(['staff', 'roll']),
    clef: enums(['auto', 'treble', 'bass']),
    staff: z
      .strictObject({
        mode: enums(['single', 'grand']),
        split: z
          .union([z.literal('auto'), z.number().int().min(0).max(127)])
          .default('auto'),
        voices: z.union([z.literal(1), z.literal(2)]).default(2),
        pedal: z.boolean().default(true),
      })
      .optional(),
    quantGrid: num.positive(),
    armed: z.boolean(),
    leads: z.boolean(),
  }),
  z.strictObject({
    ...trackBase,
    kind: z.literal('audio'),
    display: enums(['wave', 'spectrum', 'both']).default('wave'),
    spectrum: z
      .strictObject({
        floorDb: num.min(-90).max(-1),
        gain: num.min(-48).max(48),
        palette: enums(['magma', 'gray']),
        pitchAligned: z.boolean(),
        overlayTrackId: id.optional(),
      })
      .default({
        floorDb: -90,
        gain: 0,
        palette: 'magma',
        pitchAligned: false,
      }),
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
const pluginRef = z.strictObject({
  format: enums(['lv2','clap','vst3','ladspa']),
  uri: z.string().min(1),
  name: z.string().min(1),
  parameters: z.strictObject({index:int.nonnegative(),name:z.string(),input:z.boolean(),min:num,max:num,initial:num}).array().optional(),
  hasSidechain: z.boolean().optional(),
  stateFile: path.refine(file => file.startsWith('plugins/')).optional(),
})
const effectChain = z.strictObject({
  id,
  type: z.enum([...effectTypes,'plugin']),
  plugin: pluginRef.optional(),
  sidechain: z.strictObject({trackId:id}).optional(),
  enabled: z.boolean().default(true),
  params: record(num).default({}),
  trigger: z.strictObject({ trackId: id }).optional(),
  preset: z.string().optional(),
}).superRefine((effect, ctx) => {
  if (effect.type === 'plugin') {
    if (!effect.plugin) ctx.addIssue({code:'custom',path:['plugin'],message:'Choose a plugin for this effect'})
    if (Object.keys(effect.params).some(key => !/^(0|[1-9][0-9]*)$/.test(key)))
      ctx.addIssue({code:'custom',path:['params'],message:'Expected plugin parameter indices'})
    return
  }
  for (const [name, value] of Object.entries(effect.params)) {
    const spec = effectParameters[effect.type][name]
    if (!Object.hasOwn(effectParameters[effect.type], name) || value < spec.min || value > spec.max)
      ctx.addIssue({ code: 'custom', path: ['params', name], message: 'Unknown or out-of-range effect parameter' })
  }
}).transform(effect => ({ ...effect, params: { ...effectDefaults(effect.type), ...effect.params } }))
  .array().refine(chain => new Set(chain.map(effect => effect.id)).size === chain.length, 'Duplicate effect ID').optional()

export const projectSchema = z
  .strictObject({
    record: z
      .strictObject({
        mode: enums(['overdub', 'replace']),
        preRollBars: int.min(0).max(4),
      })
      .default({ mode: 'overdub', preRollBars: 0 }),
    documents: z.strictObject({
      id,
      name: z.string(),
      file: path.refine(file => /^scores\/pdf\/.+\.pdf$/i.test(file)),
      theme: enums(['night','light']).default('night'),
      zoom: z.union([z.literal('fit'), num.positive()]).default('fit'),
      cols: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
      scroll: num.nonnegative().default(0),
      follow: z.boolean().optional(),
      markers: z.strictObject({bar:int.positive(), page:int.positive(), y:unit}).array().optional(),
    }).array().optional(),
    masterEffects: effectChain,
    orchestras: z
      .array(
        z.strictObject({
          id,
          name: z.string().min(1),
          color,
          effects: effectChain,
          fx: z.strictObject({volume:unit.optional(), reverb:unit.optional(), chorus:unit.optional(), brightness:unit.optional()}).optional(),
          maxLayers: int.min(0).max(8),
          outOfRange: enums(['silent', 'nearest']),
          sections: z.array(
            z.strictObject({
              name: z.string(),
              register: int.min(0).max(7).nullable(),
              startOn: z.boolean(),
              gain: unit.optional(),
              effects: effectChain,
              members: z.array(
                z
                  .strictObject({
                    instrumentId: id,
                    lo: keySchema,
                    hi: keySchema,
                    comfortLo: keySchema,
                    comfortHi: keySchema,
                    enabled: z.boolean(),
                    octave: int.min(-10).max(10),
                    balance: enums(['volume', 'velocity', 'both']).optional(),
                    gain: num.min(0).max(2),
                  })
                  .refine(
                    (m) =>
                      m.lo <= m.comfortLo &&
                      m.comfortLo <= m.comfortHi &&
                      m.comfortHi <= m.hi,
                  ),
              ),
            }),
          ),
        }),
      )
      .default([]),
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
        effects: effectChain,
        backend: enums(['default', 'web', 'fluid', 'midi', 'plugin']),
        pluginParams: z.record(z.string().regex(/^(?:0|[1-9][0-9]*)$/), num).optional(),
        initCc: z.record(z.string().regex(/^(?:0|[1-9][0-9]?|1[01][0-9]|12[0-7])$/), byte).optional(),
        plugin: pluginRef.optional(),
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
      }).refine(i => i.backend !== 'plugin' || !!i.plugin, {path:['plugin'],message:'Choose a plugin instrument'})
      .array(),
    tracks: trackSchema.array(),
    sources: z
      .strictObject({
        id,
        file: path,
        kind: enums(['mscz', 'mid', 'musicxml']),
        durationTicks: tick.optional(),
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
      pdf: z.strictObject({
        placement: enums(['lane','right']).default('lane'),
        width: num.min(360).max(1200).default(640),
        activeId: id.optional(),
        sheetOnly: z.boolean().default(false),
      }).optional(),
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
      'documents',
      'sources',
      'soundfonts',
      'instruments',
      'scenes',
      'cues',
      'clips',
    ] as const) {
      const seen = new Set<string>()
      p[kind]?.forEach((item, i) => {
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
const controlMessageSchema = z.strictObject({
  type: enums(['note', 'cc']),
  channel: int.min(0).max(15).nullable(),
  number: byte,
})
const controlSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  kind: enums(['pad', 'button', 'knob', 'fader', 'encoder']),
  msg: controlMessageSchema.optional(),
  aliases: controlMessageSchema.array().optional(),
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
  tutorials: z.strictObject({
    progress: record(z.number().int().nonnegative()),
    done: z.array(z.string()),
    offered: z.boolean(),
  }).optional(),
  tempoMode: enums(['scale', 'rewrite', 'section']).default('scale'),
  locale: z.string().default('en'),
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
  carlaPath: z.string().optional(),
  effectPresets: z.strictObject({ name: z.string().min(1), type: z.enum(effectTypes), params: record(num) }).array().optional(),
  soundfontFavourites: z.string().array().default([]),
  soundfontCopyIntoProject: z.boolean().default(false),
  soundfontDirsConfigured: z.boolean().optional(),
  soundfontDirs: z.string().array(),
  devices: z.strictObject({
    userProfiles: deviceProfileSchema.array(),
    assignments: record(z.string()),
    arturiaForceProgram: z.boolean(),
  }),
  trustedScripts: z.string().array(),
  recent: z.string().array(),
}) satisfies z.ZodType<Settings>
