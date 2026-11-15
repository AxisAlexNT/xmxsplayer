import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'xmfile',
    privileges: {
      corsEnabled: true,
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])
export function inside(root: string, file: string): boolean {
  const rel = relative(root, file)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
export class FileTokens {
  private paths = new Map<string, string>()
  clear(): void {
    this.paths.clear()
  }
  async issue(file: string, roots: string[]): Promise<string> {
    const canonical = await realpath(file)
    const allowed = await Promise.all(
      roots.map(async (root) => {
        try {
          return await realpath(root)
        } catch {
          return null
        }
      }),
    )
    if (!allowed.some((root) => root !== null && inside(root, canonical)))
      throw new Error('File is outside approved folders')
    const token = randomUUID()
    this.paths.set(token, canonical)
    return `xmfile://f/${token}`
  }
  async fetch(url: URL): Promise<Response> {
    const file =
      url.host === 'f' ? this.paths.get(url.pathname.slice(1)) : undefined
    if (!file) return new Response('Forbidden', { status: 403 })
    // A replaced symlink must not expand the capability after issuance.
    try {
      if ((await realpath(file)) !== file)
        return new Response('Forbidden', { status: 403 })
    } catch {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).href)
  }
}
export const fileTokens = new FileTokens()
export function installProtocols(rendererRoot: string): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'xmxsplayer')
      return new Response('Forbidden', { status: 403 })
    const path = decodeURIComponent(url.pathname)
    if (path.split('/').includes('..'))
      return new Response('Forbidden', { status: 403 })
    if (process.env.ELECTRON_RENDERER_URL) {
      const response = await net.fetch(
        new URL(path + url.search, process.env.ELECTRON_RENDERER_URL).href,
      )
      if (!path.endsWith('.html')) return response
      const nonce = randomUUID()
      const html = (await response.text())
        .replaceAll('__XM_CSP_NONCE__', nonce)
        .replace(
          "connect-src 'self' xmfile:",
          "connect-src 'self' xmfile: ws://127.0.0.1:5173",
        )
        .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    const file = resolve(rendererRoot, `.${path}`)
    if (!inside(rendererRoot, file))
      return new Response('Forbidden', { status: 403 })
    try {
      const canonical = await realpath(file)
      if (!inside(rendererRoot, canonical))
        return new Response('Forbidden', { status: 403 })
      const response = await net.fetch(pathToFileURL(canonical).href)
      if (!path.endsWith('.html')) return response
      const nonce = randomUUID()
      const html = (await response.text())
        .replaceAll('__XM_CSP_NONCE__', nonce)
        .replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`)
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  protocol.handle('xmfile', async (request) => {
    const response = await fileTokens.fetch(new URL(request.url))
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', 'app://xmxsplayer')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  })
}
