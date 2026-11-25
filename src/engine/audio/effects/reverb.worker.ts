import { roomImpulse } from './reverb'

self.onmessage = (
  event: MessageEvent<{ sampleRate: number; params: Record<string, number> }>,
) => {
  const channels = roomImpulse(event.data.sampleRate, event.data.params)
  self.postMessage(channels, {
    transfer: channels.map((channel) => channel.buffer),
  })
}
