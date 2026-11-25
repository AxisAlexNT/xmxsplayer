import type { MidiTrack, Note, Project } from '../../shared/model'

export function staffSettings(
  track: MidiTrack,
  project: Project,
): NonNullable<MidiTrack['staff']> {
  const patch = project.base.patch.find((p) => p.trackId === track.id)
  const instrument = project.instruments.find(
    (i) => i.id === patch?.instrumentId,
  )
  const piano =
    /piano/i.test(track.name) ||
    (instrument && !instrument.isDrum && instrument.program < 8)
  const settings =
    track.staff ??
    ({
      mode: piano ? 'grand' : 'single',
      split: 'auto',
      voices: 2,
      pedal: true,
    } as const)
  return track.link ? { ...settings, mode: 'single' } : settings
}

export interface VoiceGroup {
  tick: number
  end: number
  notes: Note[]
}

export function voiceNotes(
  track: MidiTrack,
  settings: NonNullable<MidiTrack['staff']>,
) {
  const staves: VoiceGroup[][][] = Array.from(
    { length: settings.mode === 'grand' ? 2 : 1 },
    () => Array.from({ length: settings.voices }, () => []),
  )
  const grid = Math.max(1, track.quantGrid)
  const sorted = [...track.notes].sort((a, b) => a[0] - b[0])
  const onsets = new Map<number, Note[]>()
  let anchor = -Infinity
  for (const note of sorted) {
    if (note[0] - anchor > 30) anchor = note[0]
    const tick = Math.max(0, Math.round(anchor / grid) * grid)
    const end = Math.max(
      tick + grid,
      Math.round((note[0] + note[1]) / grid) * grid,
    )
    const cluster = onsets.get(tick) ?? []
    cluster.push([tick, end - tick, note[2], note[3]])
    onsets.set(tick, cluster)
  }
  let split = 60
  let truncated = false
  for (const [tick, cluster] of onsets) {
    cluster.sort((a, b) => a[2] - b[2])
    let threshold = settings.split === 'auto' ? split : settings.split
    if (staves.length === 2 && settings.split === 'auto') {
      const sounding = staves.flatMap((voices) =>
        voices.flatMap((voice) => {
          const held = voice.at(-1)
          return held && held.end > tick ? held.notes : []
        }),
      )
      const keys = [...sounding, ...cluster]
        .map((n) => n[2])
        .sort((a, b) => a - b)
      let bestGap = 4
      for (let i = 1; i < keys.length; i++) {
        const low = keys[i - 1],
          high = keys[i],
          gap = high - low
        const mid = (low + high) / 2
        if (
          gap < 5 ||
          Math.abs(mid - split) > 12 ||
          low - keys[0] > 14 ||
          keys[keys.length - 1] - high > 14
        )
          continue
        if (
          gap > bestGap ||
          (gap === bestGap &&
            Math.abs(mid - split) < Math.abs(threshold - split))
        ) {
          threshold = mid
          bestGap = gap
        }
      }
      split = (split + threshold) / 2
    }
    for (const [staff, voices] of staves.entries()) {
      const chords = new Map<number, VoiceGroup>()
      for (const note of cluster) {
        if (staves.length === 2 && (note[2] < threshold ? 1 : 0) !== staff)
          continue
        const end = tick + note[1]
        const chord = chords.get(end) ?? { tick, end, notes: [] }
        chord.notes.push(note)
        chords.set(end, chord)
      }
      const ordered = [...chords.values()].sort(
        (a, b) =>
          b.notes[b.notes.length - 1][2] - a.notes[a.notes.length - 1][2],
      )
      for (const group of ordered) {
        let voice = voices.find((v) => (v.at(-1)?.end ?? 0) <= tick)
        if (!voice) {
          voice = voices[voices.length - 1]
          const previous = voice[voice.length - 1]
          truncated = true
          if (previous.tick === tick) continue
          previous.end = tick
        }
        voice.push(group)
      }
    }
  }
  return { staves, truncated }
}
