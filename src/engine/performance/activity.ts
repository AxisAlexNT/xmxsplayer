import {
  activityState,
  type ActivityRoute,
  type ActivityState,
} from '../../shared/activity'
export class Activity {
  private pulses: { route: ActivityRoute; when: number; owner: string }[] = []
  private timer?: ReturnType<typeof setInterval>
  private signature = ''
  constructor(
    private now: () => number,
    private read: () => readonly ActivityRoute[],
    private report: (state: ActivityState) => void,
  ) {}
  start(): void {
    if (!this.timer) {
      this.tick()
      this.timer = setInterval(() => this.tick(), 70)
    }
  }
  pulse(route: ActivityRoute, when = this.now(), owner = 'live'): void {
    this.pulses.push({ route, when, owner })
  }
  cancel(owner: string, keepStarted = false): void {
    const now = this.now()
    this.pulses = this.pulses.filter(
      (p) => p.owner !== owner || (keepStarted && p.when <= now),
    )
  }
  invalidate(): void {
    this.signature = ''
  }
  clear(): void {
    this.pulses = []
    this.invalidate()
  }
  tick(): void {
    const now = this.now()
    this.pulses = this.pulses.filter((p) => p.when + 120 > now)
    const state = activityState([
      ...this.read(),
      ...this.pulses.filter((p) => p.when <= now).map((p) => p.route),
    ])
    const signature = JSON.stringify(state)
    if (signature !== this.signature) {
      this.signature = signature
      this.report(state)
    }
  }
  close(): void {
    clearInterval(this.timer)
    this.timer = undefined
    this.pulses = []
  }
}
