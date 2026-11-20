import type { MidiTrack, Note } from './model'
export interface RecordedTrack {
  covered?: [number, number][]
  trackId: string
  notes: Note[]
  events: MidiTrack['events']
}
export interface RecordedTake {
  mode?: 'replace' | 'overdub'
  takeId: string
  scope: string
  tracks: RecordedTrack[]
}
export interface RoutedNote {
  live?: boolean
  id: string
  source: string
  channel: number
  trackId: string
  key: number
  velocity: number
  on: boolean
  when?: number
}

export function replaceRange(
  notes: Note[],
  events: MidiTrack['events'],
  covered: [number, number][],
) {
  const ranges = covered.filter(([a, b]) => a < b).sort((a, b) => a[0] - b[0])
  const inside = (tick: number) =>
    ranges.some(([start, end]) => tick >= start && tick < end)
  return {
    notes: notes
      .filter(([tick]) => !inside(tick))
      .map((note): Note => {
        const cut = ranges.find(
          ([start]) => start > note[0] && start < note[0] + note[1],
        )
        return cut ? [note[0], cut[0] - note[0], note[2], note[3]] : note
      }),
    events: events.filter((e) => !inside(e.tick)),
  }
}
