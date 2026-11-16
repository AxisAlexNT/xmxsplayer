import type { ControlDef } from './model'

export type ControlMessage = NonNullable<ControlDef['msg']>

export function controlMessages(control: ControlDef): ControlMessage[] {
  return [...(control.msg ? [control.msg] : []), ...(control.aliases ?? [])]
}

export function sameControlMessage(
  a: ControlMessage,
  b: ControlMessage,
): boolean {
  return (
    a.type === b.type &&
    a.number === b.number &&
    (a.channel === null || b.channel === null || a.channel === b.channel)
  )
}
