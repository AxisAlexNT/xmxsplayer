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

it('keeps MIDI CC values independent and maps a plugin control in its native units', async () => {
  const { liveProject } = await import('../../src/shared/template')
  const p = liveProject('Lead')
  const action = { type:'param' as const, target:'instrument.cc' as const, id:'piano', cc:74, min:0, max:127 }
  p.instruments[0].initCc = {71:100}
  Object.assign(p, parameterPatch(p, action, 0.5))
  expect(p.instruments[0].initCc).toEqual({71:100,74:64})
  expect(parameterValue(p, action)).toBe(64)
  p.instruments[0].backend = 'plugin'
  p.instruments[0].plugin = {format:'lv2',uri:'urn:lead',name:'Lead',parameters:[
    {name:'Cutoff',index:9,input:true,initial:800,min:20,max:20000},
  ]}
  const cutoff = {...action, target:'instrument.pluginParam' as const, param:'9', min:20,max:20000}
  expect(parameterValue(p, cutoff)).toBe(800)
  Object.assign(p, parameterPatch(p, cutoff, 0.5))
  expect(parameterValue(p, cutoff)).toBe(10010)
  expect(parameterPatch(p, {...cutoff, param:'999'}, 1)).toBeUndefined()
})
