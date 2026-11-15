import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron'

export function ownsContents(
  window: BrowserWindow | undefined,
  contents: WebContents | null,
): boolean {
  return (
    !!window &&
    !window.isDestroyed() &&
    !!contents &&
    !contents.isDestroyed() &&
    contents === window.webContents
  )
}
export function isWindowSender(
  window: BrowserWindow | undefined,
  event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>,
): boolean {
  return (
    ownsContents(window, event.sender) &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  )
}
