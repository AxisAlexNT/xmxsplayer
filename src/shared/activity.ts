export interface ActivityRoute {
  sourceId: string
  zoneId?: string
  trackId?: string
  instrumentId?: string
}
export interface ActivityState {
  trackIds: string[]
  instrumentIds: string[]
  routes?: ActivityRoute[]
}
export function activitySource(source: string): string {
  if (source.startsWith('binding:')) {
    try {
      const [deviceId, controlId] = JSON.parse(source.slice(8))
      return `control:${JSON.stringify([deviceId, controlId])}`
    } catch {
      return 'action'
    }
  }
  if (/^(ui$|pointer-|key-)/.test(source)) return 'screen'
  if (source === 'action') return 'action'
  if (source.startsWith('roll-')) return 'audition'
  if (source.startsWith('cue-note:')) return 'cues'
  if (source.startsWith('script:')) return 'script'
  if (
    source.startsWith('instrument-audition-') ||
    source.startsWith('audition')
  )
    return 'audition'
  return `keys:${source}`
}
export function activityState(routes: readonly ActivityRoute[]): ActivityState {
  const unique = new Map<string, ActivityRoute>()
  for (const route of routes) {
    const clean = {
      sourceId: route.sourceId,
      ...(route.zoneId ? { zoneId: route.zoneId } : {}),
      ...(route.trackId ? { trackId: route.trackId } : {}),
      ...(route.instrumentId ? { instrumentId: route.instrumentId } : {}),
    }
    unique.set(JSON.stringify(clean), clean)
  }
  const values = [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, route]) => route)
  return {
    trackIds: [
      ...new Set(values.flatMap((r) => (r.trackId ? [r.trackId] : []))),
    ].sort(),
    instrumentIds: [
      ...new Set(
        values.flatMap((r) => (r.instrumentId ? [r.instrumentId] : [])),
      ),
    ].sort(),
    routes: values,
  }
}
