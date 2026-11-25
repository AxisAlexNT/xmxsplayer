export type OscArg =
  { type: 'i' | 'f'; value: number } | { type: 's'; value: string }
export interface OscMessage {
  address: string
  args: OscArg[]
}

function oscString(value: string): Buffer {
  if (value.includes('\0')) throw Error('OSC text contains a null character')
  const data = Buffer.from(value, 'utf8')
  const result = Buffer.alloc(Math.ceil((data.length + 1) / 4) * 4)
  data.copy(result)
  return result
}

export function encodeOsc(address: string, args: OscArg[] = []): Buffer {
  if (!address.startsWith('/')) throw Error('Expected an OSC path')
  const parts = [
    oscString(address),
    oscString(',' + args.map((arg) => arg.type).join('')),
  ]
  for (const arg of args) {
    if (arg.type === 's') parts.push(oscString(arg.value))
    else {
      if (!Number.isFinite(arg.value)) throw Error('Invalid OSC number')
      const bytes = Buffer.alloc(4)
      if (arg.type === 'i') {
        if (!Number.isInteger(arg.value)) throw Error('Expected an OSC integer')
        bytes.writeInt32BE(arg.value)
      } else bytes.writeFloatBE(arg.value)
      parts.push(bytes)
    }
  }
  return Buffer.concat(parts)
}

export function decodeOsc(packet: Buffer): OscMessage {
  let offset = 0
  function string(): string {
    const end = packet.indexOf(0, offset)
    if (end < 0) throw Error('Incomplete OSC string')
    const text = packet.toString('utf8', offset, end)
    offset = Math.ceil((end + 1) / 4) * 4
    if (offset > packet.length) throw Error('Incomplete OSC padding')
    return text
  }
  const address = string(),
    tags = string()
  if (!address.startsWith('/') || !tags.startsWith(','))
    throw Error('Invalid OSC message')
  const args: OscArg[] = []
  for (const type of tags.slice(1)) {
    if (type === 's') args.push({ type, value: string() })
    else {
      if (type !== 'i' && type !== 'f')
        throw Error('Unsupported OSC type: ' + type)
      if (offset + 4 > packet.length) throw Error('Incomplete OSC number')
      args.push({
        type,
        value:
          type === 'i'
            ? packet.readInt32BE(offset)
            : packet.readFloatBE(offset),
      })
      offset += 4
    }
  }
  if (offset !== packet.length) throw Error('Unexpected trailing OSC data')
  return { address, args }
}
