import { uniqueId } from '../../shared/ids'
import type {
  Action,
  Project,
  Setup,
  Timing,
  TrackMode,
  Zone,
} from '../../shared/model'
import type { ConditionContext } from '../../shared/conditions'
import { matchesCondition } from '../../shared/conditions'
import { effectiveSetup } from '../../shared/overlay'
import { Registers } from './registers'

export interface SceneHost {
  queue(at: Timing, run: () => void): number
  activated?(id: string | null): void
  changed(): void
  context(): Pick<ConditionContext, 'bar' | 'playing'>
}
export class Scenes {
  readonly registers = new Registers()
  activeId: string | null = null
  private project?: Project
  private modes: Record<string, TrackMode> = {}
  private scriptModes: Record<string, TrackMode> = {}
  private scriptZones?: Zone[]
  private scriptPatch = new Map<string, string[]>()
  private scriptFollow?: Project['follow']['mode']
  private manualFollow?: Project['follow']['mode']
  clearScript(notify = true): void {
    this.scriptModes = {}
    this.scriptZones = undefined
    this.scriptPatch.clear()
    this.scriptFollow = undefined
    if (notify) this.host.changed()
  }
  get hasScriptZones(): boolean {
    return this.scriptZones !== undefined
  }
  setScriptMode(trackId: string, mode: TrackMode): void {
    this.scriptModes[trackId] = mode
    this.host.changed()
  }
  setZones(zones: Zone[]): void {
    this.scriptZones = zones
    this.host.changed()
  }
  setPatch(trackId: string, instrumentIds: string[]): void {
    this.scriptPatch.set(trackId, instrumentIds)
    this.host.changed()
  }
  setFollow(
    mode: Project['follow']['mode'],
    owner: 'script' | 'action' = 'script',
  ): void {
    if (owner === 'action') {
      this.manualFollow = mode
      this.scriptFollow = undefined
    } else this.scriptFollow = mode
    this.host.changed()
  }
  constructor(private host: SceneHost) {}
  configure(project: Project): void {
    if (this.project && this.project.follow.mode !== project.follow.mode) {
      this.scriptFollow = undefined
      this.manualFollow = undefined
    }
    const previous = this.project
      ? effectiveSetup(this.project, this.activeId)
      : undefined
    const next = effectiveSetup(project, this.activeId)
    for (const id of Object.keys(this.modes)) {
      const oldTrack = this.project?.tracks.find((t) => t.id === id)
      const track = project.tracks.find((t) => t.id === id)
      if (
        !track ||
        (previous?.trackModes[id] ?? oldTrack?.mode) !==
          (next.trackModes[id] ?? track.mode)
      )
        delete this.modes[id]
    }
    this.project = project
    this.registers.configure(project.registers)
    if (!project.scenes.some((scene) => scene.id === this.activeId))
      this.activeId = null
  }
  activate(id: string | null, at: Timing = 'now'): number {
    if (id !== null && !this.project?.scenes.some((s) => s.id === id)) return 0
    return this.host.queue(at, () => {
      const scene = this.project?.scenes.find((s) => s.id === id)
      if (id !== null && !scene) return
      this.activeId = id
      this.clearScript(false)
      this.modes = {}
      if (scene?.registers) this.registers.preset(scene.registers)
      this.host.changed()
      this.host.activated?.(id)
    })
  }
  run(action: Extract<Action, { type: 'scene' }>, at: Timing = 'now'): number {
    if (action.cmd === 'clear') return this.activate(null, at)
    if (action.cmd === 'activate')
      return action.sceneId ? this.activate(action.sceneId, at) : 0
    const scenes = this.project?.scenes ?? []
    if (!scenes.length) return 0
    const index = scenes.findIndex((s) => s.id === this.activeId)
    const target =
      index < 0
        ? action.cmd === 'prev'
          ? scenes.length - 1
          : 0
        : (index + (action.cmd === 'next' ? 1 : -1) + scenes.length) %
          scenes.length
    return this.activate(scenes[target].id, at)
  }
  register(
    action: Extract<Action, { type: 'register' }>,
    source: string,
    pressed = true,
  ): void {
    if (action.cmd === 'momentary')
      this.registers.momentary(action.index, source, pressed)
    else if (action.cmd === 'set')
      this.registers.set(action.index, action.on ?? true)
    else this.registers.toggle(action.index)
    this.host.changed()
  }
  mode(action: Extract<Action, { type: 'trackMode' }>): void {
    const track = this.project?.tracks.find((t) => t.id === action.trackId)
    if (!track) return
    const current = this.setup([], false)!.trackModes[track.id] ?? track.mode
    const next =
      action.mode === 'cycle'
        ? track.kind === 'audio'
          ? current === 'auto'
            ? 'mute'
            : 'auto'
          : ({ auto: 'live', live: 'mute', mute: 'auto' } as const)[current]
        : action.mode
    if (track.kind === 'audio' && next === 'live') return
    this.modes[track.id] = next
    this.host.changed()
  }
  get context(): ConditionContext {
    return {
      ...this.host.context(),
      activeSceneId: this.activeId,
      registers: this.registers.values,
    }
  }
  setup(
    profileIds: readonly string[] = [],
    filterPatch = true,
  ): Setup | undefined {
    if (!this.project) return undefined
    const setup = effectiveSetup(this.project, this.activeId, profileIds)
    setup.trackModes = {
      ...setup.trackModes,
      ...this.modes,
      ...this.scriptModes,
    }
    if (this.scriptZones) setup.zones = this.scriptZones
    for (const [trackId, instrumentIds] of this.scriptPatch) {
      setup.patch = setup.patch.filter((p) => p.trackId !== trackId)
      const ids = setup.patch.map((p) => p.id)
      for (const instrumentId of instrumentIds) {
        const id = uniqueId(`script-${trackId}-${instrumentId}`, ids)
        ids.push(id)
        setup.patch.push({ id, trackId, instrumentId })
      }
    }
    if (!filterPatch) return setup
    return {
      ...setup,
      patch: setup.patch
        .filter((p) => matchesCondition(p.when, this.context))
        .map((connection) => {
          const patch = { ...connection }
          delete patch.when
          return patch
        }),
    }
  }
  effectiveProject(
    profileIds: readonly string[] = [],
    filterPatch = true,
  ): Project | undefined {
    const setup = this.setup(profileIds, filterPatch)
    if (!setup || !this.project) return undefined
    return {
      ...this.project,
      base: setup,
      follow: {
        ...this.project.follow,
        ...((this.scriptFollow ?? this.manualFollow)
          ? { mode: this.scriptFollow ?? this.manualFollow }
          : {}),
      },
      tracks: this.project.tracks.map((track) => ({
        ...track,
        mode: setup.trackModes[track.id] ?? track.mode,
      })),
    }
  }
  reset(notify = true): void {
    this.activeId = null
    this.clearScript(false)
    this.modes = {}
    this.registers.reset()
    if (notify) this.host.changed()
  }
}
