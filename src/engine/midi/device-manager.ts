import type { DeviceProfile, Settings } from '../../shared/model'
import type { EventMap } from '../../shared/protocol'
import { MidiIO, decodeMidi, type MidiMessage } from './midi-io'
import { ProfileDecoder, profileForPort, type ControlEvent } from './profile'

export interface ControllerDevice {
  id: string
  name: string
  profile: DeviceProfile
  outputId?: string
}
export class DeviceManager {
  private io: MidiIO
  private config: Settings['devices']
  private ports: EventMap['midi:ports'] = {
    inputs: [],
    outputs: [],
    devices: [],
  }
  private decoders = new Map<string, ProfileDecoder>()
  private connected: ControllerDevice[] = []
  constructor(
    settings: Settings['devices'],
    private key: (event: MidiMessage) => void,
    private control: (event: ControlEvent) => void,
    private reportPorts: (ports: EventMap['midi:ports']) => void,
    private disconnect: (id: string) => void,
    warn: (message: string) => void,
  ) {
    this.config = settings
    this.io = new MidiIO(
      () => undefined,
      (ports) => {
        this.ports = ports
        this.report()
      },
      (id) => {
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
  start(): Promise<void> {
    return this.io.start()
  }
  configure(settings: Settings['devices']): void {
    this.config = settings
    this.report()
  }
  devices(): readonly ControllerDevice[] {
    return this.connected
  }
  output(id: string): MIDIOutput | undefined {
    return this.io.output(id)
  }
  receive(source: string, data: Uint8Array, timestamp: number): void {
    const device = this.connected.find((d) => d.id === source)
    if (!device) return
    const message = decodeMidi(source, data, timestamp)
    if (!message) return
    let decoder = this.decoders.get(source)
    if (!decoder) {
      decoder = new ProfileDecoder(source)
      this.decoders.set(source, decoder)
    }
    const decoded = decoder.decode(device.profile, message)
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
      inputs: devices.map(({ id, name }) => ({ id, name })),
      outputs,
      devices: devices.map(({ id, name, profile }) => ({
        id,
        name,
        profileId: profile.id,
      })),
    })
  }
  close(): void {
    this.io.close()
    this.connected = []
    this.decoders.clear()
  }
}
