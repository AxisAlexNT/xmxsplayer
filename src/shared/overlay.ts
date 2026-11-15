import type { Binding, Project, Setup } from './model'
export const bindingKey = (
  binding: Pick<Binding, 'control' | 'edge'>,
): string => `${binding.control}|${binding.edge}`
export function mergeBindings(
  ...layers: readonly (readonly Binding[])[]
): Binding[] {
  const result = new Map<string, Binding>()
  for (const layer of layers)
    for (const binding of layer) result.set(bindingKey(binding), binding)
  return [...result.values()]
}
export function overlaySetup(base: Setup, layer: Partial<Setup>): Setup {
  return {
    zones: layer.zones ?? base.zones,
    patch: layer.patch ?? base.patch,
    bindings: mergeBindings(base.bindings, layer.bindings ?? []),
    trackModes: { ...base.trackModes, ...layer.trackModes },
    padColors: { ...base.padColors, ...layer.padColors },
    beatChase: layer.beatChase ?? base.beatChase,
  }
}
export function effectiveSetup(
  project: Project,
  sceneId: string | null,
  profileIds: readonly string[] = [],
): Setup {
  const scene = project.scenes.find((s) => s.id === sceneId)
  let setup = scene
    ? overlaySetup(project.base, scene)
    : overlaySetup(project.base, {})
  for (const id of new Set(profileIds)) {
    const mapping = project.mappings[id]
    if (!mapping) continue
    setup = overlaySetup(setup, mapping)
    if (sceneId && mapping.scenes[sceneId])
      setup = overlaySetup(setup, mapping.scenes[sceneId])
  }
  return setup
}
export const isUnbound = (binding: Binding | undefined): boolean =>
  !binding ||
  (!!binding.when && 'any' in binding.when && binding.when.any.length === 0)
export function unbound(control: string, edge: Binding['edge']): Binding {
  return {
    control,
    edge,
    when: { any: [] },
    action: { type: 'transport', cmd: 'toggle' },
  }
}
