import { parseMidi, writeMidi, type MidiEvent } from 'midi-file'
import { TimeMap } from '../../shared/time-map'
import { PPQ, type Project } from '../../shared/model'
import { encodeTrack } from '../../shared/project-files'
export function exportMidi(project: Project, trackId?: string): Uint8Array {
  const tracks = project.tracks.filter(
    (t) =>
      t.kind === 'midi' &&
      (trackId ? t.id === trackId : !t.link || t.link.state === 'ahead'),
  )
  if (!tracks.length) throw Error('No edited or unlinked MIDI tracks to export')
  const maps: { tick: number; event: MidiEvent }[] = [
    ...new TimeMap(project).tempos.map((t) => ({
      tick: t.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'setTempo',
        microsecondsPerBeat: Math.round(60000000 / t.bpm),
      } as MidiEvent,
    })),
    ...project.timeSigs.map((t) => ({
      tick: t.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'timeSignature',
        numerator: t.num,
        denominator: t.den,
        metronome: 24,
        thirtyseconds: 8,
      } as MidiEvent,
    })),
    ...project.keySigs.map((t) => ({
      tick: t.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'keySignature',
        key: t.fifths,
        scale: t.minor ? 1 : 0,
      } as MidiEvent,
    })),
  ].sort((a, b) => a.tick - b.tick)
  let tick = 0
  const conductor = maps.map((entry) => {
    const deltaTime = Math.round(entry.tick) - tick
    tick += deltaTime
    return { ...entry.event, deltaTime }
  })
  conductor.push({ deltaTime: 0, meta: true, type: 'endOfTrack' })
  return new Uint8Array(
    writeMidi({
      header: { format: 1, ticksPerBeat: PPQ, numTracks: tracks.length + 1 },
      tracks: [
        conductor,
        ...tracks.map((track) => {
          if (track.kind !== 'midi') return []
          return [
            {
              deltaTime: 0,
              meta: true,
              type: 'trackName',
              text: track.name,
            } as MidiEvent,
            ...parseMidi(encodeTrack(track)).tracks[0],
          ]
        }),
      ],
    }),
  )
}
