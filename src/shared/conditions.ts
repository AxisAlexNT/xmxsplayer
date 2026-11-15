import type { Condition } from './model'
export interface ConditionContext {
  registers: readonly boolean[]
  activeSceneId: string | null
  bar: number
  playing: boolean
}
export function matchesCondition(
  condition: Condition | undefined,
  context: ConditionContext,
): boolean {
  if (!condition) return true
  if ('reg' in condition)
    return !!context.registers[condition.reg] === condition.on
  if ('scene' in condition) return context.activeSceneId === condition.scene
  if ('bars' in condition)
    return context.bar >= condition.bars[0] && context.bar <= condition.bars[1]
  if ('playing' in condition) return context.playing === condition.playing
  if ('all' in condition)
    return condition.all.every((c) => matchesCondition(c, context))
  if ('any' in condition)
    return condition.any.some((c) => matchesCondition(c, context))
  return !matchesCondition(condition.not, context)
}
