export interface FeedbackOutput {
  send(bytes: number[], timestamp?: number): void
  clear?(): void
}
interface Reservation {
  owner: string
  time: number
}
export class FeedbackBudget {
  private entries: Reservation[] = []
  constructor(readonly limit = 100) {}
  reserve(owner: string, time: number, now: number): boolean {
    this.entries = this.entries.filter((e) => e.time > now - 1000)
    const values = [...this.entries, { owner, time }].sort(
      (a, b) => a.time - b.time,
    )
    let first = 0
    for (let i = 0; i < values.length; i++) {
      while (values[i].time - values[first].time >= 1000) first++
      if (i - first + 1 > this.limit) return false
    }
    this.entries = values
    return true
  }
  cancel(owner: string, after: number): void {
    this.entries = this.entries.filter(
      (e) => e.owner !== owner || e.time <= after,
    )
  }
}
interface Packet {
  key: string
  bytes: number[]
  when: number
  priority: number
}
const equal = (
  a: readonly number[] | undefined,
  b: readonly number[],
): boolean => !!a && a.length === b.length && a.every((n, i) => n === b[i])
export class DiffOutput {
  private cache = new Map<string, number[]>()
  private pending = new Map<string, Packet>()
  private scheduled: Packet[] = []
  error: string | undefined
  constructor(
    private output: FeedbackOutput,
    private owner: string,
    private budget: FeedbackBudget,
    private now: () => number,
    private warn: (message: string) => void,
  ) {}
  advance(): void {
    const now = this.now()
    this.scheduled.sort((a, b) => a.when - b.when)
    for (const packet of this.scheduled)
      if (packet.when <= now) this.cache.set(packet.key, packet.bytes)
    this.scheduled = this.scheduled.filter((p) => p.when > now)
  }
  private expected(key: string, when: number): number[] | undefined {
    let value = this.cache.get(key)
    for (const packet of [...this.scheduled, ...this.pending.values()]
      .filter((p) => p.key === key && p.when <= when)
      .sort((a, b) => a.when - b.when))
      value = packet.bytes
    return value
  }
  hasFuture(): boolean {
    this.advance()
    return this.scheduled.length > 0
  }
  write(key: string, bytes: number[], when = this.now(), priority = 10): void {
    this.advance()
    const now = this.now()
    if (when <= now) {
      for (const [id, p] of this.pending)
        if (p.key === key && p.when <= now) this.pending.delete(id)
      if (equal(this.cache.get(key), bytes)) return
      this.pending.set(key, { key, bytes, when, priority })
    } else if (!equal(this.expected(key, when), bytes))
      this.pending.set(`${key}@${when}`, { key, bytes, when, priority })
  }
  flush(): void {
    if (this.error) return
    this.advance()
    const now = this.now()
    for (const [id, p] of [...this.pending.entries()].sort(
      (a, b) => a[1].priority - b[1].priority || a[1].when - b[1].when,
    )) {
      if (p.when > now + (this.output.clear ? 30 : 0)) continue
      const when = Math.max(now, p.when)
      if (!this.budget.reserve(this.owner, when, now)) break
      try {
        this.output.send(p.bytes, p.when)
      } catch (reason) {
        this.error = String(reason)
        this.warn(this.error)
        this.pending.clear()
        return
      }
      this.pending.delete(id)
      if (when > now) this.scheduled.push({ ...p, when })
      else this.cache.set(p.key, p.bytes)
    }
  }
  invalidateFuture(): void {
    this.advance()
    const now = this.now()
    if (this.scheduled.length) {
      try {
        this.output.clear?.()
        this.budget.cancel(this.owner, now)
      } catch (reason) {
        this.error = String(reason)
        this.warn(this.error)
      }
    }
    this.scheduled = []
    for (const [key, p] of this.pending)
      if (p.when > now) this.pending.delete(key)
  }
  forget(key: string): void {
    this.cache.delete(key)
  }
  reset(): void {
    this.invalidateFuture()
    this.cache.clear()
    this.pending.clear()
  }
  get empty(): boolean {
    return this.pending.size === 0
  }
}
