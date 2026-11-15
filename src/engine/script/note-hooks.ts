import type { KeyEvent } from '../../shared/script-api'

/** A release follows the destinations chosen by its press, across script reloads. */
export class NoteHooks {
  private held = new Map<string, KeyEvent[][]>()
  constructor(
    private transform: (note: KeyEvent) => KeyEvent[],
    private send: (
      note: KeyEvent,
      source: string,
      when?: number,
      inputKey?: number,
    ) => void,
  ) {}
  receive(event: KeyEvent, when?: number): void {
    const owner = JSON.stringify([event.deviceId, event.channel, event.key])
    if (event.on && event.vel > 0) {
      const notes = this.transform(event).filter((note) => note.vel > 0)
      const held = this.held.get(owner) ?? []
      held.push(notes)
      this.held.set(owner, held)
      for (const note of notes) this.send(note, event.deviceId, when, event.key)
    } else {
      this.transform(event)
      const held = this.held.get(owner),
        notes = held?.shift()
      if (!held?.length) this.held.delete(owner)
      for (const note of notes ?? [])
        this.send(
          { ...note, on: false, vel: event.vel },
          event.deviceId,
          when,
          event.key,
        )
    }
  }
  disconnect(deviceId: string): void {
    for (const [owner, held] of this.held) {
      if (JSON.parse(owner)[0] !== deviceId) continue
      this.held.delete(owner)
      for (const notes of held)
        for (const note of notes)
          this.send(
            { ...note, on: false, vel: 0 },
            deviceId,
            undefined,
            JSON.parse(owner)[2],
          )
    }
  }
  clear(): void {
    for (const source of new Set(
      [...this.held.keys()].map((owner) => JSON.parse(owner)[0] as string),
    ))
      this.disconnect(source)
  }
}
