import type { EventMap } from '../../shared/protocol'
export type MidiMessage =
  | {
      type: 'note'
      source: string
      channel: number
      key: number
      velocity: number
      on: boolean
      timestamp: number
    }
  | {
      type: 'cc'
      source: string
      channel: number
      cc: number
      value: number
      timestamp: number
    }
  | {
      type: 'bend' | 'pressure'
      source: string
      channel: number
      value: number
      timestamp: number
    }
  | {
      type: 'poly'
      source: string
      channel: number
      key: number
      value: number
      timestamp: number
    }
export function decodeMidi(
  source: string,
  data: Uint8Array,
  timestamp: number,
): MidiMessage | null {
  const [status, a, b] = data
  if (status === undefined || status < 0x80 || status >= 0xf0) return null
  if ((a !== undefined && a > 127) || (b !== undefined && b > 127)) return null
  const channel = status & 15
  const common = { source, channel, timestamp }
  switch (status & 0xf0) {
    case 0x80:
    case 0x90:
      return a === undefined || b === undefined
        ? null
        : {
            ...common,
            type: 'note',
            key: a,
            velocity: b,
            on: (status & 0xf0) === 0x90 && b > 0,
          }
    case 0xb0:
      return a === undefined || b === undefined
        ? null
        : { ...common, type: 'cc', cc: a, value: b }
    case 0xe0:
      return a === undefined || b === undefined
        ? null
        : { ...common, type: 'bend', value: a | (b << 7) }
    case 0xd0:
      return a === undefined ? null : { ...common, type: 'pressure', value: a }
    case 0xa0:
      return a === undefined || b === undefined
        ? null
        : { ...common, type: 'poly', key: a, value: b }
    default:
      return null
  }
}
export class MidiIO {
  private access?: MIDIAccess
  private inputs = new Map<string, MIDIInput>()
  constructor(
    private receive: (message: MidiMessage) => void,
    private ports: (value: EventMap['midi:ports']) => void,
    private disconnect: (id: string) => void,
    private warn: (message: string) => void,
    private raw?: (
      source: string,
      data: Uint8Array,
      timestamp: number,
    ) => boolean,
  ) {}
  async start(enabled = true): Promise<void> {
    if (!enabled) {
      this.report()
      return
    }
    if (!navigator.requestMIDIAccess) {
      this.warn('Web MIDI is unavailable')
      return
    }
    this.access = await navigator.requestMIDIAccess({ sysex: true })
    this.access.onstatechange = () => this.refresh()
    this.refresh()
  }
  private refresh(): void {
    const connected = [...this.access!.inputs.values()].filter(
      (input) =>
        input.state === 'connected' && !/MCU|HUI/i.test(input.name ?? ''),
    )
    for (const [id, input] of this.inputs)
      if (!connected.some((p) => p.id === id)) {
        input.onmidimessage = null
        void input.close().catch(() => undefined)
        this.inputs.delete(id)
        this.disconnect(id)
      }
    for (const input of connected)
      if (!this.inputs.has(input.id)) {
        this.inputs.set(input.id, input)
        input.onmidimessage = (event) => {
          if (event.data) {
            if (this.raw?.(input.id, event.data, event.timeStamp)) return
            const message = decodeMidi(input.id, event.data, event.timeStamp)
            if (message) this.receive(message)
          }
        }
        void input
          .open()
          .catch((error) => this.warn(`${input.name}: ${String(error)}`))
      }
    this.report()
  }
  output(id: string): MIDIOutput | undefined {
    const output = this.access?.outputs.get(id)
    return output?.state === 'connected' ? output : undefined
  }
  report(): void {
    const inputs = [...this.inputs.values()].map((p) => ({
      id: p.id,
      name: p.name ?? 'MIDI input',
    }))
    this.ports({
      inputs,
      outputs: [...(this.access?.outputs.values() ?? [])]
        .filter(
          (p) => p.state === 'connected' && !/MCU|HUI/i.test(p.name ?? ''),
        )
        .map((p) => ({ id: p.id, name: p.name ?? 'MIDI output' })),
      devices: inputs.map((p) => ({ ...p, profileId: 'generic' })),
    })
  }
  close(): void {
    if (this.access) this.access.onstatechange = null
    for (const input of this.inputs.values()) {
      input.onmidimessage = null
      void input.close().catch(() => undefined)
      this.disconnect(input.id)
    }
    this.inputs.clear()
  }
}
