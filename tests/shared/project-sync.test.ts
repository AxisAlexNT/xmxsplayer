import { expect, it } from 'vitest'
import { Bus } from '../../src/shared/bus'
import { applyMetadata, syncProject } from '../../src/shared/project-sync'
import { newProject } from '../../src/shared/defaults'
import type { MidiTrack, Project } from '../../src/shared/model'
it('sends note arrays only when changed and re-feeds everything after reconnect', async () => {
  const p = newProject()
  const track: MidiTrack = { id: 'lead', name: 'Lead', kind: 'midi', color: '#4cc2ff', mode: 'live', solo: false, volume: 1, pan: 0, height: 196, notes: [[0,480,60,100]], events: [], view: 'staff', clef: 'treble', quantGrid: 120, armed: false, leads: false }
  p.tracks.push(track)
  const { port1, port2 } = new MessageChannel()
  const ui = new Bus(port1, 'cmd'); const engine = new Bus(port2, 'evt')
  let received: Project | undefined
  let noteMessages = 0
  engine.on('project:meta', meta => { received = applyMetadata(meta, received) })
  engine.on('track:notes', ({ notes }) => { noteMessages++; (received!.tracks[0] as MidiTrack).notes = notes })
  engine.on('ping', () => engine.send('ready', undefined))
  async function flush() { const done = new Promise<void>(resolve => { const off = ui.on('ready', () => { off(); resolve() }) }); ui.send('ping', undefined); await done }
  try {
    syncProject(ui, p); await flush()
    expect(noteMessages).toBe(1); expect((received!.tracks[0] as MidiTrack).notes).toEqual(track.notes)
    const next = { ...p, name: 'Renamed' }
    syncProject(ui, next, p); await flush()
    expect(noteMessages).toBe(1); expect((received!.tracks[0] as MidiTrack).notes).toEqual(track.notes)
    received = undefined
    syncProject(ui, next, next, true); await flush()
    expect(noteMessages).toBe(2); expect(received!.name).toBe('Renamed')
  } finally { ui.close(); engine.close() }
})
