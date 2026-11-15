let timer: ReturnType<typeof setInterval> | undefined
self.onmessage = (event: MessageEvent<'start' | 'stop'>): void => {
  clearInterval(timer)
  timer = undefined
  if (event.data === 'start')
    timer = setInterval(() => self.postMessage('tick'), 20)
}
