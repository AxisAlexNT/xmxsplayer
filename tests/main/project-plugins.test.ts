import { expect, it, vi } from 'vitest'
import { PluginHost } from '../../src/main/plugin-host'
import { ProjectPlugins } from '../../src/main/project-plugins'
import { liveProject } from '../../src/shared/template'
import type { DiscoveredPlugin } from '../../src/shared/plugins'

it('reloads reordered instances of the same plugin and keeps parameter edits live', async () => {
  const plugin: DiscoveredPlugin = {
    format: 'clap', uri: 'test', name: 'Test', file: '', maker: '', instrument: false,
    customUi: false, audioInputs: 2, audioOutputs: 2, midiInputs: 0, parameters: 1, uniqueId: 0,
  }
  const project = liveProject('Two inserts')
  project.masterEffects = ['first', 'second'].map(id => ({
    id, type: 'plugin', enabled: true, plugin: { format: plugin.format, uri: plugin.uri, name: plugin.name }, params: { '0': 1 },
  }))
  const host = new PluginHost(() => {})
  const reload = vi.spyOn(host, 'configure').mockResolvedValue()
  vi.spyOn(host, 'accepts').mockReturnValue(true)
  const send = vi.spyOn(host, 'send').mockImplementation(() => {})
  const manager = new ProjectPlugins(host, '', async () => [plugin])
  const confirm = vi.fn(async () => true)
  const apply = (playing = false) => manager.configure('/project', project, undefined, confirm, playing)
  await apply()
  project.masterEffects.reverse()
  confirm.mockResolvedValueOnce(false)
  expect(await apply(true)).toBe(false)
  expect(await apply(true)).toBe(false)
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(reload).toHaveBeenCalledTimes(1)
  await apply()
  expect(reload).toHaveBeenCalledTimes(2)
  project.masterEffects[0].params['0'] = 0.5
  await apply()
  expect(reload).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenCalledWith(reload.mock.calls[1][1].plugins[0].id, 'set_parameter_value', [
    { type: 'i', value: 0 }, { type: 'f', value: 0.5 },
  ])
})
