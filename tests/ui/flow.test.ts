import { expect, it } from 'vitest'
import { flowGraph } from '../../src/ui/flow/model'
import { liveProject } from '../../src/shared/template'
import { defaultSettings } from '../../src/shared/defaults'
import type { RuntimeState } from '../../src/shared/protocol'
it('shows closed conditional routes, actual held routes and exact controller activity in five columns', () => {
  const project = liveProject('Flow')
  project.instruments.push({
    ...project.instruments[0],
    id: 'horn',
    name: 'Horn',
    program: 60,
  })
  project.base.patch.push({
    id: 'conditional',
    trackId: 'piano',
    instrumentId: 'horn',
    when: { reg: 1, on: true },
  })
  project.base.bindings.push({
    control: 'pad.2',
    edge: 'press',
    action: { type: 'note', trackId: 'piano', key: 60, velocity: 100 },
  })
  const runtime: RuntimeState = {
    activeSceneId: null,
    registers: Array(8).fill(false),
    armedCueId: null,
    pendingActions: [],
    expectedNext: null,
    clips: {},
    effective: { zones: project.base.zones, patch: project.base.patch },
  }
  const graph = flowGraph(
    project,
    runtime,
    {
      trackIds: ['piano'],
      instrumentIds: ['piano'],
      routes: [
        {
          sourceId: 'control:["one","pad.2"]',
          trackId: 'piano',
          instrumentId: 'piano',
        },
      ],
    },
    [
      { id: 'one', profileId: 'generic', name: 'One' },
      { id: 'two', profileId: 'generic', name: 'Two' },
    ],
    defaultSettings(),
    0,
  )
  expect(new Set(graph.nodes.map((n) => n.column)).size).toBe(5)
  expect(
    graph.edges.find((e) => e.connectionId === 'conditional'),
  ).toMatchObject({ enabled: false, active: false, label: 'R2 on' })
  expect(
    graph.nodes.find((n) => n.id === 'input:control:["one","pad.2"]')!.active,
  ).toBe(true)
  expect(
    graph.nodes.find((n) => n.id === 'input:control:["two","pad.2"]')!.active,
  ).toBe(false)
  expect(graph.nodes.find((n) => n.id === 'instrument:horn')!.active).toBe(
    false,
  )
  expect(graph.nodes.every((n) => n.x >= 0 && n.y + 34 < graph.height)).toBe(
    true,
  )
})
it('retains sounding destinations removed by a scene and labels the held route', () => {
  const project = liveProject('Held')
  const runtime: RuntimeState = {
    activeSceneId: null,
    registers: [],
    armedCueId: null,
    pendingActions: [],
    expectedNext: null,
    clips: {},
    effective: { zones: [], patch: [] },
  }
  const graph = flowGraph(
    project,
    runtime,
    {
      trackIds: ['piano'],
      instrumentIds: ['piano'],
      routes: [
        { sourceId: 'keys:one', trackId: 'piano', instrumentId: 'piano' },
      ],
    },
    [],
    defaultSettings(),
    0,
  )
  expect(graph.edges.find((e) => e.held)).toMatchObject({
    active: true,
    label: 'Held',
    from: 'track:piano',
    to: 'instrument:piano',
  })
})
it('uses runtime patch overrides without restoring a saved register gate', () => {
  const project = liveProject('Override')
  project.base.patch[0].when = { reg: 1, on: true }
  const runtime: RuntimeState = {
    activeSceneId: null,
    registers: Array(8).fill(false),
    armedCueId: null,
    pendingActions: [],
    expectedNext: null,
    clips: {},
    effective: {
      zones: project.base.zones,
      patch: [{ id: 'piano', trackId: 'piano', instrumentId: 'piano' }],
    },
  }
  const graph = flowGraph(
    project,
    runtime,
    { trackIds: [], instrumentIds: [], routes: [] },
    [],
    defaultSettings(),
    0,
  )
  expect(
    graph.edges.find((edge) => edge.connectionId === 'piano'),
  ).toMatchObject({
    enabled: true,
    condition: undefined,
  })
})
it('opens Script for a runtime zone owned by the script', () => {
  const project = liveProject('Script zones')
  const graph = flowGraph(
    project,
    {
      activeSceneId: null,
      registers: [],
      armedCueId: null,
      pendingActions: [],
      expectedNext: null,
      clips: {},
      scriptEnabled: true,
      scriptZones: true,
      effective: {
        zones: [{ ...project.base.zones[0], id: 'script-zone' }],
        patch: project.base.patch,
      },
    },
    { trackIds: [], instrumentIds: [], routes: [] },
    [],
    defaultSettings(),
    0,
  )
  expect(
    graph.nodes.find((node) => node.id === 'zone:script-zone')?.selection,
  ).toEqual({ kind: 'script' })
})
