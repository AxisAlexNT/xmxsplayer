export class FluidChannels {
  private used = new Set<number>()
  allocate(drum: boolean): number {
    const channel = Array.from({ length: 64 }, (_, i) => i).find(
      (i) => (i % 16 === 9) === drum && !this.used.has(i),
    )
    if (channel === undefined)
      throw Error(
        `FluidSynth has no free ${drum ? 'drum' : 'melodic'} channels`,
      )
    this.used.add(channel)
    return channel
  }
  release(channel: number): void {
    this.used.delete(channel)
  }
  clear(): void {
    this.used.clear()
  }
}
