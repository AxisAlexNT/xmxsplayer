import { expect, it, vi } from 'vitest'
import { EffectChain } from '../../src/engine/audio/effects/chain'
import type { Effect } from '../../src/shared/effects'

class Node {
  links = new Set<Node>()
  gain = {
    value: 1,
    cancelAndHoldAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
  }
  connect(target: Node) {
    this.links.add(target)
    return target
  }
  disconnect(target?: Node) {
    if (target) this.links.delete(target)
    else this.links.clear()
  }
}

it('keeps a dry direct route, crossfades insert changes and schedules ducking at note timestamps', () => {
  vi.useFakeTimers()
  const gains: Node[] = []
  const ctx = {
    currentTime: 10,
    createGain() {
      const node = new Node()
      gains.push(node)
      return node
    },
  }
  const source = new Node(),
    target = new Node()
  const chain = new EffectChain(
    ctx as unknown as AudioContext,
    source as unknown as AudioNode,
    target as unknown as AudioNode,
  )
  try {
    chain.set([])
    expect(source.links).toEqual(new Set([target]))
    const fx: Effect = {
      id: 'duck',
      type: 'pump',
      enabled: true,
      params: { attack: 0.01, release: 0.25, depth: 0.75 },
      trigger: { trackId: 'kick' },
    }
    chain.set([fx])
    const [wet, duck, dry] = gains
    expect(wet.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.015)
    expect(dry.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.015)
    chain.trigger('piano', 10.5)
    expect(duck.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    // The scheduler supplies audible context times even when loop ticks wrap.
    for (const time of [10.5, 10.75]) {
      chain.trigger('kick', time)
      expect(duck.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        0.25,
        time + 0.01,
      )
      expect(duck.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        1,
        time + 0.01 + 0.25,
      )
    }
    vi.advanceTimersByTime(50)
    expect(source.links.size).toBe(1)
    chain.set([{ ...fx, enabled: false }])
    vi.advanceTimersByTime(50)
    expect(duck.links.size).toBe(0)
  } finally {
    chain.close()
    vi.useRealTimers()
  }
})
