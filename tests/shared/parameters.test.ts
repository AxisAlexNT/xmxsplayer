import { expect, it } from 'vitest'
import { newProject } from '../../src/shared/defaults'
import { parameterPatch, parameterValue } from '../../src/shared/parameters'
import type { AudioTrack } from '../../src/shared/model'
it('changes only the chosen parameter, clamps legal ranges and retains the latest notes and metadata', () => {
  const p = newProject(),
    t: AudioTrack = {
      id: 'reference',
      name: 'Reference',
      color: '#4cc2ff',
      kind: 'audio',
      mode: 'auto',
      solo: false,
      volume: 0.8,
      pan: 0,
      height: 108,
      file: 'audio/ref.wav',
      offsetSec: 0,
      durationSec: 10,
      semitones: 0,
      cents: 0,
      toCue: false,
      channelMode: 'stereo',
      filter: { enabled: true, type: 'bandpass', freq: 1000, q: 1 },
    }
  p.tracks = [t]
  const action = {
      type: 'param' as const,
      target: 'track.volume' as const,
      id: t.id,
      min: 0,
      max: 2,
    },
    patch = parameterPatch(p, action, 0.75)!
  expect(parameterValue({ ...p, ...patch }, action)).toBe(1)
  expect(t.volume).toBe(0.8)
  expect(patch.tracks?.[0]).toMatchObject({ offsetSec: 0, durationSec: 10 })
  expect(parameterValue(p, { ...action, target: 'audio.filterFreq' })).toBe(
    1000,
  )
  expect(
    parameterPatch(
      p,
      { ...action, target: 'audio.filterFreq', min: 0, max: 40000 },
      1,
    )?.tracks?.[0],
  ).toMatchObject({ filter: { freq: 20000, q: 1 } })
  expect(parameterPatch(p, { ...action, id: 'missing' }, 1)).toBeUndefined()
})
