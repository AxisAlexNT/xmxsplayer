import { randomInt } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createSocket } from 'node:dgram'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWrite, confined } from './project-io'
import { decodeOsc, encodeOsc, type OscArg } from './osc'
import type { DiscoveredPlugin } from '../shared/plugins'

export interface SessionPlugin {
  id: string
  plugin: DiscoveredPlugin
  program?: number
  parameters?: { index: number; value: number }[]
}
export interface SessionConnection {
  source: string
  target: string
}
export interface PluginSession {
  plugins: SessionPlugin[]
  connections: SessionConnection[]
}
const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
export function sessionXml(session: PluginSession): string {
  const nodes = session.plugins.map(({ id, plugin, program, parameters }) => {
    const identity =
      plugin.format === 'lv2'
        ? `<URI>${escapeXml(plugin.uri)}</URI>`
        : `<Binary>${escapeXml(plugin.file)}</Binary><Label>${escapeXml(plugin.uri)}</Label><UniqueID>${plugin.uniqueId}</UniqueID>`
    const settings = (parameters ?? []).map(({ index, value }) => {
      if (!Number.isInteger(index) || index < 0 || !Number.isFinite(value))
        throw Error('Invalid plugin parameter')
      return `<Parameter><Index>${index}</Index><Value>${value}</Value></Parameter>`
    })
    if (program !== undefined) {
      if (!Number.isInteger(program) || program < 0)
        throw Error('Invalid plugin program')
      settings.push(`<CurrentProgramIndex>${program + 1}</CurrentProgramIndex>`)
    }
    return ` <Plugin><Info><Type>${plugin.format.toUpperCase()}</Type><Name>${escapeXml(id)}</Name>${identity}</Info><Data><Active>Yes</Active><ControlChannel>1</ControlChannel>${settings.join('')}</Data></Plugin>`
  })
  const connections = session.connections.map(
    ({ source, target }) =>
      `  <Connection><Source>${escapeXml(source)}</Source><Target>${escapeXml(target)}</Target></Connection>`,
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE CARLA-PROJECT>',
    '<CARLA-PROJECT VERSION="2.5">',
    ...nodes,
    ' <Patchbay>',
    ...connections,
    ' </Patchbay>',
    '</CARLA-PROJECT>',
    '',
  ].join('\n')
}

export async function detectCarla(configured = ''): Promise<string> {
  if (process.platform !== 'linux')
    throw Error('Plugin hosting currently requires Linux')
  const paths = configured
    ? [configured]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, 'carla'))
  for (const path of paths) {
    try {
      await access(path, constants.X_OK)
      return path
    } catch {
      /* Try the next directory. */
    }
  }
  throw Error('Carla was not found. Choose its executable in plugin settings.')
}
// Carla 2.5.8 accepts automatically allocated ports, but an explicitly configured
// port above 32767 disables OSC. Probe within its supported range.
async function availableControlPort(): Promise<number> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const reservation = createSocket('udp4')
    try {
      const port = randomInt(16384, 32768)
      await new Promise<void>((resolve, reject) => {
        reservation.once('error', reject)
        reservation.bind(port, '0.0.0.0', resolve)
      })
      return port
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    } finally {
      reservation.close()
    }
  }
  throw Error('No free Carla OSC control port')
}

