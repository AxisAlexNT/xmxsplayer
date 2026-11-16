import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { FluidSynthProcess } from '../../src/main/fluidsynth'
import { defaultSettings } from '../../src/shared/defaults'
import type { FluidEvent } from '../../src/shared/fluid'

it.skipIf(process.env.XM_FLUID_FILE_TEST !== '1')(
  'loads SF2/SF3 and exchanges commands over stdin with file audio output',
  async () => {
    const folder = await mkdtemp(join(tmpdir(), 'xmxs-fluid-')),
      events: FluidEvent[] = [],
      process = new FluidSynthProcess((event) => events.push(event))
    try {
      await process.start({
        ...defaultSettings().fluid,
        path: '/usr/bin/fluidsynth',
        driver: 'file',
        sampleRate: 48000,
        extraArgs: ['-o', `audio.file.name=${join(folder, 'output.wav')}`],
      })
      const font = await process.load('/usr/share/sounds/sf2/TimGM6mb.sf2')
      const presets = await process.presets(font)
      expect(presets.some((p) => p.bank === 0 && p.program === 0)).toBe(true)
      process.send([`select 0 ${font} 0 0`, 'noteon 0 60 100'])
      await new Promise((resolve) => setTimeout(resolve, 80))
      process.send(['noteoff 0 60', 'cc 0 64 0', 'pitch_bend 0 8192'])
      const sf3 = await process.load(
        '/usr/share/sounds/sf3/MuseScore_General_Lite.sf3',
      )
      expect(sf3).not.toBe(font)
      expect((await process.presets(sf3)).length).toBeGreaterThan(100)
    await process.unload(sf3)
      expect(events.some((e) => e.type === 'ready')).toBe(true)
      expect(events.filter((e) => e.type === 'log')).toEqual([])
      const child = (process as unknown as { child: ChildProcess }).child
      child.kill('SIGKILL')
      const deadline = Date.now() + 10000
      while (
        events.filter((e) => e.type === 'ready').length < 2 &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 20))
      expect(events.filter((e) => e.type === 'ready')).toHaveLength(2)
      expect(events.some((e) => e.type === 'exit' && e.restarting)).toBe(true)
      const restored = await process.load('/usr/share/sounds/sf2/TimGM6mb.sf2')
      expect((await process.presets(restored)).length).toBeGreaterThan(100)
    } finally {
      await process.stop()
    }
    expect((await stat(join(folder, 'output.wav'))).size).toBeGreaterThan(44)
  },
  30000,
)
