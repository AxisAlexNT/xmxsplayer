import { effectParameters, type Effect } from './effects'
import type { Project } from './model'

export function effectOwners(project: Project) {
  return [
    { id: 'master', name: 'Master', effects: project.masterEffects },
    ...project.instruments.map((i) => ({
      id: 'instrument:' + i.id,
      name: i.name,
      effects: i.effects,
    })),
    ...(project.orchestras ?? []).flatMap((o) => [
      { id: 'orchestra:' + o.id, name: o.name, effects: o.effects },
      ...o.sections.map((s, i) => ({
        id: 'section:' + o.id + ':' + i,
        name: o.name + ' · ' + s.name,
        effects: s.effects,
      })),
    ]),
  ]
}

export function findEffect(
  project: Project,
  ownerId?: string,
  effectId?: string,
) {
  if (!ownerId || !effectId) return
  const owners = effectOwners(project)
  const owner =
    owners.find((o) => o.id === ownerId) ??
    owners.find(
      (o) =>
        o.id === 'instrument:' + ownerId || o.id === 'orchestra:' + ownerId,
    )
  const effect = owner?.effects?.find((f) => f.id === effectId)
  if (owner && effect) return { owner, effect }
}

export function effectParameterPatch(
  project: Project,
  ownerId: string | undefined,
  effectId: string | undefined,
  param: string | undefined,
  value: number,
): Partial<Project> | undefined {
  const found = findEffect(project, ownerId, effectId)
  if (
    !found ||
    !param ||
    !Object.hasOwn(effectParameters[found.effect.type], param) ||
    !Number.isFinite(value)
  )
    return
  const spec = effectParameters[found.effect.type][param]
  const bounded = Math.min(spec.max, Math.max(spec.min, value))
  const rounded = Number(
    (
      spec.min +
      Math.round((bounded - spec.min) / spec.step) * spec.step
    ).toFixed(6),
  )
  const replace = (chain?: Effect[]) =>
    chain?.map((e) =>
      e === found.effect
        ? { ...e, params: { ...e.params, [param]: rounded } }
        : e,
    )
  const [kind, id, section] = found.owner.id.split(':')
  if (kind === 'master')
    return { masterEffects: replace(project.masterEffects) }
  if (kind === 'instrument')
    return {
      instruments: project.instruments.map((i) =>
        i.id === id ? { ...i, effects: replace(i.effects) } : i,
      ),
    }
  return {
    orchestras: project.orchestras?.map((o) =>
      o.id !== id
        ? o
        : kind === 'orchestra'
          ? { ...o, effects: replace(o.effects) }
          : {
              ...o,
              sections: o.sections.map((s, i) =>
                i === Number(section)
                  ? { ...s, effects: replace(s.effects) }
                  : s,
              ),
            },
    ),
  }
}
