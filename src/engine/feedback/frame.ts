import { registerColor } from '../../shared/register-colors'
import type { Action, DeviceProfile, Project, Setup } from '../../shared/model'
import type { RuntimeState } from '../../shared/protocol'
import type { ControlFeedback } from '../../shared/feedback'
import { matchesCondition } from '../../shared/conditions'
import { effectiveSetup, isUnbound } from '../../shared/overlay'
import { TimeMap } from '../../shared/time-map'
const blue = '#4cc2ff',
  amber = '#ffb020',
  green = '#3ddc97',
  red = '#ff6b6b',
  grey = '#94a3b8'
export interface FeedbackState {
  project: Project
  runtime: RuntimeState
  playing: boolean
  recording: boolean
  holding: boolean
  tick: number
  rate: number
}
export interface FrameOptions {
  time: number
  blink: boolean
  beat?: number
  flashes?: ReadonlyMap<string, number>
  queued?: ReadonlySet<string>
}
export function mergeFeedback(
  ...layers: readonly (ControlFeedback | undefined)[]
): ControlFeedback {
  let value: ControlFeedback = { color: grey, level: 0, state: 'off' }
  for (const layer of layers) if (layer) value = layer
  return value
}
function bindingState(
  action: Action,
  p: Project,
  s: FeedbackState,
  setup: Setup,
): { color: string; on: boolean; queued?: boolean } {
  if (action.type === 'register') {
    return {
      color: registerColor(p, action.index),
      on: !!s.runtime.registers[action.index],
    }
  }
  if (action.type === 'transport')
    return {
      color:
        action.cmd === 'record'
          ? red
          : action.cmd === 'toggle' || action.cmd === 'play'
            ? green
            : blue,
      on:
        action.cmd === 'record'
          ? s.recording
          : action.cmd === 'loopToggle'
            ? p.loop.enabled
            : action.cmd === 'metronome'
              ? p.metronome.audible
              : action.cmd === 'toggle' || action.cmd === 'play'
                ? s.playing
                : action.cmd === 'stop' || action.cmd === 'pause'
                  ? !s.playing
                  : false,
    }
  if (action.type === 'trackMode') {
    const track = p.tracks.find((t) => t.id === action.trackId),
      mode =
        s.runtime.trackModes?.[action.trackId] ??
        setup.trackModes[action.trackId] ??
        track?.mode
    return {
      color: mode === 'live' ? '#ff9f43' : mode === 'auto' ? green : grey,
      on: action.mode === 'cycle' ? mode !== 'mute' : mode === action.mode,
    }
  }
  if (action.type === 'scene')
    return {
      color: p.scenes.find((c) => c.id === action.sceneId)?.color ?? blue,
      on:
        action.cmd === 'activate' && s.runtime.activeSceneId === action.sceneId,
    }
  if (action.type === 'clip') {
    const clip = p.clips.find((c) => c.id === action.clipId),
      state = clip ? s.runtime.clips[clip.id] : undefined
    return {
      color: clip?.color ?? blue,
      on: state === 'playing',
      queued: state === 'queued',
    }
  }
  if (action.type === 'note')
    return {
      color: p.tracks.find((t) => t.id === action.trackId)?.color ?? blue,
      on: false,
    }
  return { color: blue, on: false }
}
export function controlFrame(
  profile: DeviceProfile,
  state: FeedbackState,
  options: FrameOptions,
): Record<string, ControlFeedback> {
  const p = state.project,
    setup = effectiveSetup(p, state.runtime.activeSceneId, [profile.id]),
    map = new TimeMap(p),
    pos = map.tickToBarBeat(state.tick),
    context = {
      registers: state.runtime.registers,
      activeSceneId: state.runtime.activeSceneId,
      bar: pos.bar,
      playing: state.playing,
    },
    result: Record<string, ControlFeedback> = {}
  for (const control of profile.controls) {
    const binding = setup.bindings.find(
        (b) =>
          b.control === control.id &&
          b.edge === (control.mode === 'momentary' ? 'press' : 'change'),
      ),
      bound = !isUnbound(binding) && !!binding,
      active =
        bound && matchesCondition(binding!.when, context)
          ? bindingState(binding!.action, p, state, setup)
          : undefined,
      color = setup.padColors[control.id] ?? active?.color ?? blue,
      base: ControlFeedback = {
        color,
        level: bound || setup.padColors[control.id] ? 0.2 : 0,
        state: bound || setup.padColors[control.id] ? 'idle' : 'off',
      },
      bindingLayer: ControlFeedback | undefined = active?.on
        ? {
            color: setup.padColors[control.id] ?? active.color,
            level: 1,
            state: 'on',
          }
        : undefined
    let beat: ControlFeedback | undefined
    const match =
        control.kind === 'pad' ? /^pad\.(\d+)$/.exec(control.id) : null,
      n = match ? Number(match[1]) : 0,
      inRow =
        n >= 1 &&
        n <= 8 &&
        (setup.beatChase === 'all' ||
          (setup.beatChase === 'top' && n <= 4) ||
          (setup.beatChase === 'bottom' && n > 4))
    if (p.metronome.visualPads && state.playing && !state.holding && inRow) {
      const row = setup.beatChase === 'all' ? 8 : 4,
        index = ((Math.max(1, options.beat ?? pos.beat) - 1) % row) + 1,
        current = (setup.beatChase === 'bottom' ? n - 4 : n) === index
      beat =
        current && options.beat !== undefined
          ? { color: options.beat === 1 ? amber : blue, level: 1, state: 'on' }
          : active?.on
            ? undefined
            : { color, level: Math.max(0.08, base.level), state: 'idle' }
    }
    const flash =
        (options.flashes?.get(control.id) ?? 0) > options.time
          ? { color: '#d8f3ff', level: 1, state: 'on' as const }
          : undefined,
      armed = state.runtime.armedCueId
        ? p.cues.find((c) => c.id === state.runtime.armedCueId)?.control ===
          control.id
        : false,
      pending =
        p.cues.some(
          (c) =>
            c.control === control.id &&
            state.runtime.queuedCueIds?.includes(c.id),
        ) ||
        options.queued?.has(control.id) ||
        active?.queued ||
        (bound &&
          state.runtime.pendingActions.some(
            (a) => JSON.stringify(a.action) === JSON.stringify(binding!.action),
          )),
      queued =
        armed || pending
          ? {
              color: amber,
              level: options.blink ? 1 : 0.12,
              state: 'queued' as const,
            }
          : undefined
    result[control.id] = mergeFeedback(base, bindingLayer, beat, flash, queued)
  }
  return result
}
export function screenLines(state: FeedbackState): [string, string] {
  const p = state.project,
    pos = new TimeMap(p).tickToBarBeat(state.tick),
    name =
      p.scenes.find((s) => s.id === state.runtime.activeSceneId)?.name ??
      p.name,
    follow = state.holding
      ? 'Hold'
      : p.follow.mode === 'written'
        ? 'Written'
        : p.follow.mode === 'waitNotes'
          ? 'Wait'
          : 'Track'
  return [
    name,
    `${pos.bar}.${pos.beat} ${Math.round(state.rate * 100)}% ${follow}`,
  ]
}
