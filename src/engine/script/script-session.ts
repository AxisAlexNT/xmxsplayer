import type { ScriptStatus } from '../../shared/script-api'
import type { ScriptHost } from './script-host'
export async function scriptHash(source: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  )
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')
}
export class ScriptSession {
  private revision = 0
  private source?: string
  private disabled = false
  status: ScriptStatus = { hash: '', state: 'empty' }
  constructor(
    private host: ScriptHost,
    private reset: () => void,
    private report: (status: ScriptStatus) => void,
    private hash: (source: string) => Promise<string> = scriptHash,
  ) {}
  async update(
    source: string,
    trusted: readonly string[],
    force = false,
  ): Promise<void> {
    if (
      source === this.source &&
      !force &&
      (this.disabled ||
        this.status.state === 'empty' ||
        (trusted.includes(this.status.hash) &&
          ['running', 'error'].includes(this.status.state)))
    )
      return
    const revision = ++this.revision
    if (force || source !== this.source) this.disabled = false
    this.source = source
    this.host.clear()
    this.reset()
    if (!source.trim()) {
      this.set({ hash: '', state: 'empty' })
      return
    }
    this.set({ hash: '', state: 'checking' })
    try {
      const hash = await this.hash(source)
      if (revision !== this.revision) return
      if (this.disabled) this.set({ hash, state: 'disabled' })
      else if (!trusted.includes(hash)) this.set({ hash, state: 'untrusted' })
      else {
        const loaded = this.host.load(source)
        if (!loaded) this.reset()
        this.set({ hash, state: loaded ? 'running' : 'error' })
      }
    } catch (error) {
      if (revision !== this.revision) return
      this.host.error(error)
      this.set({ hash: '', state: 'error', error: String(error) })
    }
  }
  private set(status: ScriptStatus): void {
    this.status = status
    this.report(status)
  }
  suspend(): void {
    this.revision++
    this.host.clear()
    this.reset()
    this.set(
      this.disabled
        ? { hash: this.status.hash, state: 'disabled' }
        : { hash: '', state: 'checking' },
    )
  }
  stop(): void {
    this.revision++
    this.disabled = true
    this.host.clear()
    this.reset()
    this.set({ hash: this.status.hash, state: 'disabled' })
  }
  clear(): void {
    this.stop()
    this.source = undefined
    this.disabled = false
    this.set({ hash: '', state: 'empty' })
  }
}
