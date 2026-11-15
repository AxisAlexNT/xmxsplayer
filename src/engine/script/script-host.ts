import { transform } from 'sucrase'
import type { KeyEvent, ScriptEvents, XmApi } from '../../shared/script-api'
import type { LogEntry } from '../../shared/protocol'

type Handler = (event: never) => unknown
export function scriptError(error: unknown, fallbackLine?: number): string {
  const value = error as {
    message?: string
    stack?: string
    loc?: { line: number }
  }
  const match = value?.stack?.match(/xmxs-project-script\.js:(\d+):(\d+)/)
  const line =
    value?.loc?.line ??
    (match ? Math.max(1, Number(match[1]) - 2) : fallbackLine)
  return `${value?.message ?? String(error)}${line ? ` (line ${line})` : ''}`
}
export class ScriptHost {
  private handlers = new Map<keyof ScriptEvents, Set<Handler>>()
  private emitting = new Set<string>()
  private origins = new WeakMap<Handler, number>()
  private resolve?: (name: string) => unknown
  private enabled = false
  private api?: XmApi
  private generation = 0
  constructor(
    private createApi: (
      on: XmApi['on'],
      state: Record<string, unknown>,
      active: () => boolean,
    ) => XmApi,
    private log: (entry: LogEntry) => void,
    private now: () => number = () => performance.now(),
  ) {}
  has(event: keyof ScriptEvents): boolean {
    return !!this.handlers.get(event)?.size
  }
  get running(): boolean {
    return this.enabled
  }
  clear(): void {
    this.generation++
    this.enabled = false
    this.handlers.clear()
    this.resolve = undefined
    this.api = undefined
  }
  load(source: string): boolean {
    this.clear()
    const generation = this.generation
    const on = ((event: keyof ScriptEvents, handler: Handler) => {
      if (!this.enabled || generation !== this.generation)
        return () => undefined
      if (
        ![
          'note',
          'control',
          'beat',
          'bar',
          'cue',
          'scene',
          'transport',
        ].includes(event) ||
        typeof handler !== 'function' ||
        handler.constructor?.name === 'AsyncFunction'
      )
        throw new Error(
          'xm.on: choose a supported event and a synchronous function',
        )
      const origin = scriptError(new Error()).match(/\(line (\d+)\)/)
      if (origin) this.origins.set(handler, Number(origin[1]))
      const handlers = this.handlers.get(event) ?? new Set<Handler>()
      handlers.add(handler)
      this.handlers.set(event, handlers)
      return () => {
        handlers.delete(handler)
      }
    }) as XmApi['on']
    try {
      const js = transform(source, {
        transforms: ['typescript'],
        filePath: 'script.ts',
      }).code
      const compile = new Function(
        'xm',
        `${js}\n;return name => eval(name);\n//# sourceURL=xmxs-project-script.js`,
      )
      this.enabled = true
      this.api = this.createApi(
        on,
        {},
        () => this.enabled && generation === this.generation,
      )
      const result = this.call('initialise', () => compile(this.api))
      if (!result.ok) {
        this.clear()
        return false
      }
      this.resolve =
        typeof result.value === 'function'
          ? (result.value as (name: string) => unknown)
          : undefined
      return true
    } catch (error) {
      this.error(error)
      this.clear()
      return false
    }
  }
  error(error: unknown, line?: number): void {
    this.log({
      level: 'error',
      source: 'script',
      message: scriptError(error, line),
    })
  }
  private call(
    label: string,
    fn: () => unknown,
    line?: number,
  ): { ok: boolean; value?: unknown } {
    const start = this.now()
    try {
      const value = fn()
      if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(value).catch((error) => this.error(error))
        throw new Error(`${label}: handlers must be synchronous`)
      }
      return { ok: true, value }
    } catch (error) {
      this.error(error, line)
      return { ok: false }
    } finally {
      const elapsed = this.now() - start
      if (elapsed > 5)
        this.log({
          level: 'warn',
          source: 'script',
          message: `${label} took ${elapsed.toFixed(1)} ms${line ? ` (line ${line})` : ''}`,
        })
    }
  }
  emit<K extends Exclude<keyof ScriptEvents, 'note'>>(
    event: K,
    payload: ScriptEvents[K],
  ): void {
    if (!this.enabled || this.emitting.has(event)) return
    this.emitting.add(event)
    try {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        if (!this.enabled) break
        this.call(
          `Handler ${event}`,
          () => handler({ ...payload } as never),
          this.origins.get(handler),
        )
      }
    } finally {
      this.emitting.delete(event)
    }
  }
  note(event: KeyEvent): KeyEvent[] {
    let notes = [{ ...event }]
    if (!this.enabled || this.emitting.has('note')) return notes
    this.emitting.add('note')
    try {
      for (const handler of [...(this.handlers.get('note') ?? [])]) {
        notes = notes.flatMap((note) => {
          const result = this.call(
            'Handler note',
            () => {
              const value = handler({ ...note } as never)
              if (
                value &&
                typeof (value as PromiseLike<unknown>).then === 'function'
              ) {
                void Promise.resolve(value).catch((error) => this.error(error))
                throw new Error('Note handlers must be synchronous')
              }
              const output =
                value === null ? [] : Array.isArray(value) ? value : [value]
              if (
                output.length > 128 ||
                output.some(
                  (n) =>
                    !n ||
                    !Number.isInteger(n.key) ||
                    n.key < 0 ||
                    n.key > 127 ||
                    !Number.isInteger(n.vel) ||
                    n.vel < 0 ||
                    n.vel > 127 ||
                    n.on !== event.on ||
                    n.channel !== event.channel ||
                    n.deviceId !== event.deviceId,
                )
              )
                throw new Error(
                  'Note handler: return an event, up to 128 events, or null; change key and vel only',
                )
              return output.map((n) => ({ ...note, key: n.key, vel: n.vel }))
            },
            this.origins.get(handler),
          )
          return result.ok ? (result.value as KeyEvent[]) : [note]
        })
        if (notes.length > 128) {
          this.error(new Error('Note handlers produced more than 128 notes'))
          return [event]
        }
      }
      return notes
    } finally {
      this.emitting.delete('note')
    }
  }
  invoke(name: string): void {
    if (!this.enabled) return
    this.call(`Function ${name}`, () => {
      if (!/^[A-Za-z_$][\w$]*$/.test(name))
        throw new Error('Script function: enter a function name')
      const fn = this.resolve?.(name)
      if (typeof fn !== 'function')
        throw new Error(`Script function ${name} is not defined`)
      return fn()
    })
  }
}
