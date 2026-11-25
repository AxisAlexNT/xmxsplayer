import type { Action, Binding, Project } from '../../shared/model'
import { effectiveSetup, isUnbound } from '../../shared/overlay'
export function mappedBindings(
  project: Project,
  scene: string | null,
  profile: string,
  target: Action,
  continuous?: Action,
) {
  return effectiveSetup(project, scene, [profile]).bindings.filter(
    (binding) => {
      if (isUnbound(binding)) return false
      const action = binding.action
      if (
        action.type === 'param' &&
        !action.id &&
        (action.target === 'track.volume' || action.target === 'track.pan')
      ) {
        const number = /^fader\.(\d+)$/.exec(binding.control)
        if (number)
          return sameTarget(
            { ...action, id: project.tracks[Number(number[1]) - 1]?.id },
            target,
          )
      }
      return (
        sameTarget(action, target) ||
        (!!continuous && sameTarget(action, continuous))
      )
    },
  )
}
function sameTarget(a: Action, b: Action) {
  if (a.type !== b.type) return false
  if (a.type === 'param' && b.type === 'param')
    return (
      a.target === b.target &&
      a.id === b.id &&
      a.param === b.param &&
      a.effectId === b.effectId &&
      a.cc === b.cc
    )
  if (a.type === 'clip' && b.type === 'clip' && b.cmd === 'launch')
    return a.clipId === b.clipId && (a.cmd === 'launch' || a.cmd === 'sweep')
  return Object.entries(b).every(
    ([key, value]) => Reflect.get(a, key) === value,
  )
}
export function mapBinding(
  target: Action,
  control: string,
  edge: 'press' | 'change',
  continuous?: Action,
): Binding | undefined {
  if (edge === 'change' && continuous)
    return { control, edge, action: continuous }
  if (target.type === 'clip' && target.cmd === 'launch')
    return {
      control,
      edge,
      action: { ...target, cmd: edge === 'press' ? 'launch' : 'sweep' },
    }
  if ((target.type === 'param') !== (edge === 'change')) return
  return { control, edge, action: target }
}
