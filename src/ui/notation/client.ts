import NotationWorker from './verovio.worker?worker'
import type {
  NotationCommands,
  NotationRequest,
  NotationResponse,
} from './protocol'
export class NotationClient {
  private worker = new NotationWorker()
  private next = 0
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor() {
    this.worker.onmessage = ({
      data,
    }: MessageEvent<NotationResponse>): void => {
      const task = this.pending.get(data.id)
      if (!task) return
      clearTimeout(task.timer)
      this.pending.delete(data.id)
      if (data.error) task.reject(Error(data.error))
      else task.resolve(data.data)
    }
    this.worker.onerror = (event): void => {
      event.preventDefault()
      this.fail(Error(event.message || 'Notation worker failed'))
    }
  }
  request<K extends keyof NotationCommands>(
    cmd: K,
    data: NotationCommands[K]['input'],
  ): Promise<NotationCommands[K]['output']> {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(Error('Notation request timed out'))
      }, 60000)
      this.pending.set(id, {
        resolve: (value) => resolve(value as NotationCommands[K]['output']),
        reject,
        timer,
      })
      this.worker.postMessage({ id, cmd, data } as NotationRequest)
    })
  }
  private fail(error: Error): void {
    for (const task of this.pending.values()) {
      clearTimeout(task.timer)
      task.reject(error)
    }
    this.pending.clear()
  }
  destroy(): void {
    this.worker.terminate()
    this.fail(Error('Notation worker closed'))
  }
}
