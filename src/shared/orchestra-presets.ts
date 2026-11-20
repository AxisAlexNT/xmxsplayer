import { liveProject } from './template'
import type { Project, Orchestra } from './model'
import { uniqueId, slugify } from './ids'

type Voice = [name: string, program: number, lo: number, hi: number]
interface Preset {
  name: string
  color: string
  maxLayers: number
  sections: [string, Voice[]][]
}
export const presets: Record<string, Preset> = {
  symphonic: {
    name: 'Symphonic',
    color: '#70b4e8',
    maxLayers: 3,
    sections: [
      [
        'Strings',
        [
          ['Violin', 40, 55, 100],
          ['Viola', 41, 48, 88],
          ['Cello', 42, 36, 76],
          ['Contrabass', 43, 28, 60],
        ],
      ],
      [
        'Woodwinds',
        [
          ['Piccolo', 72, 74, 108],
          ['Flute', 73, 60, 96],
          ['Oboe', 68, 58, 91],
          ['Clarinet', 71, 50, 94],
          ['Bassoon', 70, 34, 75],
        ],
      ],
      [
        'Brass',
        [
          ['Trumpet', 56, 55, 82],
          ['Horn', 60, 34, 77],
          ['Trombone', 57, 40, 72],
          ['Tuba', 58, 28, 58],
        ],
      ],
      [
        'Timpani + Harp',
        [
          ['Timpani', 47, 40, 57],
          ['Harp', 46, 24, 103],
        ],
      ],
    ],
  },
  'new-age': {
    name: 'New Age',
    color: '#84d5b0',
    maxLayers: 3,
    sections: [
      [
        'Pads',
        [
          ['New Age', 88, 24, 96],
          ['Warm', 89, 24, 96],
        ],
      ],
      [
        'Choir',
        [
          ['Choir Aahs', 52, 45, 81],
          ['Voice Oohs', 53, 45, 81],
        ],
      ],
      [
        'Harp + Piano',
        [
          ['Harp', 46, 24, 103],
          ['Piano', 0, 21, 108],
        ],
      ],
      [
        'Flutes',
        [
          ['Pan Flute', 75, 60, 96],
          ['Shakuhachi', 77, 55, 86],
        ],
      ],
    ],
  },
  'edm-trance': {
    name: 'EDM Trance',
    color: '#e88bca',
    maxLayers: 2,
    sections: [
      ['Lead', [['Saw', 81, 48, 96]]],
      [
        'Pad',
        [
          ['Polysynth', 90, 36, 96],
          ['Sweep', 95, 36, 96],
        ],
      ],
      ['Pluck', [['Pizzicato', 45, 40, 96]]],
      ['Bass', [['Synth Bass 2', 39, 24, 55]]],
    ],
  },
  'tuned-percussion': {
    name: 'Tuned Percussion',
    color: '#e6ad67',
    maxLayers: 2,
    sections: [
      ['Vibraphone', [['Vibraphone', 11, 53, 89]]],
      ['Glockenspiel', [['Glockenspiel', 9, 79, 108]]],
      ['Celesta', [['Celesta', 8, 60, 108]]],
      ['Marimba', [['Marimba', 12, 45, 96]]],
    ],
  },
}

export function addPreset(p: Project, id: string, soundfontId: string) {
  const preset = presets[id]
  if (!preset) throw Error('Unknown orchestra preset')
  const template = liveProject('Orchestra')
  const trackTemplate = template.tracks[0]
  if (trackTemplate.kind !== 'midi') throw Error('Missing MIDI template')
  let track = p.tracks.find((t) => t.kind === 'midi' && t.orchestraId)
  if (!track || track.kind !== 'midi') {
    const trackId = uniqueId(
      'orchestra',
      p.tracks.map((t) => t.id),
    )
    track = {
      ...trackTemplate,
      id: trackId,
      name: 'Orchestra',
      orchestraId: id,
    }
    p.tracks.push(track)
    p.base.zones.push({
      ...template.base.zones[0],
      id: uniqueId(
        'orchestra',
        p.base.zones.map((z) => z.id),
      ),
      trackIds: [trackId],
    })
  }
  track.orchestraId = id
  const orchestra: Orchestra = {
    id,
    name: preset.name,
    color: preset.color,
    maxLayers: preset.maxLayers,
    outOfRange: 'nearest',
    sections: [],
  }
  p.orchestras ??= []
  if (!p.orchestras.some((o) => o.id === id)) {
    orchestra.sections = preset.sections.map(([name, voices], register) => ({
      name,
      register,
      startOn: name !== 'Marimba',
      members: voices.map(([name, program, lo, hi]) => {
        const instrumentId = uniqueId(
          'orc-' + id + '-' + slugify(name),
          p.instruments.map((i) => i.id),
        )
        p.instruments.push({
          ...template.instruments[0],
          id: instrumentId,
          name,
          program,
          color: ['#70b4e8', '#84d5b0', '#e6ad67', '#c49ae5'][register],
          soundfontId,
        })
        const margin = Math.floor((hi - lo) / 5)
        return {
          instrumentId,
          lo,
          hi,
          comfortLo: lo + margin,
          comfortHi: hi - margin,
          enabled: true,
          octave: 0,
          gain: 1,
        }
      }),
    }))
    p.orchestras.push(orchestra)
  }
  for (const section of p.orchestras.find((o) => o.id === id)!.sections)
    if (section.register !== null) {
      const register = p.registers[section.register]
      register.name = section.name
    }
}
