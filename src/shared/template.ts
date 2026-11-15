import { newProject } from './defaults'
import type { Project } from './model'
export function liveProject(name: string, soundfontFile = 'FluidR3_GM.sf2'): Project {
  const project = newProject(name)
  project.soundfonts = [{ id: 'gm', file: soundfontFile }]
  project.instruments = [{ id: 'piano', name: 'Piano', color: '#4cc2ff', backend: 'default', soundfontId: 'gm', bank: 0, program: 0, isDrum: false, volume: 0.8, pan: 0, reverb: 0.2, chorus: 0, transpose: 0 }]
  project.tracks = [{ id: 'piano', name: 'Piano', color: '#4cc2ff', kind: 'midi', mode: 'live', solo: false, volume: 1, pan: 0, height: 196, notes: [], events: [], view: 'staff', clef: 'auto', quantGrid: 120, armed: false, leads: false }]
  project.base.zones = [{ id: 'keyboard', lo: 0, hi: 127, trackIds: ['piano'], transpose: 0, velocity: 'linear', color: '#4cc2ff' }]
  project.base.patch = [{ id: 'piano', trackId: 'piano', instrumentId: 'piano' }]
  return project
}
