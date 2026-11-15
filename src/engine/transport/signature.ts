import type { Project } from '../../shared/model'
export function sequenceSignature(project: Project): string {
  return JSON.stringify({
    tempos: project.tempos,
    timeSigs: project.timeSigs,
    keySigs: project.keySigs,
    beatAnchors: project.beatAnchors,
    mapOwner: project.mapOwner,
    lengthTicks: project.lengthTicks,
    loop: project.loop,
    soundfonts: project.soundfonts,
    instruments: project.instruments.map((i) => ({
      id: i.id,
      backend: i.backend,
      soundfontId: i.soundfontId,
      bank: i.bank,
      program: i.program,
      isDrum: i.isDrum,
      midiOut: i.midiOut,
      transpose: i.transpose,
    })),
    patch: project.base.patch,
    tracks: [...project.tracks]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((t) =>
        t.kind === 'midi'
          ? {
              id: t.id,
              kind: t.kind,
              notes: t.notes,
              events: t.events,
              mode: t.mode,
              solo: t.solo,
            }
          : { id: t.id, mode: t.mode, solo: t.solo },
      ),
  })
}

export function eventSignature(project: Project): string {
  return JSON.stringify({
    tempos: project.tempos,
    timeSigs: project.timeSigs,
    keySigs: project.keySigs,
    beatAnchors: project.beatAnchors,
    mapOwner: project.mapOwner,
    lengthTicks: project.lengthTicks,
    loop: project.loop,
    tracks: project.tracks
      .map((t) =>
        t.kind === 'midi'
          ? { id: t.id, notes: t.notes, events: t.events }
          : { id: t.id },
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}
