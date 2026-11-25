import type { Project } from './model'
export type PluginFormat = 'lv2' | 'clap' | 'vst3' | 'ladspa'
export interface DiscoveredPlugin {
  format: PluginFormat
  file: string
  uri: string
  name: string
  maker: string
  instrument: boolean
  customUi: boolean
  audioInputs: number
  audioOutputs: number
  midiInputs: number
  parameters: number
  uniqueId: number
}

export interface PluginRef {
  format: PluginFormat
  uri: string
  name: string
  hasSidechain?: boolean
  parameters?: PluginPorts['parameters']
  stateFile?: string
}

export const pluginKey = (plugin: Pick<PluginRef, 'format' | 'uri'>): string =>
  plugin.format + ':' + plugin.uri

export function requiredPlugins(project: Project): PluginRef[] {
  const chains = [
    project.masterEffects,
    ...project.instruments.map((i) => i.effects),
    ...(project.orchestras ?? []).flatMap((o) => [
      o.effects,
      ...o.sections.map((s) => s.effects),
    ]),
  ]
  const plugins = new Map<string, PluginRef>()
  for (const instrument of project.instruments) {
    if (instrument.backend === 'plugin' && instrument.plugin)
      plugins.set(pluginKey(instrument.plugin), instrument.plugin)
  }
  for (const chain of chains)
    for (const effect of chain ?? []) {
      if (effect.type === 'plugin' && effect.plugin)
        plugins.set(pluginKey(effect.plugin), effect.plugin)
    }
  return [...plugins.values()]
}

export interface PluginPorts {
  sidechains?: string[]
  inputs: string[]
  outputs: string[]
  parameters: {
    index: number
    name: string
    input: boolean
    min: number
    max: number
    initial: number
  }[]
}

export type PluginCommand =
  | 'note_on'
  | 'note_off'
  | 'set_parameter_value'
  | 'set_program'
  | 'set_volume'
  | 'set_drywet'
export interface PluginStatus { status:'starting'|'ready'|'stopped'|'error'; message?:string }
export interface PluginPlayback {
  onState(handler:(state:PluginStatus)=>void):()=>void
  configure(project: Project, playing: boolean): Promise<boolean>
  send(id: string, command: PluginCommand, values: number[]): Promise<void>
}
