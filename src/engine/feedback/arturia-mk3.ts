const header = [0xf0, 0x00, 0x20, 0x6b, 0x7f, 0x42]
const frame = (body: readonly number[]): number[] => [...header, ...body, 0xf7]
function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 127)
    throw Error('SysEx data must be a 7-bit integer')
  return value
}
export const connect = (enabled = true): number[] =>
  frame([0x02, 0x0f, 0x40, 0x5a, enabled ? 1 : 0])
export const selectProgram = (program: number): number[] =>
  frame([0x21, 0x11, 0x40, 0x02, 0x00, byte(program)])
export const setColor = (id: number, rgb: readonly number[]): number[] => {
  if (rgb.length !== 3) throw Error('RGB requires three components')
  return frame([0x04, 0x01, 0x16, byte(id), ...rgb.map(byte)])
}
export function screenText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, 16)
}
export const display = (line1: string, line2: string): number[] =>
  frame([
    0x04,
    0x01,
    0x60,
    0x12,
    0x01,
    ...[...screenText(line1)].map((c) => c.charCodeAt(0)),
    0x00,
    0x02,
    ...[...screenText(line2)].map((c) => c.charCodeAt(0)),
    0x00,
  ])
export function programChanged(data: Uint8Array): number | null {
  if (
    data.length !== 13 ||
    !header.every((n, i) => data[i] === n) ||
    data[12] !== 0xf7 ||
    ![0x21, 0x11, 0x40, 0x02, 0x00].every((n, i) => data[6 + i] === n) ||
    data[11] > 127
  )
    return null
  return data[11]
}
export function rgb(color: string, level = 1): number[] {
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw Error('Expected a six-digit RGB colour')
  const intensity = Math.max(0, Math.min(1, level))
  return [1, 3, 5].map((i) =>
    Math.round((parseInt(color.slice(i, i + 2), 16) / 255) * 127 * intensity),
  )
}
