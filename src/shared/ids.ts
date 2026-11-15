export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  )
}
export function uniqueId(name: string, existing: Iterable<string>): string {
  const used = new Set(existing)
  const base = slugify(name)
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  return id
}
