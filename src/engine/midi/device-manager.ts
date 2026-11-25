import { tutorialController } from '../../shared/tutorial-controller'
import { Learn } from './learn'
import type { ControlDef, DeviceProfile, Settings } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'
import { MidiIO, decodeMidi, type MidiMessage } from './midi-io'
import {
  ProfileDecoder,
  profileForPort,
  profilesFor,
  type ControlEvent,
} from './profile'

export interface ControllerDevice {
  id: string
  name: string
  profile: DeviceProfile
  outputId?: string
}
export class DeviceManager {
  readonly learn: Learn
  private io: MidiIO
  private config: Settings['devices']
  private ports: EventMap['midi:ports'] = {
    inputs: [],
    outputs: [],
    devices: [],
  }
  private decoders = new Map<string, ProfileDecoder>()
  private tutorialEnabled = false
  private connected: ControllerDevice[] = []
  constructor(
    settings: Settings['devices'],
    private key: (event: MidiMessage) => void,
    private control: (event: ControlEvent) => void,
    private reportPorts: (ports: EventMap['midi:ports']) => void,
    private disconnect: (id: string) => void,
    warn: (message: string) => void,
    captured: (deviceId: string, control: ControlDef) => void = () => undefined,
    private raw?: (
      deviceId: string,
      data: Uint8Array,
      timestamp: number,
    ) => void,
  ) {
    this.learn = new Learn(captured)
    this.config = settings
    this.io = new MidiIO(
      () => undefined,
      (ports) => {
        this.ports = ports
        this.report()
      },
      (id) => {
        if (this.learn.active(id)) this.learn.stop()
        this.decoders.delete(id)
        this.connected = this.connected.filter((device) => device.id !== id)
        this.disconnect(id)
      },
      warn,
      (source, data, timestamp) => {
        this.receive(source, data, timestamp)
        return true
      },
    )
  }
  start(enabled = true): Promise<void> {
    return this.io.start(enabled)
  }
  configure(settings: Settings['devices']): void {
    this.config = settings
    this.report()
  }
  profiles(): DeviceProfile[] {
    const profiles = profilesFor(this.config)
    return this.tutorialEnabled ? [...profiles, tutorialController] : profiles
  }
  setTutorialEnabled(enabled: boolean): void {
    if (this.tutorialEnabled === enabled) return
    this.tutorialEnabled = enabled
    this.report()
  }
  tutorialGesture(kind: 'pad' | 'knob' | 'fader', value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1 ||
        !this.connected.some(device => device.profile === tutorialController)) return
    const def = tutorialController.controls.find(control => control.kind === kind)
    if (!def) return
    const event: ControlEvent = { deviceId: tutorialController.id, controlId: def.id, controlKind: kind,
      edge: kind === 'pad' ? 'press' : 'change', value, pressed: kind === 'pad', timestamp: performance.now() }
    this.control(event)
    if (kind === 'pad') this.control({...event, edge:'release', value:0, pressed:false})
  }
  devices(): readonly ControllerDevice[] {
    return this.connected
  }
  output(id: string): MIDIOutput | undefined {
    return this.io.output(id)
  }
  outputs(): MIDIOutput[] {
    return this.ports.outputs.flatMap((port) => {
      const output = this.io.output(port.id)
      return output ? [output] : []
    })
  }
  receive(source: string, data: Uint8Array, timestamp: number): void {
    const device = this.connected.find((d) => d.id === source)
    if (!device) return
    this.raw?.(source, data, timestamp)
    const message = decodeMidi(source, data, timestamp)
    if (!message) return
    let decoder = this.decoders.get(source)
    if (!decoder) {
      decoder = new ProfileDecoder(source)
      this.decoders.set(source, decoder)
    }
    const decoded = decoder.decode(device.profile, message)
    if (this.learn.receive(message)) {
      if (
        decoded?.kind === 'key' &&
        ((message.type === 'note' && !message.on) ||
          (message.type === 'cc' && message.cc === 64 && message.value === 0))
      )
        this.key(message)
      return
    }
    if (decoded?.kind === 'key') this.key(decoded.message)
    else if (decoded?.kind === 'control') this.control(decoded.event)
  }
  report(): void {
    const outputs = this.ports.outputs.filter((p) =>
      profileForPort(p.name, 'out', this.config),
    )
    const devices = this.ports.inputs.flatMap((input) => {
      const profile = profileForPort(input.name, 'in', this.config)
      if (!profile) return []
      const candidates = outputs.filter(
          (p) => profileForPort(p.name, 'out', this.config)?.id === profile.id,
        ),
        exact = candidates.filter((p) => p.name === input.name),
        peers = this.ports.inputs.filter(
          (p) => profileForPort(p.name, 'in', this.config)?.id === profile.id,
        ),
        matches =
          exact.length === 1 &&
          peers.filter((p) => p.name === input.name).length === 1
            ? exact
            : candidates.length === 1 && peers.length === 1
              ? candidates
              : []
      return [
        {
          ...input,
          profile,
          ...(matches[0] ? { outputId: matches[0].id } : {}),
        },
      ]
    })
    const inputs = devices.map(({ id, name }) => ({ id, name }))
    if (this.tutorialEnabled && !devices.some(d => d.profile.controls.length)) {
      devices.unshift({ id: tutorialController.id, name: tutorialController.name, profile: tutorialController })
    }
    for (const previous of this.connected)
      if (
        !devices.some(
          (d) => d.id === previous.id && d.profile.id === previous.profile.id,
        )
      ) {
        this.decoders.delete(previous.id)
        this.disconnect(previous.id)
      }
    this.connected = devices
    this.reportPorts({
      inputs,
      outputs: this.ports.outputs,
      devices: devices.map(({ id, name, profile }) => ({
        id,
        name,
        profileId: profile.id,
      })),
    })
  }
  close(): void {
    this.learn.stop()
    this.io.close()
    this.connected = []
    this.decoders.clear()
  }
}
