import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  fluidArgs,
  fluidInteger,
  fluidLoad,
  parseFluidFont,
  parseFluidPresets,
  validateFluidLine,
  type FluidConfig,
  type FluidEvent,
  type FluidPreset,
} from '../shared/fluid'

export function fluidCandidates(
  configured = '',
  platform = process.platform,
  env = process.env,
): string[] {
  if (configured.trim()) return [configured.trim()]
  const filename = platform === 'win32' ? 'fluidsynth.exe' : 'fluidsynth'
  return [
    ...new Set(
      (env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, filename)),
    ),
  ]
}
export async function testFluid(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, ['-n', '-a', 'file', '-V'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = '',
      timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 5000)
    const read = (data: Buffer): void => {
      output = (output + data.toString()).slice(-8192)
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      const version =
        /FluidSynth (?:executable|runtime) version ([\d.]+)/i.exec(output)?.[1]
      if (timedOut) reject(Error('FluidSynth version check timed out'))
      else if (code !== 0 || !version)
        reject(
          Error(
            `FluidSynth test failed: ${output.trim().slice(-1000) || code}`,
          ),
        )
      else resolve(version)
    })
  })
}
export async function detectFluid(
  configured = '',
): Promise<{ path: string; version: string }> {
  const errors: string[] = []
  for (const path of fluidCandidates(configured)) {
    try {
      await access(
        path,
        process.platform === 'win32' ? constants.F_OK : constants.X_OK,
      )
      return { path, version: await testFluid(path) }
    } catch (error) {
      if (configured.trim()) errors.push(String(error))
    }
  }
  throw Error(
    `FluidSynth executable not found or unusable${errors.length ? ': ' + errors.join('; ') : '; set its path in Audio settings'}`,
  )
}

