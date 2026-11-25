import type { Project } from '../shared/model'
import {
  requiredPlugins,
  type DiscoveredPlugin,
  type PluginPorts,
  type PluginCommand,
} from '../shared/plugins'
import { PluginHost, pluginStateKey, type PluginSession } from './plugin-host'
import { planPluginSession, readLv2Ports } from './plugin-session'
import type { OscArg } from './osc'

export class ProjectPlugins {
  private inventory?: DiscoveredPlugin[]
  private ports: Record<string, PluginPorts> = {}
  private structure = ''
  private folder = ''
  private session?: PluginSession
  private changes: Promise<unknown> = Promise.resolve()
  constructor(
    private host: PluginHost,
    private helper: string,
    private scan: () => Promise<DiscoveredPlugin[]>,
  ) {}
  setInventory(inventory: DiscoveredPlugin[]) {
    this.inventory = inventory
    this.ports = {}
  }
  configure(
    folder: string,
    project: Project,
    executable: string | undefined,
    confirm: () => Promise<boolean>,
  ) {
    const task = this.changes.then(async () => {
      const refs = requiredPlugins(project)
      if (refs.length) {
        this.inventory ??= await this.scan()
        const missing = refs.filter(
          (ref) => ref.format === 'lv2' && !this.ports[ref.uri],
        )
        Object.assign(
          this.ports,
          await readLv2Ports(
            this.helper,
            missing.map((r) => r.uri),
          ),
        )
      }
      const session = planPluginSession(
        project,
        this.inventory ?? [],
        this.ports,
      )
      const structure = JSON.stringify([
        folder,
        executable,
        session.connections,
        session.plugins.map((p) => [p.id, pluginStateKey(p)]),
      ])
      if (structure !== this.structure) {
        if (!(await confirm())) return false
        await this.host.configure(folder, session, executable)
        this.structure = structure
      }
      // A graph rebuild can move an existing effect to a different Carla slot.
      // Reapply simultaneous project edits after its native state is restored.
      if (folder === this.folder) {
        for (const plugin of session.plugins) {
          const previous = this.session?.plugins.find(p =>
            pluginStateKey(p) === pluginStateKey(plugin))
          if (!previous) continue
          for (const { index, value } of plugin.parameters ?? [])
            if (previous.parameters?.find(p => p.index === index)?.value !== value)
              this.send(plugin.id, 'set_parameter_value', [index, value])
        }
      }
      this.folder = folder
      this.session = session
      return true
    })
    this.changes = task.catch(() => undefined)
    return task
  }
  send(id: string, command: PluginCommand, values: number[]) {
    const signatures: Record<PluginCommand, string> = {
      note_on: 'iii',
      note_off: 'ii',
      set_parameter_value: 'if',
      set_program: 'i',
      set_volume: 'f',
      set_drywet: 'f',
    }
    if (
      !Object.hasOwn(signatures, command) ||
      !Array.isArray(values) ||
      values.length !== signatures[command].length
    )
      throw Error('Invalid plugin command')
    if (
      command.startsWith('note_') &&
      (values[0] < 0 ||
        values[0] > 15 ||
        values.slice(1).some((v) => v < 0 || v > 127))
    )
      throw Error('Invalid plugin MIDI value')
    const args: OscArg[] = values.map((value, i) => {
      const type = signatures[command][i] === 'i' ? 'i' : 'f'
      if (
        !Number.isFinite(value) ||
        (type === 'i' && (!Number.isInteger(value) || value < 0))
      )
        throw Error('Invalid plugin value')
      return { type, value }
    })
    // A track may release a retired slot while its Carla instance is being replaced.
    // Its queued events belong to that instance and must not reach the replacement.
    if (this.host.accepts(id)) this.host.send(id, command, args)
  }
  stop() {
    const task = this.changes.then(async () => {
      await this.host.stop()
      this.session = undefined
      this.structure = ''
    })
    this.changes = task.catch(() => undefined)
    return task
  }
}
