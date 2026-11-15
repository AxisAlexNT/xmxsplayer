import { expect, it } from 'vitest'
import { ScheduledQueue } from '../../src/engine/synth/scheduled-queue'
it('orders equal-time events stably and cancels future events without touching another channel', () => {
  const queue = new ScheduledQueue<string>()
  queue.push(3, 0, 'later')
  queue.push(1, 0, 'off')
  queue.push(1, 0, 'on')
  queue.push(2, 1, 'other')
  expect(queue.takeDue(1)).toEqual(['off', 'on'])
  queue.cancel(0)
  expect(queue.takeDue(4)).toEqual(['other'])
  queue.push(5, 0, 'discard')
  queue.cancel()
  expect(queue.takeDue(10)).toEqual([])
})
