import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { Project } from '../shared/model'
import { allPatches } from '../shared/patches'
import {
  pluginKey,
  type DiscoveredPlugin,
  type PluginPorts,
  type PluginRef,
} from '../shared/plugins'
import type { Effect } from '../shared/effects'
import type { PluginSession } from './plugin-host'

export async function readLv2Ports(
  helper: string,
  uris: string[],
): Promise<Record<string, PluginPorts>> {
  if (!uris.length) return {}
  const script = await readFile(helper, 'utf8')
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      ['-c', script],
      { timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        try {
          resolve(JSON.parse(stdout))
        } catch (e) {
          reject(e)
        }
      },
    )
    child.stdin?.on('error', reject)
    child.stdin?.end(JSON.stringify(uris))
  })
}

interface Endpoint {
  id: string
  ports: string[]
}
export function planPluginSession(
  project: Project,
  available: DiscoveredPlugin[],
  ports: Record<string, PluginPorts>,
): PluginSession {
  const session: PluginSession = { plugins: [], connections: [] }
  const installed = new Map(available.map((p) => [pluginKey(p), p]))
  const bus: Endpoint = {
    id: 'Audio Output',
    ports: ['Playback 1', 'Playback 2'],
  }
  const sourceOutputs = new Map<string, Endpoint>()
  const sidechains: { target: Endpoint; track: string }[] = []
  function connect(source: Endpoint, target: Endpoint) {
    if (!source.ports.length || !target.ports.length) return
    for (
      let i = 0;
      i <
      Math.max(
        Math.min(2, source.ports.length),
        Math.min(2, target.ports.length),
      );
      i++
    ) {
      const link = {
        source: source.id + ':' + source.ports[i % source.ports.length],
        target: target.id + ':' + target.ports[i % target.ports.length],
      }
      if (
        !session.connections.some(
          (c) => c.source === link.source && c.target === link.target,
        )
      )
        session.connections.push(link)
    }
  }
  function instance(
    id: string,
    ref: PluginRef,
    params: Record<string, number> = {},
    stateKey = id,
  ) {
    const plugin = installed.get(pluginKey(ref))
    if (!plugin) throw Error('Missing plugin: ' + ref.name)
    const io = ports[ref.uri]
    if (!io && ref.format === 'lv2')
      throw Error('Cannot read audio ports for ' + ref.name)
    const generic = (count: number, direction: string) =>
      Array.from(
        { length: count },
        (_, n) => 'Audio ' + direction + ' ' + (n + 1),
      )
    session.plugins.push({
      id,
      plugin,
      stateKey,
      stateFile: ref.stateFile,
      parameters: Object.entries(params).map(([index, value]) => ({
        index: Number(index),
        value,
      })),
    })
    return {
      input: { id, ports: io?.inputs ?? generic(plugin.audioInputs, 'Input') },
      output: {
        id,
        ports: io?.outputs ?? generic(plugin.audioOutputs, 'Output'),
      },
    }
  }
  function chain(owner: string, effects: Effect[], sources: Endpoint[]) {
    let outputs = sources
    for (const [i, fx] of effects.entries()) {
      if (!fx.enabled || fx.type !== 'plugin' || !fx.plugin) continue
      const stage = instance(
        owner + '-insert-' + i,
        fx.plugin,
        fx.params,
        owner + '-fx-' + fx.id,
      )
      for (const source of outputs)
        connect(source, {
          ...stage.input,
          ports: stage.input.ports.slice(0, 2),
        })
      if (fx.sidechain)
        sidechains.push({
          track: fx.sidechain.trackId,
          target: { ...stage.input, ports: stage.input.ports.slice(2) },
        })
      outputs = [stage.output]
    }
    return outputs
  }
  const mix: Endpoint[] = []
  for (const instrument of project.instruments) {
    if (instrument.backend !== 'plugin' || !instrument.plugin) continue
    const source = instance('instrument-' + instrument.id, instrument.plugin)
    const inherited = (project.orchestras ?? []).flatMap((o) => {
      const sections = o.sections.filter((s) =>
        s.members.some((m) => m.enabled && m.instrumentId === instrument.id),
      )
      return sections.length
        ? [...sections.flatMap((s) => s.effects ?? []), ...(o.effects ?? [])]
        : []
    })
    const [out] = chain(
      'instrument-' + instrument.id,
      [...(instrument.effects ?? []), ...inherited],
      [source.output],
    )
    sourceOutputs.set(instrument.id, out)
    mix.push(out)
  }
  for (const out of chain('master', project.masterEffects ?? [], mix))
    connect(out, bus)
  for (const { track, target } of sidechains) {
    for (const patch of allPatches(project).filter(
      (p) => p.trackId === track,
    )) {
      const source = sourceOutputs.get(patch.instrumentId)
      if (source) connect(source, target)
    }
  }
  return session
}
