import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  net: { fetch: vi.fn(async () => new Response('stream')) },
}))
import { FileTokens } from '../../src/main/protocols'
const folders: string[] = []
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  )
})
it('issues revocable file capabilities only inside approved roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xmxs-token-'))
  folders.push(root)
  const outside = await mkdtemp(join(tmpdir(), 'xmxs-outside-'))
  folders.push(outside)
  const file = join(root, 'sound.wav')
  await writeFile(file, 'audio')
  const secret = join(outside, 'secret')
  await writeFile(secret, 'private')
  const tokens = new FileTokens()
  await expect(tokens.issue(secret, [root])).rejects.toThrow('outside approved')
  const url = new URL(await tokens.issue(file, [root]))
  expect((await tokens.fetch(url)).status).toBe(200)
  expect((await tokens.fetch(new URL('xmfile://f/unknown'))).status).toBe(403)
  await unlink(file)
  await symlink(secret, file)
  expect((await tokens.fetch(url)).status).toBe(403)
  tokens.clear()
  expect((await tokens.fetch(url)).status).toBe(403)
})
