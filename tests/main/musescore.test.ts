import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  conversionJob,
  detectMuseScore,
  executableCandidates,
  runMuseScore,
} from '../../src/main/musescore'
describe('MuseScore discovery and jobs', () => {
  it('respects an explicit path and includes both installed Linux version-three names', () => {
    expect(executableCandidates('/custom/MuseScore')).toEqual([
      '/custom/MuseScore',
    ])
    const candidates = executableCandidates('', 'linux', { PATH: '/usr/bin' })
    expect(candidates).toContain('/usr/bin/mscore3')
    expect(candidates).toContain('/usr/bin/musescore3')
  })
  it('serializes literal paths without shell interpolation', () => {
    expect(
      JSON.parse(
        conversionJob('/tmp/a $score.mscz', '/tmp/a.mid', '/tmp/a.musicxml'),
      ),
    ).toEqual([
      { in: '/tmp/a $score.mscz', out: ['/tmp/a.mid', '/tmp/a.musicxml'] },
    ])
  })
  it('tries accessible candidates and reports their version', async () => {
    const deps = {
      candidates: () => ['/absent', '/mscore3'],
      accessible: vi.fn(async (path: string) => {
        if (path === '/absent') throw Error('absent')
      }),
      run: vi.fn(async () => 'warning\nMuseScore 3.2.3\n'),
      appImages: vi.fn(async () => []),
    }
    expect(await detectMuseScore('', deps)).toEqual({
      path: '/mscore3',
      version: 'MuseScore 3.2.3',
    })
    expect(deps.run).toHaveBeenCalledTimes(1)
  })
  it('does not silently substitute another executable for an invalid configured path', async () => {
    await expect(
      detectMuseScore('/bad', {
        candidates: (p) => [p],
        accessible: async () => {
          throw Error('not executable')
        },
        run: async () => '',
        appImages: async () => ['/working'],
      }),
    ).rejects.toThrow(/not executable/)
  })
  it('rejects nonzero exits and kills a timed-out child', async () => {
    await expect(
      runMuseScore(process.execPath, [
        '-e',
        'require("node:fs").writeSync(2,"export failed");process.exitCode=2',
      ]),
    ).rejects.toThrow(/export failed/)
    await expect(
      runMuseScore(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 80),
    ).rejects.toThrow(/timed out/)
  })
  it('includes Windows installations for versions four and three', () => {
    const candidates = executableCandidates('', 'win32', {
      ProgramFiles: '/programs',
    })
    expect(candidates).toContain(
      join('/programs', 'MuseScore 4', 'bin', 'MuseScore4.exe'),
    )
    expect(candidates).toContain(
      join('/programs', 'MuseScore 3', 'bin', 'MuseScore3.exe'),
    )
  })
  it('rejects an executable that reports another product version', async () => {
    await expect(
      detectMuseScore('/wrong', {
        candidates: (p) => [p],
        accessible: async () => undefined,
        run: async () => 'Unrelated 1.0',
        appImages: async () => [],
      }),
    ).rejects.toThrow(/did not report a MuseScore version/)
  })
})
