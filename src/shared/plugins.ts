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
