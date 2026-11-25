export const feedbackDurationMs = 600

export interface TourState {
  index: number
  count: number
  phase: 'active' | 'feedback' | 'confirmExit' | 'completed' | 'skipped'
  revision: number
}

export type TourAction =
  | 'back' | 'next' | 'requestExit' | 'resume' | 'confirmExit' | 'matched'
  | { feedbackElapsed: number }

export function startTour(count: number, resumeIndex = 0): TourState {
  if (!Number.isSafeInteger(count) || count < 1) throw Error('A tour needs at least one step')
  const index = Number.isSafeInteger(resumeIndex) ? Math.max(0, Math.min(count - 1, resumeIndex)) : 0
  return { index, count, phase: 'active', revision: 0 }
}

export function advanceTour(state: TourState, action: TourAction): TourState {
  if (state.phase === 'completed' || state.phase === 'skipped') return state
  if (state.phase === 'confirmExit') {
    if (action === 'resume') return { ...state, phase: 'active' }
    if (action === 'confirmExit') return { ...state, phase: 'skipped' }
    return state
  }
  if (action === 'requestExit')
    return { ...state, phase: 'confirmExit', revision: state.revision + 1 }
  if (action === 'back') {
    if (state.index === 0) return state
    return { ...state, index: state.index - 1, phase: 'active', revision: state.revision + 1 }
  }
  if (action === 'matched')
    return state.phase === 'active' ? { ...state, phase: 'feedback' } : state
  if (typeof action === 'object') {
    if (state.phase !== 'feedback' || action.feedbackElapsed !== state.revision) return state
  } else if (action !== 'next') return state
  if (state.index === state.count - 1) return { ...state, phase: 'completed' }
  return { ...state, index: state.index + 1, phase: 'active', revision: state.revision + 1 }
}
