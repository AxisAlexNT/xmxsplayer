import create, { type StretchNode } from 'signalsmith-stretch'
create.moduleUrl = '/worklets/signalsmith-stretch.mjs'
export async function stretchNode(
  context: BaseAudioContext,
): Promise<{ node: StretchNode; latency: number }> {
  const node = await create(context, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  })
  node.port.onmessageerror = () => console.error('Audio stretch message failed')
  return { node, latency: await node.latency() }
}
