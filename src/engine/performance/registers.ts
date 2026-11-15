import type { RegisterDef } from '../../shared/model'

/** Stored register choices plus source-owned temporary holds. */
export class Registers {
  private base = Array<boolean>(8).fill(false)
  private held = new Map<string, number>()
  private definitions: readonly RegisterDef[] = []

  configure(definitions: readonly RegisterDef[]): void {
    this.definitions = definitions
    this.base = this.normalize(this.base)
    for (const [owner, index] of this.held)
      if (!this.valid(index)) this.held.delete(owner)
  }
  private valid(index: number): boolean {
    return (
      Number.isInteger(index) &&
      index >= 0 &&
      index < 8 &&
      !!this.definitions[index]
    )
  }
  private apply(values: boolean[], index: number, on: boolean): void {
    if (!this.valid(index)) return
    const definition = this.definitions[index]
    if (on && definition.mode === 'exclusive' && definition.group)
      this.definitions.forEach((other, i) => {
        if (i !== index && other.group === definition.group) values[i] = false
      })
    values[index] = on
  }
  private normalize(values: readonly boolean[]): boolean[] {
    const result = Array<boolean>(8).fill(false)
    values.forEach((on, i) => {
      if (on) this.apply(result, i, true)
    })
    return result
  }
  get values(): boolean[] {
    const values = [...this.base]
    for (const index of this.held.values()) this.apply(values, index, true)
    return values
  }
  set(index: number, on: boolean): void {
    this.apply(this.base, index, on)
  }
  toggle(index: number): void {
    if (this.valid(index)) this.set(index, !this.values[index])
  }
  momentary(index: number, source: string, pressed: boolean): void {
    if (!this.valid(index)) return
    const owner = JSON.stringify([source, index])
    if (pressed) this.held.set(owner, index)
    else this.held.delete(owner)
  }
  preset(values: readonly (boolean | null)[]): void {
    // Clear explicit off values first, then apply on values in register order.
    values.forEach((on, i) => {
      if (on === false) this.set(i, false)
    })
    values.forEach((on, i) => {
      if (on === true) this.set(i, true)
    })
  }
  reset(): void {
    this.base.fill(false)
    this.held.clear()
  }
}
