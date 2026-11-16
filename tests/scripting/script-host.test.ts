import { expect, it } from 'vitest'
import { ScriptHost } from '../../src/engine/script/script-host'
import type { XmApi, KeyEvent } from '../../src/shared/script-api'
import type { LogEntry } from '../../src/shared/protocol'
const note: KeyEvent = {
  deviceId: 'keys',
  channel: 0,
  key: 60,
  vel: 100,
  on: true,
}
function rig(now?: () => number) {
  const logs: LogEntry[] = [],
    states: Record<string, unknown>[] = []
  const host = new ScriptHost(
    (on, state) => {
      states.push(state)
      return {
        on,
        state,
        log: (message: string) =>
          logs.push({ level: 'info', source: 'script', message }),
      } as unknown as XmApi
    },
    (entry) => logs.push(entry),
    now,
  )
  return { host, logs, states }
}
it('transpiles TypeScript, applies note chains and exposes named actions', () => {
  const { host, states } = rig()
  expect(
    host.load(`
const interval: number = 12;
xm.on('note', e => e.key === 61 ? null : [{ ...e, key: e.key + interval }, { ...e, key: e.key + 7 }]);
xm.on('note', e => ({ ...e, vel: 80 }));
function fill(): void { xm.state.fill = true }
xm.on('control', e => { xm.state.control = e.controlId });
`),
  ).toBe(true)
  expect(host.note(note).map((n) => [n.key, n.vel])).toEqual([
    [72, 80],
    [67, 80],
  ])
  expect(host.note({ ...note, key: 61 })).toEqual([])
  host.invoke('fill')
  host.emit('control', {
    id: 'pad.2',
    controlId: 'pad.2',
    deviceId: 'keys',
    value: 1,
    pressed: true,
    edge: 'press',
  })
  expect(states[0]).toEqual({ fill: true, control: 'pad.2' })
})
it('isolates thrown and invalid handlers, preserves a note on failure and reports source lines', () => {
  const { host, logs, states } = rig()
  host.load(`xm.on('note', e => { throw new Error('bad note') });
xm.on('note', e => ({ ...e, key: 999 }));
xm.on('control', e => { throw new Error('bad control') });
xm.on('control', e => { xm.state.survived = true });`)
  expect(host.note(note)).toEqual([note])
  host.emit('control', {
    id: 'pad.2',
    controlId: 'pad.2',
    deviceId: 'keys',
    value: 1,
    pressed: true,
    edge: 'press',
  })
  expect(states[0].survived).toBe(true)
  expect(logs.some((l) => l.message.includes('bad control (line 3)'))).toBe(
    true,
  )
  expect(logs.some((l) => l.message.includes('bad note (line 1)'))).toBe(true)
  expect(logs.some((l) => l.message.includes('Note handler:'))).toBe(true)
})
it('replaces hooks and state on reload, unsubscribes, bounds reentry and warns above 5 ms', () => {
  let time = 0
  const { host, logs, states } = rig(() => {
    time += 6
    return time
  })
  host.load(
    `const stop = xm.on('bar', e => { xm.state.old = true }); stop(); xm.on('note', e => ({ ...e, key: 72 }));`,
  )
  host.emit('bar', { bar: 1 })
  expect(states[0]).toEqual({})
  expect(
    logs.some((l) => l.level === 'warn' && l.message.includes('6.0 ms')),
  ).toBe(true)
  host.load(`xm.on('bar', e => { xm.state.bar = e.bar });`)
  host.emit('bar', { bar: 4 })
  expect(states[1]).toEqual({ bar: 4 })
  expect(host.note(note)).toEqual([note])
  host.clear()
  host.emit('bar', { bar: 8 })
  expect(states[1].bar).toBe(4)
  expect(host.running).toBe(false)
})
it('reports syntax and root failures and rejects expressions as named actions', () => {
  const { host, logs } = rig(() => 0)
  expect(host.load('const broken: = 1')).toBe(false)
  expect(host.running).toBe(false)
  expect(host.load("throw new Error('root')")).toBe(false)
  expect(logs.some((l) => l.message.includes('root (line 1)'))).toBe(true)
  host.load('function good() {}')
  host.invoke('good(); throw 1')
  expect(logs.at(-1)!.message).toContain('function name')
})
it('rejects async registration and catches promise-returning note hooks without losing the input', async () => {
  const { host, logs } = rig()
  expect(host.load(`xm.on('note', async e => e)`)).toBe(false)
  expect(
    host.load(`xm.on('note', e => Promise.reject(new Error('async failure')))`),
  ).toBe(true)
  expect(host.note(note)).toEqual([note])
  await Promise.resolve()
  expect(logs.some((l) => l.message.includes('async failure'))).toBe(true)
  expect(logs.some((l) => l.message.includes('must be synchronous'))).toBe(true)
})
