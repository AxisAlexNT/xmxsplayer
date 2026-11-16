import { expect, it } from 'vitest'
import {
  controlMessages,
  sameControlMessage,
} from '../../src/shared/control-messages'
import { deviceProfileSchema } from '../../src/shared/schema'
import { builtinProfiles } from '../../src/engine/midi/profile'

it('finds Learn conflicts against aliases, respecting channel boundaries', () => {
  const base = { type: 'note' as const, channel: 9, number: 40 }
  const aliases = controlMessages({
    ...builtinProfiles[0].controls[0],
    msg: base,
    aliases: [{ ...base, channel: 10 }],
  })
  expect(
    aliases.some((a) => sameControlMessage(a, { ...base, channel: 10 })),
  ).toBe(true)
  expect(
    aliases.some((a) => sameControlMessage(a, { ...base, channel: 2 })),
  ).toBe(false)
  expect(sameControlMessage(base, { ...base, channel: null })).toBe(true)
  expect(sameControlMessage(base, { ...base, type: 'cc' })).toBe(false)
})
it('rejects invalid alias channels and round-trips captured profile addresses', () => {
  const profile = builtinProfiles[0]
  expect(
    deviceProfileSchema.parse(JSON.parse(JSON.stringify(profile))),
  ).toEqual(profile)
  expect(
    deviceProfileSchema.safeParse({
      ...profile,
      controls: [
        {
          ...profile.controls[0],
          aliases: [{ type: 'note', number: 40, channel: 16 }],
        },
      ],
    }).success,
  ).toBe(false)
})
