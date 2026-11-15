import { spawn } from 'node:child_process'
import electron from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.', '--smoke'], { env, stdio: 'inherit' })
let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  console.error('Electron startup timed out after 30 seconds.')
  child.kill('SIGKILL')
}, 30_000)
child.on('error', (error) => {
  clearTimeout(timeout)
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  clearTimeout(timeout)
  if (timedOut || signal || code !== 0) {
    console.error(`Electron startup failed (${signal ?? code}).`)
    process.exitCode = 1
  } else {
    console.log('Electron startup smoke test passed.')
  }
})
