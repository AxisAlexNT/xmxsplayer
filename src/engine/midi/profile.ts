import type { ControlDef, DeviceProfile, Settings } from '../../shared/model'
import { deviceProfileSchema } from '../../shared/schema'
import arturia from '../../../resources/devices/arturia-keylab-essential-mk3.json'
import axiom from '../../../resources/devices/m-audio-axiom-61-mk2.json'
import generic from '../../../resources/devices/generic.json'
import type { MidiMessage } from './midi-io'

export const builtinProfiles: DeviceProfile[] = [arturia, axiom, generic].map(
  (value) => deviceProfileSchema.parse(value),
)
export interface ControlEvent {
  deviceId: string
  controlId: string
  value: number
  pressed: boolean
  edge: 'press' | 'release' | 'change'
  delta?: number
  timestamp: number
}
export type KeyEvent = MidiMessage
export type DecodedEvent =
  { kind: 'key'; message: KeyEvent } | { kind: 'control'; event: ControlEvent }

export function matchesPort(name: string, pattern: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`, 'i').test(name)
}
export function profilesFor(settings: Settings['devices']): DeviceProfile[] {
  const profiles = new Map(builtinProfiles.map((p) => [p.id, p]))
  for (const p of settings.userProfiles) profiles.set(p.id, p)
  return [...profiles.values()].sort(
    (a, b) => Number(a.id === 'generic') - Number(b.id === 'generic'),
  )
}
export function portRole(
  profile: DeviceProfile,
  name: string,
  dir: 'in' | 'out',
): 'main' | 'aux' | undefined {
  // A specific auxiliary match always wins over a main wildcard.
  const ports = profile.ports.filter((p) => p.dir === 'both' || p.dir === dir)
  return (['aux', 'main'] as const).find((role) =>
    ports.some(
      (p) =>
        p.role === role &&
        p.match.some((pattern) => matchesPort(name, pattern)),
    ),
  )
}
export function profileForPort(
  name: string,
  dir: 'in' | 'out',
  settings: Settings['devices'],
): DeviceProfile | undefined {
  const profiles = profilesFor(settings)
  if (/MCU|HUI/i.test(name)) return undefined
  if (
    profiles.some((p) => p.id !== 'generic' && portRole(p, name, dir) === 'aux')
  )
    return undefined
  const assigned = settings.assignments[name]
  if (assigned) return profiles.find((p) => p.id === assigned)
  return profiles.find((p) => portRole(p, name, dir) === 'main')
}

export class ProfileDecoder {
  private pressed = new Map<string, boolean>()
  private owners = new Map<string, ControlDef>()
  private positions = new Map<string, number>()
  private keyOwners = new Set<string>()
  constructor(readonly deviceId: string) {}
  decode(profile: DeviceProfile, message: MidiMessage): DecodedEvent | null {
    const type = message.type === 'poly' ? 'note' : message.type,
      number =
        message.type === 'note' || message.type === 'poly'
          ? message.key
          : message.type === 'cc'
            ? message.cc
            : -1,
      address = `${type}:${message.channel}:${number}`,
      release =
        (message.type === 'note' && !message.on) ||
        (message.type === 'cc' && message.value === 0),
      control =
        (release || message.type === 'poly'
          ? this.owners.get(address)
          : undefined) ??
        profile.controls.find(
          (c) =>
            c.msg?.type === type &&
            c.msg.number === number &&
            (c.msg.channel === null || c.msg.channel === message.channel),
        )
    if (
      message.type === 'note' &&
      !message.on &&
      this.keyOwners.delete(address)
    )
      return { kind: 'key', message }
    if (control) {
      const raw =
        message.type === 'note'
          ? message.velocity
          : 'value' in message
            ? message.value
            : 0
      let value = raw / 127,
        delta: number | undefined,
        pressed = this.pressed.get(control.id) ?? false,
        edge: ControlEvent['edge'] = 'change'
      if (message.type === 'poly') {
        // Pressure changes intensity, never the physical press/release state.
        if (!pressed) return null
      } else if (control.mode === 'relative64') {
        delta = raw - 64
        if (!delta) return null
        value = Math.max(
          0,
          Math.min(1, (this.positions.get(control.id) ?? 0.5) + delta / 127),
        )
        this.positions.set(control.id, value)
      } else if (control.mode === 'momentary') {
        const next = message.type === 'note' ? message.on : raw > 0
        if (next === pressed) return null
        pressed = next
        edge = pressed ? 'press' : 'release'
        this.pressed.set(control.id, pressed)
        if (pressed) this.owners.set(address, control)
        else this.owners.delete(address)
        if (!pressed) value = 0
      }
      return {
        kind: 'control',
        event: {
          deviceId: this.deviceId,
          controlId: control.id,
          value,
          pressed,
          edge,
          ...(delta === undefined ? {} : { delta }),
          timestamp: message.timestamp,
        },
      }
    }
    // Unlearned KeyLab pads share channel 10; they must not become keyboard notes.
    if (
      profile.feedback === 'arturia-mk3' &&
      profile.controls.some((c) => c.kind === 'pad' && !c.msg) &&
      message.channel === 9 &&
      (message.type === 'note' || message.type === 'poly')
    )
      return null
    if (
      profile.id !== 'generic' &&
      message.type === 'cc' &&
      ![1, 2, 4, 11, 64, 66, 67, 69, 120, 121, 123].includes(message.cc)
    )
      return null
    if (message.type === 'note' && message.on) this.keyOwners.add(address)
    return { kind: 'key', message }
  }
}
