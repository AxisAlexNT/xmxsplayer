import type { CommandMap, EventMap, RequestMap } from './protocol'

type Payloads = CommandMap & EventMap
type Port = Pick<
  MessagePort,
  'postMessage' | 'start' | 'close' | 'addEventListener' | 'removeEventListener'
>
export class Bus {
  private handlers = new Map<string, Set<(payload: never) => void>>()
  private pending = new Map<
    string,
    {
      resolve: (value: never) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private responders = new Map<string, (value: never) => unknown>()
  constructor(
    private port: Port,
    private direction: 'cmd' | 'evt',
  ) {
    port.addEventListener('message', this.receive)
    port.start()
  }
  send<N extends keyof Payloads>(name: N, payload: Payloads[N]): void {
    this.port.postMessage({ kind: this.direction, name, payload })
  }
  on<N extends keyof Payloads>(
    name: N,
    handler: (payload: Payloads[N]) => void,
  ): () => void {
    const set = this.handlers.get(name) ?? new Set()
    set.add(handler as (payload: never) => void)
    this.handlers.set(name, set)
    return () => {
      set.delete(handler as (payload: never) => void)
    }
  }
  request<N extends keyof RequestMap>(
    name: N,
    payload: RequestMap[N]['input'],
    timeoutMs = 10_000,
  ): Promise<RequestMap[N]['output']> {
    const rid = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid)
        reject(new Error(`${name} timed out`))
      }, timeoutMs)
      this.pending.set(rid, {
        resolve: resolve as (v: never) => void,
        reject,
        timer,
      })
      this.port.postMessage({ kind: 'req', name, payload, rid })
    })
  }
  respond<N extends keyof RequestMap>(
    name: N,
    handler: (
      payload: RequestMap[N]['input'],
    ) => RequestMap[N]['output'] | Promise<RequestMap[N]['output']>,
  ): void {
    this.responders.set(name, handler as (v: never) => unknown)
  }
  private receive = (event: MessageEvent): void => {
    const data = event.data
    if (
      !data ||
      typeof data.name !== 'string' ||
      !['cmd', 'evt', 'req', 'res'].includes(data.kind)
    )
      return
    if (data.kind === 'res') {
      const item = this.pending.get(data.rid)
      if (!item) return
      clearTimeout(item.timer)
      this.pending.delete(data.rid)
      if (data.error) item.reject(new Error(data.error))
      else item.resolve(data.payload as never)
    } else if (data.kind === 'req') {
      const handler = this.responders.get(data.name)
      void Promise.resolve()
        .then(() => {
          if (!handler) throw new Error(`Unsupported request: ${data.name}`)
          return handler(data.payload as never)
        })
        .then(
          (payload) => this.port.postMessage({ ...data, kind: 'res', payload }),
          (error) =>
            this.port.postMessage({
              ...data,
              kind: 'res',
              error: String(error),
              payload: undefined,
            }),
        )
    } else if (data.kind !== this.direction) {
      this.handlers
        .get(data.name)
        ?.forEach((handler) => handler(data.payload as never))
    }
  }
  close(): void {
    this.port.removeEventListener('message', this.receive)
    this.port.close()
    this.pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('Bus disconnected'))
    })
    this.pending.clear()
    this.handlers.clear()
  }
}
