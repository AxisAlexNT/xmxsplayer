import { expect, it } from 'vitest'
import {
  builtinProfiles,
  matchesPort,
  portRole,
  profileForPort,
  ProfileDecoder,
} from '../../src/engine/midi/profile'
import { decodeMidi } from '../../src/engine/midi/midi-io'
import { defaultSettings } from '../../src/shared/defaults'
const arturia = builtinProfiles.find((p) => p.feedback === 'arturia-mk3')!
const config = defaultSettings().devices
it('validates bundled profiles and leaves unverified controls without messages', () => {
  expect(arturia.controls.find((c) => c.id === 'pad.1')?.msg).toEqual({
    type: 'note',
    channel: 9,
    number: 40,
  })
  for (const id of [
    'pad.3',
    'pad.7',
    'pad.9',
    'pad.16',
    'transport.rewind',
    'transport.forward',
    'encoder.main',
    'knob.2',
    'fader.8',
  ])
    expect(arturia.controls.find((c) => c.id === id)?.msg).toBeUndefined()
  expect(arturia.controls.find((c) => c.id === 'pad.16')?.ledId).toBe(0x2b)
  expect(
    builtinProfiles
      .find((p) => p.id === 'm-audio-axiom-61-mk2')!
      .controls.every((c) => !c.msg),
  ).toBe(true)
})
it('matches literal port names safely and excludes auxiliary ports', () => {
  expect(matchesPort('Axiom 61 USB', '*Axiom*61*')).toBe(true)
  expect(matchesPort('keyboard [1]', 'keyboard [1]')).toBe(true)
  expect(matchesPort('keyboard 1', 'keyboard [1]')).toBe(false)
  expect(profileForPort('KL Essential 61 mk3 MIDI', 'in', config)?.id).toBe(
    arturia.id,
  )
  for (const suffix of ['DINTHRU', 'ALV', 'MCU/HUI'])
    expect(
      profileForPort('KL Essential 61 mk3 ' + suffix, 'in', config),
    ).toBeUndefined()
  expect(portRole(arturia, 'KL Essential 61 mk3 MIDI', 'out')).toBe('main')
  expect(profileForPort('Other keyboard', 'in', config)?.id).toBe('generic')
  expect(
    profileForPort('Other keyboard', 'in', {
      ...config,
      assignments: { 'Other keyboard': arturia.id },
    })?.id,
  ).toBe(arturia.id)
})
it('decodes pad edges and pressure without leaking pads into keyboard notes', () => {
  const decoder = new ProfileDecoder('keylab'),
    decode = (bytes: number[]) =>
      decoder.decode(arturia, decodeMidi('keylab', new Uint8Array(bytes), 25)!)
  expect(decode([0x99, 40, 100])).toMatchObject({
    kind: 'control',
    event: {
      controlId: 'pad.1',
      edge: 'press',
      pressed: true,
      value: 100 / 127,
    },
  })
  expect(decode([0xa9, 40, 70])).toMatchObject({
    kind: 'control',
    event: { edge: 'change', pressed: true, value: 70 / 127 },
  })
  expect(decode([0x99, 40, 0])).toMatchObject({
    kind: 'control',
    event: { edge: 'release', pressed: false, value: 0 },
  })
  expect(decode([0xa9, 40, 0])).toBeNull()
  expect(decode([0x99, 42, 100])).toBeNull()
  expect(decode([0x96, 40, 100])).toMatchObject({
    kind: 'key',
    message: { key: 40, channel: 6 },
  })
  expect(decode([0xb6, 64, 127])).toMatchObject({
    kind: 'key',
    message: { cc: 64 },
  })
  expect(decode([0xb0, 71, 60])).toBeNull()
})
it('keeps control state per device, captures original release ownership, and decodes relative movement', () => {
  const a = new ProfileDecoder('a'),
    b = new ProfileDecoder('b'),
    message = decodeMidi('a', new Uint8Array([0xb0, 21, 127]), 1)!
  expect(a.decode(arturia, message)).toMatchObject({
    event: { deviceId: 'a', controlId: 'transport.play', edge: 'press' },
  })
  expect(a.decode(arturia, message)).toBeNull()
  expect(b.decode(arturia, message)).toMatchObject({
    event: { deviceId: 'b', edge: 'press' },
  })
  const changed = {
    ...arturia,
    controls: arturia.controls.map((c) =>
      c.id === 'transport.play' ? { ...c, id: 'new-button' } : c,
    ),
  }
  expect(
    a.decode(changed, decodeMidi('a', new Uint8Array([0xb0, 21, 0]), 2)!),
  ).toMatchObject({ event: { controlId: 'transport.play', edge: 'release' } })
  const relative = {
    ...arturia,
    controls: arturia.controls.map((c) =>
      c.id === 'encoder.main'
        ? { ...c, msg: { type: 'cc' as const, channel: null, number: 114 } }
        : c,
    ),
  }
  expect(
    a.decode(relative, decodeMidi('a', new Uint8Array([0xb0, 114, 64]), 3)!),
  ).toBeNull()
  expect(
    a.decode(relative, decodeMidi('a', new Uint8Array([0xb0, 114, 66]), 4)!),
  ).toMatchObject({
    event: { controlId: 'encoder.main', delta: 2, edge: 'change' },
  })
})
it('lets learned controls override layout-only definitions without mutating built-ins', () => {
  const profile = {
    ...arturia,
    controls: arturia.controls.map((c) =>
      c.id === 'pad.9'
        ? { ...c, msg: { type: 'note' as const, channel: 9, number: 44 } }
        : c,
    ),
  }
  expect(
    profileForPort('KL Essential 61 mk3 MIDI', 'in', {
      ...config,
      userProfiles: [profile],
    })?.controls.find((c) => c.id === 'pad.9')?.msg?.number,
  ).toBe(44)
  expect(arturia.controls.find((c) => c.id === 'pad.9')?.msg).toBeUndefined()
})
it('releases a keyboard note on its original path after learning it as a control', () => {
  const decoder = new ProfileDecoder('keyboard'),
    on = decodeMidi('keyboard', new Uint8Array([0x96, 60, 100]), 1)!,
    off = decodeMidi('keyboard', new Uint8Array([0x86, 60, 0]), 2)!
  expect(decoder.decode(arturia, on)?.kind).toBe('key')
  const learned = {
    ...arturia,
    controls: [
      ...arturia.controls,
      {
        ...arturia.controls[0],
        id: 'pad.custom',
        msg: { type: 'note' as const, channel: 6, number: 60 },
      },
    ],
  }
  expect(decoder.decode(learned, off)?.kind).toBe('key')
})
