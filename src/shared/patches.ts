import type { PatchConn, Project } from './model'

/** Distinct routing variants need separate slots to preserve held voices. */
export const patchKey = (patch: PatchConn): string =>
  JSON.stringify([patch.trackId, patch.instrumentId, patch.transpose ?? 0])
export function allPatches(project: Project): PatchConn[] {
  const variants = new Map<string, PatchConn>()
  for (const patch of [
    project.base.patch,
    ...project.scenes.map((s) => s.patch ?? []),
  ].flat())
    variants.set(patchKey(patch), patch)
  if (project.script.trim())
    for (const track of project.tracks)
      if (track.kind === 'midi')
        for (const instrument of project.instruments) {
          const patch: PatchConn = {
            id: `script:${track.id}:${instrument.id}`,
            trackId: track.id,
            instrumentId: instrument.id,
          }
          if (!variants.has(patchKey(patch)))
            variants.set(patchKey(patch), patch)
        }
  return [...variants.values()]
}
