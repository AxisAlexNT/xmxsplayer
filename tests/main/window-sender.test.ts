import { expect, it } from 'vitest'
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron'
import { isWindowSender, ownsContents } from '../../src/main/window-sender'
function fixture(destroyedWindow = false, destroyedContents = false) {
  const frame = {},
    contents = {
      isDestroyed: () => destroyedContents,
      get mainFrame() {
        if (destroyedContents) throw Error('Contents destroyed')
        return frame
      },
    } as unknown as WebContents
  const window = {
    isDestroyed: () => destroyedWindow,
    get webContents() {
      if (destroyedWindow) throw Error('Window destroyed')
      return contents
    },
  } as unknown as BrowserWindow
  const event = {
    sender: contents,
    senderFrame: frame,
  } as unknown as IpcMainEvent
  return { window, contents, event }
}
it('ignores late messages without reading destroyed window or frame properties', () => {
  for (const [deadWindow, deadContents] of [
    [true, false],
    [false, true],
    [true, true],
  ]) {
    const f = fixture(deadWindow, deadContents)
    expect(isWindowSender(f.window, f.event)).toBe(false)
    expect(ownsContents(f.window, f.contents)).toBe(false)
  }
})
it('accepts the owning top frame and rejects other windows and subframes', () => {
  const a = fixture(),
    b = fixture()
  expect(isWindowSender(a.window, a.event)).toBe(true)
  expect(isWindowSender(a.window, b.event)).toBe(false)
  expect(
    isWindowSender(a.window, { ...a.event, senderFrame: b.event.senderFrame }),
  ).toBe(false)
  expect(isWindowSender(a.window, { ...a.event, senderFrame: null })).toBe(
    false,
  )
  expect(ownsContents(undefined, a.contents)).toBe(false)
  expect(ownsContents(a.window, null)).toBe(false)
})
