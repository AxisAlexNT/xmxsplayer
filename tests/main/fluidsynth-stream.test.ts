import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { FluidSynthProcess } from '../../src/main/fluidsynth'
import { FluidSynthBackend } from '../../src/engine/synth/fluid-synth'
import { defaultSettings } from '../../src/shared/defaults'
import { liveProject } from '../../src/shared/template'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  randomUUID: () => '00000000-0000-4000-8000-000000000001',
}))

it('preserves FluidSynth launch arguments and stdin bytes for a plain piano project', async () => {
  const launches: string[][] = []
  const writes: Buffer[] = []
  // Simulate only the native executable. Both app-side command producers are real.
  vi.mocked(spawn).mockImplementation((_path, args) => {
    const argv = Array.isArray(args) ? args : []
    launches.push([...argv])
    const stdin = new PassThrough(),
      stdout = new PassThrough(),
      stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr })
    if (argv.includes('-V')) {
      queueMicrotask(() => {
        stdout.write('FluidSynth executable version 2.3.4\n')
        child.emit('close', 0)
      })
    } else {
      stdin.on('data', (bytes: Buffer) => {
        writes.push(Buffer.from(bytes))
        for (const line of bytes.toString().split('\n')) {
          if (line.startsWith('load '))
            stdout.write('loaded SoundFont has ID 1\n')
          if (line.startsWith('echo ')) stdout.write(line.slice(5) + '\n')
        }
      })
      stdin.on('end', () => child.emit('close', 0))
    }
    return child as unknown as ReturnType<typeof spawn>
  })
  const config = {
    ...defaultSettings().fluid,
    path: process.execPath,
    driver: 'file',
    sampleRate: 48000,
  }
  const native = new FluidSynthProcess()
  const backend = new FluidSynthBackend(
    {
      start: () => native.start(config),
      stop: () => native.stop(),
      load: (file) => native.load(file),
      unload: (id) => native.unload(id),
      send: async (lines) => native.send(lines),
      presets: (id) => native.presets(id),
      detect: async () => {
        throw Error('Unexpected detection request')
      },
      onEvent: () => () => undefined,
    },
    () => 0,
    config,
    (message) => {
      throw Error(message)
    },
  )
  try {
    const project = liveProject('Fixed performance', 'Studio piano.sf2')
    await backend.loadSoundFont(
      project.soundfonts[0],
      project.soundfonts[0].file,
    )
    const piano = await backend.allocate(project.instruments[0])
    backend.noteOn(piano, 60, 98)
    backend.cc(piano, 64, 127)
    backend.noteOn(piano, 64, 76)
    backend.noteOff(piano, 60)
    backend.noteOff(piano, 64)
    backend.cc(piano, 64, 0)
  } finally {
    await backend.destroy()
  }
  expect({
    launches,
    stdin: Buffer.concat(writes).toString('utf8'),
  }).toMatchSnapshot()
})
