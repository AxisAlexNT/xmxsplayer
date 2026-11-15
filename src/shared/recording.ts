import type { MidiTrack, Note } from './model'
export interface RecordedTrack {
  trackId: string
  notes: Note[]
  events: MidiTrack['events']
}
export interface RecordedTake {
  takeId: string
  scope: string
  tracks: RecordedTrack[]
}
export interface RoutedNote {
  id: string
  source: string
  channel: number
  trackId: string
  key: number
  velocity: number
  on: boolean
  when?: number
}