type HostEvent = {
  status: 'starting' | 'ready' | 'stopped' | 'error'
  message?: string
}
interface Request {
  folder: string
  session: PluginSession
  executable: string
  signature: string
}
export interface PluginLevels {
  id: string
  left: number
  right: number
}
export class PluginHost {
  private child?: ChildProcess
  private sock?: ReturnType<typeof createSocket>
  private port = 0
  private configDir = ''
  private ready = false
  private wanted?: Request
  private attempts = 0
  private retry?: ReturnType<typeof setTimeout>
  private tasks: Promise<unknown> = Promise.resolve()
  constructor(
    private emit: (event: HostEvent) => void,
    private driver: 'JACK' | 'SDL' = 'JACK',
    private levels: (frame: PluginLevels) => void = () => undefined,
  ) {}
  private queue<T>(task: () => Promise<T>) {
    const result = this.tasks.then(task)
    this.tasks = result.catch(() => undefined)
    return result
  }
  configure(
    folder: string,
    session: PluginSession,
    executable = '',
  ): Promise<void> {
    return this.queue(async () => {
      const signature = JSON.stringify([folder, session, executable])
      if (this.ready && this.wanted?.signature === signature) return
      this.wanted = undefined
      await this.close()
      if (!session.plugins.length) return
      this.wanted = { folder, session, executable, signature }
      this.attempts = 0
      try {
        await this.launch(this.wanted)
      } catch (error) {
        this.wanted = undefined
        await this.close()
        throw error
      }
    })
  }
  private async launch(request: Request): Promise<void> {
    const executable = await detectCarla(request.executable)
    const dir = await confined(request.folder, '.xmxs/carla')
    await mkdir(dir, { recursive: true })
    const path = await confined(request.folder, '.xmxs/carla/session.carxp')
    await atomicWrite(path, sessionXml(request.session))
    const socket = createSocket('udp4')
    this.sock = socket
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', resolve)
    })
    let confirmOsc: (() => void) | undefined
    socket.on('message', (packet, peer) => {
      if (peer.address !== '127.0.0.1' || this.wanted !== request) return
      if (
        packet.subarray(0, 14).equals(Buffer.from('/ctrl/runtime\0')) ||
        packet.subarray(0, 12).equals(Buffer.from('/ctrl/peaks\0'))
      )
        confirmOsc?.()
      // Carla sends runtime messages containing int64 as well as simple peak tuples.
      if (!packet.subarray(0, 12).equals(Buffer.from('/ctrl/peaks\0'))) return
      try {
        const { args } = decodeOsc(packet)
        const [index, , , left, right] = args.map((arg) => arg.value)
        if (
          typeof index === 'number' &&
          typeof left === 'number' &&
          typeof right === 'number'
        ) {
          const plugin = request.session.plugins[index]
          if (plugin) this.levels({ id: plugin.id, left, right })
        }
      } catch {
        /* Ignore other message layouts from a newer host. */
      }
    })
    this.port = await availableControlPort()
    this.configDir = await mkdtemp(join(tmpdir(), 'xmxs-carla-'))
    await atomicWrite(
      join(this.configDir, 'falkTX', 'Carla2.conf'),
      `[Engine]\nAudioDriver=${this.driver}\nProcessMode=3\nTransportMode=1\n[OSC]\nEnabled=true\nTCPEnabled=false\nUDPEnabled=true\nUDPRandom=false\nUDPNumber=${this.port}\n`,
    )
    this.emit({ status: 'starting' })
    const child = spawn(executable, ['--no-gui', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: this.configDir,
        PYTHONUNBUFFERED: '1',
        ...(this.driver === 'SDL' ? { SDL_AUDIODRIVER: 'dummy' } : {}),
      },
    })
    this.child = child
    await new Promise<void>((resolve, reject) => {
      let log = ''
      const timeout = setTimeout(
        () => reject(Error('Carla startup timed out: ' + log.slice(-500))),
        20000,
      )
      let registered = false
      confirmOsc = () => {
        if (!registered || this.child !== child) return
        confirmOsc = undefined
        clearTimeout(timeout)
        this.ready = true
        this.emit({ status: 'ready' })
        resolve()
      }
      const read = (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-4096)
        if (
          log.includes('Carla ready!') &&
          !registered &&
          this.child === child
        ) {
          registered = true
          socket.send(
            encodeOsc('/register', [
              {
                type: 's',
                value: `osc.udp://127.0.0.1:${socket.address().port}/ctrl`,
              },
            ]),
            this.port,
            '127.0.0.1',
          )
        }
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        if (this.child !== child) return
        const wasReady = this.ready
        this.ready = false
        this.child = undefined
        const error = Error(`Carla exited (${code}): ${log.slice(-500)}`)
        if (!wasReady) reject(error)
        else this.scheduleRecovery(request, error)
      })
    })
  }
  private scheduleRecovery(request: Request, error: Error) {
    this.emit({ status: 'error', message: error.message })
    if (this.wanted !== request || ++this.attempts > 5) return
    this.retry = setTimeout(
      () =>
        void this.queue(async () => {
          if (this.wanted !== request) return
          await this.close()
          try {
            await this.launch(request)
          } catch (e) {
            await this.close()
            this.scheduleRecovery(request, Error(String(e)))
          }
        }),
      Math.min(8000, 250 * 2 ** (this.attempts - 1)),
    )
  }
  send(
    id: string,
    command:
      | 'note_on'
      | 'note_off'
      | 'set_parameter_value'
      | 'set_program'
      | 'set_volume'
      | 'set_drywet',
    args: OscArg[],
  ): void {
    const index =
      this.wanted?.session.plugins.findIndex((item) => item.id === id) ?? -1
    if (!this.ready || !this.sock || index < 0)
      throw Error('Plugin is unavailable: ' + id)
    this.sock.send(
      encodeOsc(`/Carla/${index}/${command}`, args),
      this.port,
      '127.0.0.1',
      (error) => {
        if (error) this.emit({ status: 'error', message: error.message })
      },
    )
  }
  private async close() {
    clearTimeout(this.retry)
    const child = this.child
    this.child = undefined
    this.ready = false
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
        child.once('close', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    this.sock?.close()
    this.sock = undefined
    if (this.configDir)
      await rm(this.configDir, { recursive: true, force: true })
    this.configDir = ''
  }
  stop(): Promise<void> {
    return this.queue(async () => {
      this.wanted = undefined
      await this.close()
      this.emit({ status: 'stopped' })
    })
  }
}
