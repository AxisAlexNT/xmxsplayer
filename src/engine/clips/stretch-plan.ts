import type { StretchSchedule } from 'signalsmith-stretch'
interface PlannedProcessor {
  timeMap: StretchSchedule[]
  port: Pick<MessagePort, 'onmessage'>
}
/** Install a complete plan atomically; individual schedule calls replace pending segments. */
export function installClipPlan(processor: PlannedProcessor): void {
  const receive = processor.port.onmessage
  processor.port.onmessage = (event: MessageEvent) => {
    if (event.data?.type !== 'xmxs:clip-plan') {
      receive?.call(processor.port as MessagePort, event)
      return
    }
    const changes: StretchSchedule[] = event.data.changes
    if (!Array.isArray(changes) || !changes.length || changes.length > 128)
      return
    if (
      changes.some(
        (change, index) =>
          !change ||
          !Number.isFinite(change.output) ||
          !Number.isFinite(change.input) ||
          !Number.isFinite(change.rate) ||
          change.rate! <= 0 ||
          !Number.isFinite(change.semitones) ||
          typeof change.active !== 'boolean' ||
          (index > 0 && change.output < changes[index - 1].output),
      )
    )
      return
    const defaults = processor.timeMap[0]
    processor.timeMap = changes.map((change) => ({ ...defaults, ...change }))
  }
}
