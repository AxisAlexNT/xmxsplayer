import type { ControlDef } from '../../shared/model'
import type { MidiMessage } from './midi-io'

export interface LearnSample {
  value: number
}
export function learnedMode(
  control: ControlDef,
  samples: readonly LearnSample[],
): ControlDef['mode'] {
  if (control.kind === 'button' || control.kind === 'pad') return 'momentary'
  const values = samples.map((s) => s.value)
  // A bidirectional sequence around 64 identifies this supported relative format.
  // An ambiguous or short sequence stays absolute and can be corrected in the wizard.
  return values.length >= 3 &&
    values.some((v) => v > 64) &&
    values.some((v) => v < 64) &&
    values.every((v) => v >= 48 && v <= 80)
    ? 'relative64'
    : 'absolute'
}
export class Learn {
  private target?: { deviceId: string; control: ControlDef }
  private address?: NonNullable<ControlDef['msg']>
  private samples: LearnSample[] = []
  private timer?: ReturnType<typeof setTimeout>
  private done = false
  constructor(
    private captured: (deviceId: string, control: ControlDef) => void,
  ) {}
  start(deviceId: string, control: ControlDef): void {
    this.stop()
    this.target = { deviceId, control }
    this.done = false
  }
  active(deviceId: string): boolean {
    return this.target?.deviceId === deviceId
  }
  receive(message: MidiMessage): boolean {
    const target = this.target
    if (!target || target.deviceId !== message.source) return false
    if (this.done) return true
    if (message.type !== 'note' && message.type !== 'cc') return true
    const momentary =
      target.control.kind === 'button' || target.control.kind === 'pad'
    if (!momentary && message.type !== 'cc') return true
    const number = message.type === 'note' ? message.key : message.cc,
      value = message.type === 'note' ? message.velocity : message.value,
      release = message.type === 'note' ? !message.on : value === 0
    if (!this.address) {
      if (momentary && release) return true
      this.address = { type: message.type, channel: message.channel, number }
    }
    if (
      this.address.type !== message.type ||
      this.address.channel !== message.channel ||
      this.address.number !== number
    )
      return true
    if (momentary && release) {
      this.finish()
      return true
    }
    this.samples.push({ value })
    // Bound the capture even if a device streams unchanged values continuously.
    if (this.samples.length > 256) this.samples.shift()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.finish(), 450)
    return true
  }
  private finish(): void {
    clearTimeout(this.timer)
    if (!this.target || !this.address || !this.samples.length || this.done)
      return
    this.done = true
    this.captured(this.target.deviceId, {
      ...this.target.control,
      msg: this.address,
      mode: learnedMode(this.target.control, this.samples),
    })
  }
  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.target = undefined
    this.address = undefined
    this.samples = []
    this.done = false
  }
}