interface Exchange {
  marker: string
  response: string
  timer: ReturnType<typeof setTimeout>
  resolve(value: string): void
  reject(error: Error): void
}
export class FluidSynthProcess {
  private child?: ChildProcessWithoutNullStreams
  private options?: FluidConfig
  private ready = false
  private wanted = false
  private generation = 0
  private attempts = 0
  private startedAt = 0
  private restartTimer?: ReturnType<typeof setTimeout>
  private pending?: Exchange
  private input = ''
  private lifecycle = Promise.resolve<unknown>(undefined)
  private queries = Promise.resolve<unknown>(undefined)
  private intentional = new WeakSet<ChildProcessWithoutNullStreams>()
  constructor(
    private readonly emit: (event: FluidEvent) => void = () => undefined,
  ) {}
  private control<T>(work: () => Promise<T>): Promise<T> {
    const task = this.lifecycle.then(work)
    this.lifecycle = task.catch(() => undefined)
    return task
  }
  start(config: FluidConfig): Promise<{ generation: number }> {
    return this.control(async () => {
      fluidArgs(config)
      if (this.ready && JSON.stringify(config) === JSON.stringify(this.options))
        return { generation: this.generation }
      this.wanted = false
      clearTimeout(this.restartTimer)
      await this.closeChild()
      this.options = structuredClone(config)
      this.wanted = true
      this.attempts = 0
      await this.launch()
      return { generation: this.generation }
    })
  }
  private async launch(): Promise<void> {
    const config = this.options!
    const { path } = await detectFluid(config.path)
    if (!this.wanted) throw Error('FluidSynth start cancelled')
    const child = spawn(path, fluidArgs(config), {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.ready = false
    this.input = ''
    this.startedAt = Date.now()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      if (child === this.child) this.stdout(data)
    })
    child.stderr.on('data', (data: string) =>
      this.emit({ type: 'log', message: data.trim().slice(-4096) }),
    )
    child.stdin.on('error', (error) => {
      if (child === this.child) this.fail(error)
    })
    child.once('error', (error) => {
      if (child === this.child) this.fail(error)
    })
    child.once('close', (code) => {
      if (child !== this.child) return
      this.child = undefined
      this.ready = false
      this.fail(Error(`FluidSynth exited (${code ?? 'signal'})`))
      const restart = this.wanted && !this.intentional.has(child)
      if (Date.now() - this.startedAt > 30000) this.attempts = 0
      const retry = restart && this.attempts < 5
      this.emit({ type: 'exit', code, restarting: retry })
      if (retry) {
        const delay = Math.min(8000, 250 * 2 ** this.attempts++)
        this.restartTimer = setTimeout(() => {
          if (!this.wanted) return
          void this.control(async () => {
            if (!this.wanted || this.child) return
            try {
              await this.launch()
            } catch (error) {
              this.emit({ type: 'log', message: String(error) })
            }
          })
        }, delay)
      }
    })
    await this.exchange('echo xmxsplayer-ready')
    if (child !== this.child || !this.wanted)
      throw Error('FluidSynth start cancelled')
    this.ready = true
    this.generation++
    this.emit({ type: 'ready', generation: this.generation })
  }
  private stdout(data: string): void {
    this.input += data
    if (this.input.length > 1024 * 1024) {
      this.abort(Error('FluidSynth output exceeded 1 MiB'))
      return
    }
    let end: number
    while ((end = this.input.indexOf('\n')) >= 0) {
      const line = this.input.slice(0, end).replace(/\r$/, '')
      this.input = this.input.slice(end + 1)
      const task = this.pending
      if (!task) continue
      if (line.trim() === task.marker) {
        clearTimeout(task.timer)
        this.pending = undefined
        task.resolve(task.response)
      } else {
        task.response += line + '\n'
        if (task.response.length > 1024 * 1024) {
          this.abort(Error('FluidSynth reply exceeded 1 MiB'))
          return
        }
      }
    }
  }
  private exchange(command: string): Promise<string> {
    const child = this.child
    if (!child || child.killed || !child.stdin.writable)
      return Promise.reject(Error('FluidSynth is not running'))
    if (this.pending)
      return Promise.reject(Error('FluidSynth request already pending'))
    return new Promise((resolve, reject) => {
      const marker = `xm-fluid-${randomUUID()}`
      const timer = setTimeout(
        () => this.abort(Error('FluidSynth reply timed out after 15 seconds')),
        15000,
      )
      this.pending = { marker, response: '', timer, resolve, reject }
      child.stdin.write(`${command}\necho ${marker}\n`, (error) => {
        if (error) this.abort(error)
      })
    })
  }
  private query(command: string): Promise<string> {
    const task = this.queries.then(() => {
      if (!this.ready) throw Error('FluidSynth is not ready')
      return this.exchange(command)
    })
    this.queries = task.catch(() => undefined)
    return task
  }
  async load(path: string): Promise<number> {
    return parseFluidFont(await this.query(fluidLoad(path)))
  }
  async presets(font: number): Promise<FluidPreset[]> {
    return parseFluidPresets(
      await this.query(`inst ${fluidInteger(font, 2147483647)}`),
    )
  }
  async unload(font: number): Promise<void> {
    await this.query(`unload ${fluidInteger(font, 2147483647)} 0`)
  }
  send(lines: string[]): void {
    if (!Array.isArray(lines) || lines.length > 256)
      throw Error('FluidSynth batch exceeds 256 commands')
    for (const line of lines) validateFluidLine(line)
    if (!lines.length) return
    if (!this.ready || !this.child?.stdin.writable)
      throw Error('FluidSynth is not ready')
    if (this.child.stdin.writableLength > 1024 * 1024)
      throw Error('FluidSynth command queue exceeded 1 MiB')
    this.child.stdin.write(lines.join('\n') + '\n', (error) => {
      if (error) this.abort(error)
    })
  }
  private fail(error: Error): void {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = undefined
  }
  private abort(error: Error): void {
    this.fail(error)
    this.child?.kill('SIGKILL')
  }
  private async closeChild(): Promise<void> {
    this.ready = false
    const child = this.child
    if (!child) return
    this.intentional.add(child)
    this.fail(Error('FluidSynth stopped'))
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 1500)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      if (child.stdin.writable && !child.killed)
        child.stdin.end('reset\nquit\n')
      else child.kill('SIGKILL')
    })
  }
  stop(): Promise<void> {
    this.wanted = false
    clearTimeout(this.restartTimer)
    return this.control(() => this.closeChild())
  }
}
