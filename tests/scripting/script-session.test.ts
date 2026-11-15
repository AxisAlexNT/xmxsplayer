import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import {
  ScriptSession,
  scriptHash,
} from '../../src/engine/script/script-session'
import { ScriptHost } from '../../src/engine/script/script-host'
import type { XmApi, ScriptStatus } from '../../src/shared/script-api'
function rig(hash = scriptHash) {
  const ran = vi.fn(),
    reset = vi.fn(),
    reports: ScriptStatus[] = []
  const host = new ScriptHost(
    (on, state) => ({ on, state, log: ran }) as unknown as XmApi,
    () => undefined,
  )
  const session = new ScriptSession(
    host,
    reset,
    (status) => reports.push(status),
    hash,
  )
  return { session, host, ran, reset, reports }
}
it('hashes exact UTF-8 bytes and never compiles an untrusted script', async () => {
  const source = 'xm.log("reprise ♫")',
    hash = await scriptHash(source)
  expect(hash).toBe(createHash('sha256').update(source).digest('hex'))
  const { session, host, ran } = rig()
  const load = vi.spyOn(host, 'load')
  await session.update(source, [])
  expect(session.status).toEqual({ hash, state: 'untrusted' })
  expect(load).not.toHaveBeenCalled()
  expect(ran).not.toHaveBeenCalled()
  await session.update(source, [hash])
  expect(session.status.state).toBe('running')
  expect(ran).toHaveBeenCalledWith('reprise ♫')
  await session.update(source, [hash])
  expect(load).toHaveBeenCalledTimes(1)
  await session.update(source + '\n', [hash])
  expect(session.status.state).toBe('untrusted')
  expect(host.running).toBe(false)
})
it('ignores stale hash results after source changes or project close', async () => {
  const finish = new Map<string, (hash: string) => void>()
  const { session, ran } = rig(
    (source) =>
      new Promise((resolve) => {
        finish.set(source, resolve)
      }),
  )
  const a = session.update('xm.log("a")', ['a'])
  const b = session.update('xm.log("b")', ['b'])
  finish.get('xm.log("a")')!('a')
  await a
  expect(ran).not.toHaveBeenCalled()
  session.clear()
  finish.get('xm.log("b")')!('b')
  await b
  expect(session.status.state).toBe('empty')
  expect(ran).not.toHaveBeenCalled()
})
it('revokes trust, preserves Disable across unrelated updates and supports explicit Apply', async () => {
  const { session, ran } = rig(),
    source = 'xm.log("run")',
    hash = await scriptHash(source)
  await session.update(source, [hash])
  session.stop()
  await session.update(source, [hash])
  expect(session.status.state).toBe('disabled')
  expect(ran).toHaveBeenCalledTimes(1)
  await session.update(source, [hash], true)
  expect(session.status.state).toBe('running')
  await session.update(source, [])
  expect(session.status.state).toBe('untrusted')
})
it('keeps an explicit Disable visible when trust settings change', async () => {
  const { session, host } = rig(),
    source = 'xm.log("run")',
    hash = await scriptHash(source)
  await session.update(source, [hash])
  session.stop()
  session.suspend()
  await session.update(source, [hash, 'another-version'])
  expect(session.status.state).toBe('disabled')
  expect(host.running).toBe(false)
})
