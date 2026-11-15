import type { Note } from '../../shared/model'
export interface EditResult {
  notes: Note[]
  selection: Note[]
  replacements: Map<Note, Note | null>
}
export const snapOptions = [
  ['1/4', 480],
  ['1/8', 240],
  ['1/16', 120],
  ['1/32', 60],
  ['1/4 T', 320],
  ['1/8 T', 160],
  ['1/16 T', 80],
  ['1/32 T', 40],
  ['Off', 0],
] as const
export const snapTick = (tick: number, grid: number): number =>
  grid ? Math.round(tick / grid) * grid : tick
export function pressureVelocity(pressure: number): number {
  return Math.max(1, Math.min(127, Math.round(pressure * 127)))
}
export function sorted(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => a[0] - b[0] || a[2] - b[2])
}
function transform(
  notes: readonly Note[],
  selection: readonly Note[],
  change: (note: Note) => Note | null,
): EditResult {
  const chosen = new Set(selection),
    replacements = new Map<Note, Note | null>(),
    selected: Note[] = [],
    next: Note[] = []
  for (const note of notes) {
    if (!chosen.has(note)) {
      next.push(note)
      continue
    }
    let value = change(note)
    if (value && value.every((v, i) => v === note[i])) value = note
    replacements.set(note, value)
    if (value) {
      next.push(value)
      selected.push(value)
    }
  }
  return { notes: sorted(next), selection: selected, replacements }
}
export function createNote(
  notes: readonly Note[],
  tick: number,
  end: number,
  key: number,
  velocity: number,
  grid: number,
): EditResult {
  const start = Math.max(
      0,
      grid
        ? Math.floor(Math.min(tick, end) / grid) * grid
        : Math.min(tick, end),
    ),
    finish = Math.max(
      start + (grid || 1),
      grid ? Math.ceil(Math.max(tick, end) / grid) * grid : Math.max(tick, end),
    )
  const note: Note = [
    start,
    finish - start,
    Math.max(0, Math.min(127, Math.round(key))),
    Math.max(1, Math.min(127, Math.round(velocity))),
  ]
  return {
    notes: sorted([...notes, note]),
    selection: [note],
    replacements: new Map(),
  }
}
export function moveNotes(
  notes: readonly Note[],
  selection: readonly Note[],
  ticks: number,
  keys: number,
  grid: number,
): EditResult {
  if (!selection.length)
    return { notes: [...notes], selection: [], replacements: new Map() }
  ticks = Math.max(
    -Math.min(...selection.map((n) => n[0])),
    snapTick(ticks, grid),
  )
  keys = Math.max(
    -Math.min(...selection.map((n) => n[2])),
    Math.min(127 - Math.max(...selection.map((n) => n[2])), Math.round(keys)),
  )
  return transform(notes, selection, (n) => [
    n[0] + ticks,
    n[1],
    n[2] + keys,
    n[3],
  ])
}
export function resizeNotes(
  notes: readonly Note[],
  selection: readonly Note[],
  ticks: number,
  edge: 'start' | 'end',
  grid: number,
): EditResult {
  if (ticks === 0)
    return {
      notes: [...notes],
      selection: [...selection],
      replacements: new Map(),
    }
  return transform(notes, selection, (n) => {
    const end = n[0] + n[1]
    if (edge === 'start') {
      const start = Math.max(0, Math.min(end - 1, snapTick(n[0] + ticks, grid)))
      return [start, end - start, n[2], n[3]]
    }
    return [
      n[0],
      Math.max(grid || 1, snapTick(end + ticks, grid) - n[0]),
      n[2],
      n[3],
    ]
  })
}
export function velocityNotes(
  notes: readonly Note[],
  selection: readonly Note[],
  delta: number,
): EditResult {
  return transform(notes, selection, (n) => [
    n[0],
    n[1],
    n[2],
    Math.max(1, Math.min(127, n[3] + Math.round(delta))),
  ])
}
export function deleteNotes(
  notes: readonly Note[],
  selection: readonly Note[],
): EditResult {
  return transform(notes, selection, () => null)
}
export function duplicateNotes(
  notes: readonly Note[],
  selection: readonly Note[],
  grid: number,
): EditResult {
  if (!selection.length)
    return { notes: [...notes], selection: [], replacements: new Map() }
  const start = Math.min(...selection.map((n) => n[0])),
    end = Math.max(...selection.map((n) => n[0] + n[1])),
    step = grid || 1,
    offset = Math.max(step, Math.ceil((end - start) / step) * step)
  const copies = selection.map((n): Note => [n[0] + offset, n[1], n[2], n[3]])
  return {
    notes: sorted([...notes, ...copies]),
    selection: copies,
    replacements: new Map(),
  }
}
export function quantizeNotes(
  notes: readonly Note[],
  selection: readonly Note[],
  grid: number,
): EditResult {
  if (!grid)
    return {
      notes: [...notes],
      selection: [...selection],
      replacements: new Map(),
    }
  return transform(notes, selection, (n) => {
    const start = Math.max(0, snapTick(n[0], grid)),
      end = snapTick(n[0] + n[1], grid)
    return [start, Math.max(grid, end - start), n[2], n[3]]
  })
}
export function marquee(
  notes: readonly Note[],
  start: number,
  end: number,
  low: number,
  high: number,
): Note[] {
  return notes.filter(
    (n) =>
      n[0] <= Math.max(start, end) &&
      n[0] + n[1] >= Math.min(start, end) &&
      n[2] >= Math.min(low, high) &&
      n[2] <= Math.max(low, high),
  )
}
