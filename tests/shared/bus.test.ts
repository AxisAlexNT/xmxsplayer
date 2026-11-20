import { describe, expect, it } from 'vitest'
import { Bus } from '../../src/shared/bus'

describe('typed message bus', () => {
  it('handshakes, requests, rejects unsupported requests and closes pending requests', async () => {
    const { port1, port2 } = new MessageChannel()
    const ui = new Bus(port1, 'cmd')
    const engine = new Bus(port2, 'evt')
    try {
      engine.on('ping', () => engine.send('ready', undefined))
      const ready = new Promise<void>((resolve) => ui.on('ready', resolve))
      ui.send('ping', undefined)
      await ready
      const bytes=new Uint8Array([7,11,42])
      engine.respond('audio:spectrum',()=>bytes.buffer)
      expect(new Uint8Array(await ui.request('audio:spectrum',{trackId:'audio'}))).toEqual(new Uint8Array([7,11,42]))
      expect(bytes.byteLength).toBe(0)
      engine.respond('audio:devices', () => [{ id: 'main', label: 'Main' }])
      expect(await ui.request('audio:devices', undefined)).toEqual([
        { id: 'main', label: 'Main' },
      ])
      await expect(
        ui.request('soundfont:presets', { soundfontId: 'missing' }),
      ).rejects.toThrow('Unsupported request')
      engine.respond('audio:load', () => new Promise(() => undefined))
      await expect(
        ui.request(
          'audio:load',
          { trackId: 'ref', url: 'app://xmxsplayer/ref' },
          10,
        ),
      ).rejects.toThrow('timed out')
      const waiting = ui.request('audio:load', {
        trackId: 'ref',
        url: 'app://xmxsplayer/ref',
      })
      ui.close()
      await expect(waiting).rejects.toThrow('disconnected')
    } finally {
      ui.close()
      engine.close()
    }
  })
})
