import { expect, it } from 'vitest'
import { advanceTour, startTour } from '../../src/ui/tutorial/machine'

it('resumes within the available steps and completes on the last Next', () => {
  const first = startTour(2, -1)
  expect(advanceTour(first, 'back')).toBe(first)
  const last = advanceTour(first, 'next')
  expect(last.index).toBe(startTour(2, 100).index)
  const done = advanceTour(last, 'next')
  expect(done.phase).toBe('completed')
  expect(advanceTour(done, 'back')).toBe(done)
})

it('ignores a delayed advance after the user leaves and revisits a step', () => {
  const first = advanceTour(startTour(3), 'matched')
  const timer = { feedbackElapsed: first.revision }
  expect(advanceTour(first, 'matched')).toBe(first)
  const second = advanceTour(first, timer)
  const revisited = advanceTour(advanceTour(second, 'back'), 'matched')
  expect(advanceTour(revisited, timer)).toBe(revisited)
  expect(advanceTour(revisited, {feedbackElapsed: revisited.revision}).index).toBe(1)
})

it('requires confirmation to end early and cancels pending feedback on resume', () => {
  const waiting = advanceTour(startTour(3), 'matched')
  const prompt = advanceTour(waiting, 'requestExit')
  expect(advanceTour(prompt, 'next')).toBe(prompt)
  const resumed = advanceTour(prompt, 'resume')
  expect(resumed.phase).toBe('active')
  expect(advanceTour(resumed, {feedbackElapsed: waiting.revision})).toBe(resumed)
  expect(advanceTour(prompt, 'confirmExit').phase).toBe('skipped')
})
