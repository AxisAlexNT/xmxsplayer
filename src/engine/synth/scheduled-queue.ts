export class ScheduledQueue<T> {
  private entries: { time: number; channel: number; value: T }[] = []
  push(time: number, channel: number, value: T): void {
    let lo = 0,
      hi = this.entries.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.entries[mid].time <= time) lo = mid + 1
      else hi = mid
    }
    this.entries.splice(lo, 0, { time, channel, value })
  }
  drain(time: number, receive: (value: T) => void): void {
    while (this.entries[0] && this.entries[0].time <= time + 1e-9)
      receive(this.entries.shift()!.value)
  }
  takeDue(time: number): T[] {
    let end = 0
    while (end < this.entries.length && this.entries[end].time <= time + 1e-9)
      end++
    return this.entries.splice(0, end).map((entry) => entry.value)
  }
  cancel(channel = -1): void {
    this.entries =
      channel < 0
        ? []
        : this.entries.filter((entry) => entry.channel !== channel)
  }
}
