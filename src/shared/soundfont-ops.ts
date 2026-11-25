import { produce } from 'immer'
import type { Project } from './model'
import { uniqueId } from './ids'
import type { FluidPreset } from './fluid'

export function addFont(project: Project, file: string): Project {
  if (project.soundfonts.some((f) => f.file === file)) return project
  return produce(project, (d) => {
    d.soundfonts.push({
      id: uniqueId(
        file.replace(/\.sf[23]$/i, ''),
        d.soundfonts.map((f) => f.id),
      ),
      file,
    })
  })
}
export function removeFont(project: Project, id: string): Project {
  const used = project.instruments.filter((i) => i.soundfontId === id)
  if (used.length) throw Error(`Used by ${used.map((i) => i.name).join(', ')}`)
  return produce(project, (d) => {
    d.soundfonts = d.soundfonts.filter((f) => f.id !== id)
  })
}

export function replaceFont(
  project: Project,
  id: string,
  file: string,
  oldPresets: FluidPreset[],
  presets: FluidPreset[],
) {
  const unmatched: string[] = []
  if (!project.soundfonts.some((f) => f.id === id))
    throw Error('Soundfont is no longer in the project')
  const next = produce(addFont(project, file), (d) => {
    const target = d.soundfonts.find((f) => f.file === file)!
    for (const instrument of d.instruments.filter(
      (i) => i.soundfontId === id,
    )) {
      const old = oldPresets.find(
        (p) => p.bank === instrument.bank && p.program === instrument.program,
      )
      const name = old?.name ?? instrument.name
      const match =
        presets.find(
          (p) => p.bank === instrument.bank && p.program === instrument.program,
        ) ??
        presets.find((p) => p.name === name) ??
        presets.find((p) => p.name.toLowerCase() === name.toLowerCase())
      if (!match) {
        unmatched.push(instrument.name)
        continue
      }
      Object.assign(instrument, {
        soundfontId: target.id,
        bank: match.bank,
        program: match.program,
        isDrum: match.isDrum,
      })
    }
    if (target.id !== id && !unmatched.length)
      d.soundfonts = d.soundfonts.filter((f) => f.id !== id)
  })
  return { project: next, unmatched }
}
