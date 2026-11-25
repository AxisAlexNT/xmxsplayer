import type { ActivityState } from '../../shared/activity'
import type { Binding, Condition, Project, Settings } from '../../shared/model'
import type { EventMap, RuntimeState } from '../../shared/protocol'
import { matchesCondition } from '../../shared/conditions'
import { effectiveSetup } from '../../shared/overlay'
import { noteName } from '../../shared/schema'
import { TimeMap } from '../../shared/time-map'
export type FlowSelection =
  | { kind: 'device' | 'zone' | 'track' | 'instrument'; id: string }
  | { kind: 'control'; deviceId: string; controlId: string }
  | { kind: 'output'; instrumentId?: string }
  | { kind: 'keyboard' | 'script' | 'cues' }
export interface FlowNode {
  id: string
  column: number
  label: string
  color: string
  active: boolean
  selection?: FlowSelection
  x: number
  y: number
  width: number
}
export interface FlowEdge {
  id: string
  from: string
  to: string
  color: string
  active: boolean
  enabled: boolean
  label?: string
  condition?: Condition
  held?: boolean
  selection?: FlowSelection
  connectionId?: string
}
export interface FlowGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  width: number
  height: number
}
export function conditionLabel(condition: Condition): string {
  if ('reg' in condition)
    return `R${condition.reg + 1} ${condition.on ? 'on' : 'off'}`
  if ('scene' in condition) return `Scene: ${condition.scene}`
  if ('bars' in condition)
    return `Bars ${condition.bars[0]}–${condition.bars[1]}`
  if ('playing' in condition) return condition.playing ? 'Playing' : 'Stopped'
  if ('not' in condition) return `Not (${conditionLabel(condition.not)})`
  const children = 'all' in condition ? condition.all : condition.any
  return children.length
    ? children.map(conditionLabel).join('all' in condition ? ' + ' : ' / ')
    : 'all' in condition
      ? 'Always'
      : 'Never'
}
export function flowGraph(
  project: Project,
  runtime: RuntimeState,
  activity: ActivityState,
  devices: EventMap['midi:ports']['devices'],
  settings: Settings,
  tick: number,
  playing = false,
): FlowGraph {
  const nodes: FlowNode[] = [],
    edges: FlowEdge[] = [],
    routes = activity.routes ?? []
  const nodeMap = new Map<string, FlowNode>(),
    edgeKeys = new Set<string>()
  const context = {
    activeSceneId: runtime.activeSceneId,
    registers: runtime.registers,
    bar: new TimeMap(project).tickToBarBeat(tick).bar,
    playing,
  }
  const fallback = effectiveSetup(project, runtime.activeSceneId)
  const setup = {
    zones: runtime.effective.zones,
    patch: runtime.effective.patch,
  }
  const patches = setup.patch
  function node(
    id: string,
    column: number,
    label: string,
    color: string,
    active: boolean,
    selection?: FlowSelection,
  ): FlowNode {
    const old = nodeMap.get(id)
    if (old) {
      old.active ||= active
      return old
    }
    const result: FlowNode = {
      id,
      column,
      label,
      color,
      active,
      selection,
      x: [20, 240, 450, 660, 890][column],
      y: 38,
      width: [160, 150, 150, 170, 150][column],
    }
    nodes.push(result)
    nodeMap.set(id, result)
    return result
  }
  function edge(
    from: string,
    to: string,
    color: string,
    active: boolean,
    enabled = true,
    extras: Partial<FlowEdge> = {},
  ): void {
    if (!nodeMap.has(from) || !nodeMap.has(to)) return
    const id = JSON.stringify([
      from,
      to,
      extras.connectionId ?? '',
      extras.label ?? '',
    ])
    if (edgeKeys.has(id)) return
    edgeKeys.add(id)
    edges.push({ id, from, to, color, active, enabled, ...extras })
  }
  const sourceActive = (id: string): boolean =>
    routes.some((r) => r.sourceId === id)
  const sourceSelection = (id: string): FlowSelection | undefined => {
    if (id === 'screen') return { kind: 'keyboard' }
    if (id === 'sequencer') {
      const track = project.tracks.find(
        (t) =>
          t.kind === 'midi' &&
          (runtime.trackModes?.[t.id] ?? t.mode) === 'auto',
      )
      return track ? { kind: 'track', id: track.id } : undefined
    }
    if (id === 'script') return { kind: 'script' }
    if (id === 'cues') return { kind: 'cues' }
    if (id.startsWith('keys:')) return { kind: 'device', id: id.slice(5) }
    if (id.startsWith('audio:')) return { kind: 'track', id: id.slice(6) }
    if (id.startsWith('control:')) {
      try {
        const [deviceId, controlId] = JSON.parse(id.slice(8))
        return { kind: 'control', deviceId, controlId }
      } catch {
        return undefined
      }
    }
    return undefined
  }
  const shortDevice = (id: string): string => {
    const device = devices.find((d) => d.id === id)
    if (!device) return id
    const name =
      device.profileId === 'arturia-keylab-essential-mk3'
        ? 'KeyLab'
        : device.profileId === 'm-audio-axiom-61-mk2'
          ? 'Axiom'
          : device.name
    const twins = devices.filter((d) => d.profileId === device.profileId)
    return twins.length > 1
      ? `${name} ${twins.findIndex((d) => d.id === id) + 1}`
      : name
  }
  const sourceName = (id: string): string => {
    if (id === 'screen') return 'On-screen keyboard'
    if (id === 'sequencer') return 'Sequencer (AUTO)'
    if (id === 'script') return 'Script: note hook'
    if (id === 'cues') return 'Cue actions'
    if (id === 'audition') return 'Audition'
    if (id === 'action') return 'Note actions'
    if (id.startsWith('audio:'))
      return `Audio: ${project.tracks.find((t) => t.id === id.slice(6))?.name ?? id.slice(6)}`
    const selection = sourceSelection(id)
    if (selection?.kind === 'control')
      return `${shortDevice(selection.deviceId)} · ${selection.controlId.replace('.', ' ')}`
    return `${shortDevice(id.slice(5))} · keys`
  }
  function input(id: string): FlowNode {
    const color =
      id === 'sequencer'
        ? '#3ddc97'
        : id === 'script'
          ? '#b07cff'
          : id.startsWith('audio:')
            ? (project.tracks.find((t) => t.id === id.slice(6))?.color ??
              '#4cc2ff')
            : '#4cc2ff'
    return node(
      `input:${id}`,
      0,
      sourceName(id),
      color,
      sourceActive(id),
      sourceSelection(id),
    )
  }
  const keySources = [...devices.map((d) => `keys:${d.id}`), 'screen']
  const controlBindings: { deviceId: string; binding: Binding }[] = []
  keySources.forEach(input)
  if (project.tracks.some((t) => t.kind === 'midi')) input('sequencer')
  if (project.script.trim()) input('script')
  for (const route of routes) input(route.sourceId)
  for (const device of devices) {
    for (const binding of effectiveSetup(project, runtime.activeSceneId, [
      device.profileId,
    ]).bindings) {
      if (binding.action.type !== 'note') continue
      input(`control:${JSON.stringify([device.id, binding.control])}`)
      controlBindings.push({ deviceId: device.id, binding })
    }
  }
  for (const zone of setup.zones) {
    const active = routes.some((r) => r.zoneId === zone.id)
    node(
      `zone:${zone.id}`,
      1,
      `${zone.id} · ${noteName(zone.lo)}–${noteName(zone.hi)}`,
      zone.color,
      active,
      runtime.scriptZones ? { kind: 'script' } : { kind: 'zone', id: zone.id },
    )
    for (const source of keySources)
      edge(
        `input:${source}`,
        `zone:${zone.id}`,
        zone.color,
        routes.some((r) => r.sourceId === source && r.zoneId === zone.id),
      )
    if (runtime.scriptEnabled)
      edge(
        'input:script',
        `zone:${zone.id}`,
        zone.color,
        routes.some((r) => r.sourceId === 'script' && r.zoneId === zone.id),
      )
  }
  for (const track of project.tracks) {
    const mode =
      runtime.trackModes?.[track.id] ??
      fallback.trackModes[track.id] ??
      track.mode
    node(
      `track:${track.id}`,
      2,
      `${track.name} · ${mode.toUpperCase()}`,
      track.color,
      activity.trackIds.includes(track.id),
      { kind: 'track', id: track.id },
    )
    for (const zone of setup.zones)
      if (zone.trackIds.includes(track.id))
        edge(
          `zone:${zone.id}`,
          `track:${track.id}`,
          track.color,
          routes.some((r) => r.zoneId === zone.id && r.trackId === track.id),
          mode !== 'mute',
        )
    if (track.kind === 'audio') {
      input(`audio:${track.id}`)
      edge(
        `input:audio:${track.id}`,
        `track:${track.id}`,
        track.color,
        activity.trackIds.includes(track.id),
        mode === 'auto',
      )
      continue
    }
    if (
      mode === 'auto' ||
      routes.some((r) => r.sourceId === 'sequencer' && r.trackId === track.id)
    )
      edge(
        'input:sequencer',
        `track:${track.id}`,
        track.color,
        routes.some(
          (r) => r.sourceId === 'sequencer' && r.trackId === track.id,
        ) ||
          (!activity.routes && activity.trackIds.includes(track.id)),
        mode === 'auto',
      )
  }
  for (const { deviceId, binding } of controlBindings) {
    if (binding.action.type !== 'note') continue
    const sourceId = `control:${JSON.stringify([deviceId, binding.control])}`,
      trackId = binding.action.trackId,
      instrumentId = binding.action.instrumentId
    edge(
      `input:${sourceId}`,
      instrumentId ? `instrument:${instrumentId}` : `track:${trackId}`,
      project.instruments.find(i => i.id === instrumentId)?.color ?? project.tracks.find((t) => t.id === trackId)?.color ?? '#4cc2ff',
      routes.some((r) => r.sourceId === sourceId && (instrumentId ? r.instrumentId === instrumentId : r.trackId === trackId)),
      matchesCondition(binding.when, context),
      {
        condition: binding.when,
        label: binding.when ? conditionLabel(binding.when) : undefined,
        selection: { kind: 'control', deviceId, controlId: binding.control },
      },
    )
  }
  const instrumentIds = new Set([
    ...patches.map((p) => p.instrumentId),
    ...controlBindings.flatMap(({binding}) => binding.action.type === 'note' && binding.action.instrumentId ? [binding.action.instrumentId] : []),
    ...activity.instrumentIds,
  ])
  for (const id of instrumentIds) {
    const instrument = project.instruments.find((i) => i.id === id)
    node(
      `instrument:${id}`,
      3,
      instrument?.name ?? `${id} · held`,
      instrument?.color ?? '#94a3b8',
      activity.instrumentIds.includes(id),
      instrument ? { kind: 'instrument', id } : undefined,
    )
    if (!instrument) continue
    const backend =
      instrument.backend === 'default'
        ? settings.audio.defaultSynth
        : instrument.backend
    const outputId =
      backend === 'midi'
        ? `midi:${instrument.midiOut?.portName ?? 'Unassigned'}`
        : backend
    const label =
      backend === 'midi'
        ? `MIDI: ${instrument.midiOut?.portName ?? 'Unassigned'}`
        : backend === 'fluid'
          ? 'FluidSynth → Main'
          : 'Built-in synth → Main'
    node(
      `output:${outputId}`,
      4,
      label,
      '#4cc2ff',
      activity.instrumentIds.includes(id),
      { kind: 'output', ...(backend === 'midi' ? { instrumentId: id } : {}) },
    )
    edge(
      `instrument:${id}`,
      `output:${outputId}`,
      instrument.color,
      activity.instrumentIds.includes(id),
    )
  }
  for (const patch of patches) {
    const enabled = matchesCondition(patch.when, context)
    const instrument = project.instruments.find(
        (i) => i.id === patch.instrumentId,
      ),
      track = project.tracks.find((t) => t.id === patch.trackId)
    const active =
      routes.some(
        (r) =>
          r.trackId === patch.trackId && r.instrumentId === patch.instrumentId,
      ) ||
      (!activity.routes &&
        activity.trackIds.includes(patch.trackId) &&
        activity.instrumentIds.includes(patch.instrumentId))
    edge(
      `track:${patch.trackId}`,
      `instrument:${patch.instrumentId}`,
      instrument?.color ?? track?.color ?? '#94a3b8',
      active,
      enabled,
      {
        condition: patch.when,
        label: patch.when ? conditionLabel(patch.when) : undefined,
        connectionId: patch.id,
      },
    )
  }
  for (const route of routes) {
    if (route.zoneId)
      edge(`input:${route.sourceId}`, `zone:${route.zoneId}`, '#4cc2ff', true)
    else if (route.trackId)
      edge(
        `input:${route.sourceId}`,
        `track:${route.trackId}`,
        project.tracks.find((t) => t.id === route.trackId)?.color ?? '#4cc2ff',
        true,
      )
    else if (route.instrumentId)
      edge(
        `input:${route.sourceId}`,
        `instrument:${route.instrumentId}`,
        '#4cc2ff',
        true,
      )
    if (
      route.trackId &&
      route.instrumentId &&
      !patches.some(
        (p) =>
          p.trackId === route.trackId && p.instrumentId === route.instrumentId,
      )
    )
      edge(
        `track:${route.trackId}`,
        `instrument:${route.instrumentId}`,
        '#ffb020',
        true,
        false,
        { held: true, label: 'Held' },
      )
  }
  for (const track of project.tracks)
    if (track.kind === 'audio') {
      const toCue = track.toCue && settings.audio.cue.mode !== 'off',
        outputId = toCue ? 'cue' : 'audio',
        active = activity.trackIds.includes(track.id)
      node(
        `output:${outputId}`,
        4,
        toCue ? 'Cue out' : 'Audio → Main',
        '#4cc2ff',
        active,
        { kind: 'output' },
      )
      edge(`track:${track.id}`, `output:${outputId}`, track.color, active)
    }
  if (project.metronome.audible && project.metronome.toCue)
    node(
      'output:cue',
      4,
      settings.audio.cue.mode === 'off'
        ? 'Cue click → Main'
        : 'Cue out (click)',
      '#4cc2ff',
      false,
      { kind: 'output' },
    )
  for (let column = 0; column < 5; column++)
    nodes
      .filter((n) => n.column === column)
      .forEach((n, index) => {
        n.y += index * 46
      })
  return {
    nodes,
    edges,
    width: 1060,
    height: Math.max(330, 60 + Math.max(0, ...nodes.map((n) => n.y))),
  }
}
