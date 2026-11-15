import type {
  Binding,
  ControllerMapping,
  Project,
  Setup,
} from '../../shared/model'
import { bindingKey } from '../../shared/overlay'
export interface BindingScope {
  kind: 'shared' | 'controller' | 'scene'
  profileId: string
  sceneId: string | null
  controllerScene?: boolean
}
export function bindingLayer(
  project: Project,
  scope: BindingScope,
  create = false,
): Partial<Pick<Setup, 'bindings' | 'padColors'>> | undefined {
  if (scope.kind === 'shared') return project.base
  if (scope.kind === 'scene')
    return project.scenes.find((s) => s.id === scope.sceneId)
  let mapping: ControllerMapping | undefined = project.mappings[scope.profileId]
  if (!mapping && create)
    project.mappings[scope.profileId] = mapping = {
      bindings: [],
      padColors: {},
      scenes: {},
    }
  if (!mapping) return
  if (!scope.controllerScene) return mapping
  if (!scope.sceneId) return
  if (!mapping.scenes[scope.sceneId] && create)
    mapping.scenes[scope.sceneId] = { bindings: [], padColors: {} }
  return mapping.scenes[scope.sceneId]
}
export function writeBinding(
  project: Project,
  scope: BindingScope,
  binding: Binding,
): void {
  const layer = bindingLayer(project, scope, true)
  if (!layer) throw Error('Choose a scene before storing scene bindings')
  layer.bindings = [
    ...(layer.bindings ?? []).filter(
      (b) => bindingKey(b) !== bindingKey(binding),
    ),
    binding,
  ]
}
export function writePadColor(
  project: Project,
  scope: BindingScope,
  control: string,
  color: string | null,
): void {
  const layer = bindingLayer(project, scope, true)
  if (!layer) throw Error('Choose a scene before storing scene colours')
  layer.padColors = { ...layer.padColors }
  if (color) layer.padColors[control] = color
  else delete layer.padColors[control]
}
