import { afterEach, expect, it, vi } from 'vitest'
import { AudioGraph } from '../../src/engine/audio/graph'
import { defaultSettings } from '../../src/shared/defaults'
class Node {
  links: { target: Node; output: number; input: number }[] = []
  channelCount = 2
  maxChannelCount = 2
  gain = { value: 1 }
  threshold = { value: 0 }
  knee = { value: 0 }
  ratio = { value: 0 }
  attack = { value: 0 }
  release = { value: 0 }
  constructor(readonly kind: string) {}
  connect(target: Node, output = 0, input = 0): Node {
    this.links.push({ target, output, input })
    return target
  }
  disconnect(): void {
    this.links = []
  }
}
class Context {
  static channels = 2
  nodes: Node[] = []
  destination = new Node('destination')
  sampleRate: number
  baseLatency = 128 / 48000
  outputLatency = 0.02
  state = 'running'
  constructor(options: { sampleRate: number }) {
    this.sampleRate = options.sampleRate
    this.destination.maxChannelCount = Context.channels
  }
  node(kind: string): Node {
    const node = new Node(kind)
    this.nodes.push(node)
    return node
  }
  createGain(): Node {
    return this.node('gain')
  }
  createDynamicsCompressor(): Node {
    return this.node('limiter')
  }
  createChannelSplitter(): Node {
    return this.node('split')
  }
  createChannelMerger(): Node {
    return this.node('merger')
  }
  addEventListener(): void {}
  async setSinkId(): Promise<void> {}
  async resume(): Promise<void> {
    this.state = 'running'
  }
  async close(): Promise<void> {
    this.state = 'closed'
  }
}
const graphs: AudioGraph[] = []
afterEach(async () => {
  await Promise.all(graphs.splice(0).map((g) => g.close()))
  vi.unstubAllGlobals()
})
it('mixes cue into main on stereo hardware and bypasses the limiter when disabled', async () => {
  Context.channels = 2
  vi.stubGlobal('AudioContext', Context)
  const warn = vi.fn()
  const report = vi.fn()
  const graph = new AudioGraph(defaultSettings().audio, report, warn)
  graphs.push(graph)
  const settings = defaultSettings().audio
  settings.cue.mode = 'channels34'
  await graph.apply(settings)
  const cue = graph.cue as unknown as Node
  const master = graph.master as unknown as Node
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('fewer than four channels'),
  )
  expect(cue.links[0].target).toBe(master)
  expect(master.links[0].target).toBe(graph.limiter)
  settings.cue.mode = 'off'
  settings.limiter = false
  await graph.apply(settings)
  expect(master.links[0].target).toBe(graph.context.destination)
  expect(report).toHaveBeenCalledWith(
    expect.objectContaining({
      sampleRate: 48000,
      bufferSize: 0,
      baseMs: 128 / 48,
      outputMs: 20,
    }),
  )
})
it('routes main to channels 1–2 and cue to 3–4 on a four-channel output', async () => {
  Context.channels = 4
  vi.stubGlobal('AudioContext', Context)
  const graph = new AudioGraph(
    defaultSettings().audio,
    () => undefined,
    () => undefined,
  )
  graphs.push(graph)
  const settings = defaultSettings().audio
  settings.cue.mode = 'channels34'
  await graph.apply(settings)
  const ctx = graph.context as unknown as Context
  expect(ctx.destination.channelCount).toBe(4)
  const splits = ctx.nodes.filter((n) => n.kind === 'split')
  expect(splits[0].links.map((l) => [l.output, l.input])).toEqual([
    [0, 0],
    [1, 1],
  ])
  expect(splits[1].links.map((l) => [l.output, l.input])).toEqual([
    [0, 2],
    [1, 3],
  ])
  expect(ctx.nodes.find((n) => n.kind === 'merger')!.links[0].target).toBe(
    ctx.destination,
  )
})
