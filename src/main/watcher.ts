import { watch, type FSWatcher } from 'chokidar'
import { relative } from 'node:path'
import type { FileChanges } from '../shared/api'
import { documentPath, hash, type ProjectIO } from './project-io'

export class ProjectWatcher {
  private watcher?: FSWatcher
  private debounce?: ReturnType<typeof setTimeout>
  async start(
    io: ProjectIO,
    notify: (change: FileChanges) => void,
    sourceChanged: (change: { folder: string; paths: string[] }) => void = () =>
      undefined,
  ): Promise<void> {
    await this.close()
    const folder = io.folder
    const seen = { ...io.hashes }
    const watcher = watch(folder, {
      ignored: (path) => path.split(/[\\/]/).includes('.xmxs'),
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    })
    this.watcher = watcher
    let queue = Promise.resolve()
    const scores = new Set<string>()
    watcher.on('all', (_event, absolute) => {
      const path = relative(folder, absolute).split('\\').join('/')
      const isScore = /\.(mscz|mscx|mid|musicxml|mxl)$/i.test(path)
      if (isScore) scores.add(path)
      if (!documentPath(path) && !isScore) return
      clearTimeout(this.debounce)
      this.debounce = setTimeout(() => {
        queue = queue
          .then(async () => {
            if (io.folder !== folder || watcher !== this.watcher) return
            if (scores.size) {
              const paths = [...scores]
              scores.clear()
              sourceChanged({ folder, paths })
            }
            const all = await io.readAll()
            const changes: FileChanges = { folder, files: {}, hashes: {} }
            for (const path of new Set([
              ...Object.keys(all),
              ...Object.keys(seen),
            ])) {
              const content = all[path] ?? null
              const digest = content === null ? '' : hash(content)
              if (digest === (seen[path] ?? '')) continue
              seen[path] = digest
              if (digest === (io.hashes[path] ?? '')) continue
              io.hashes[path] = digest
              changes.files[path] = content
              changes.hashes[path] = digest
            }
            if (Object.keys(changes.files).length) notify(changes)
          })
          .catch((error) => console.error(`Watcher: ${String(error)}`))
      }, 100)
    })
    await new Promise<void>((resolve, reject) => {
      watcher.once('ready', resolve)
      watcher.once('error', reject)
    })
  }
  async close(): Promise<void> {
    clearTimeout(this.debounce)
    const watcher = this.watcher
    this.watcher = undefined
    await watcher?.close()
  }
}
