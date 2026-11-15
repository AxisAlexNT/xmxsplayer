import { expect, it } from 'vitest'
import { ScriptHost } from '../../src/engine/script/script-host'
import {
  ScriptTimeline,
  combineTimelines,
} from '../../src/engine/script/timeline'
import { TransportClock } from '../../src/engine/transport/clock'
import { TimeMap } from '../../src/shared/time-map'
import { newProject } from '../../src/shared/defaults'
import type { XmApi } from '../../src/shared/script-api'
it('fires musical hooks at boundaries, repeats through loops and resets on seek', () => {
  const project = newProject(),
    events: string[] = []
  let now = 0
  project.loop = { enabled: true, startTick: 0, endTick: 1920 }
  const clock = new TransportClock(new TimeMap(project), () => now)
  clock.setLoop(project.loop)
  const host = new ScriptHost(
    (on, state) =>
      ({ on, state, log: (s: string) => events.push(s) }) as unknown as XmApi,
    () => undefined,
  )
  host.load(
    `xm.on('beat', e => xm.log('beat:' + e.beat)); xm.on('bar', e => xm.log('bar:' + e.bar));`,
  )
  const timeline = new ScriptTimeline(clock, host)
  clock.play()
  expect(timeline.next(true)).toBeNull()
  expect(timeline.next()!.raw).toBe(0)
  timeline.next()!.run()
  expect(events).toEqual(['beat:1', 'bar:1'])
  expect(timeline.next()!.raw).toBe(0.5)
  for (now = 0.5; now <= 2; now += 0.5) timeline.next()!.run()
  expect(events.at(-1)).toBe('bar:1')
  clock.seek(0)
  timeline.reset()
  expect(timeline.next()!.raw).toBe(0)
  let cue = true
  const combined = combineTimelines(
    {
      next: () =>
        cue
          ? {
              raw: 0,
              hold: false,
              run: () => {
                cue = false
              },
            }
          : null,
    },
    timeline,
  )
  combined.next()!.run()
  expect(cue).toBe(false)
  combined.next()!.run()
  expect(events.at(-1)).toBe('bar:1')
})
it('retains a scheduled bar boundary when the next timer callback arrives late', () => {
  let now = 0
  const events: number[] = [],
    clock = new TransportClock(new TimeMap(newProject()), () => now)
  const host = new ScriptHost(
    (on, state) =>
      ({
        on,
        state,
        log: (bar: number) => events.push(bar),
      }) as unknown as XmApi,
    () => undefined,
  )
  host.load(`xm.on('bar', e => xm.log(e.bar))`)
  const timeline = new ScriptTimeline(clock, host)
  clock.play()
  timeline.next()!.run()
  expect(timeline.next()!.raw).toBe(2)
  now = 2.017
  expect(timeline.next()!.raw).toBe(2)
  timeline.next()!.run()
  expect(events).toEqual([1, 2])
  expect(timeline.next()!.raw).toBeCloseTo(4)
})
