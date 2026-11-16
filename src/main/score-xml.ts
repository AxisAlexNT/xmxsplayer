import { readFile, stat } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { confined } from './project-io'
const LIMIT = 64 * 1024 * 1024
export function unpackMusicXml(bytes: Uint8Array): string {
  let size = 0
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (!/\.(xml|musicxml)$/i.test(entry.name)) return false
      size += entry.originalSize
      if (size > LIMIT) throw Error('Compressed score exceeds 64 MiB of XML')
      return true
    },
  })
  const container = files['META-INF/container.xml']
  if (!container)
    throw Error('Compressed MusicXML has no META-INF/container.xml')
  const doc = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw Error(message)
    },
  }).parseFromString(new TextDecoder().decode(container), 'application/xml')
  const roots = Array.from(doc.getElementsByTagNameNS('*', 'rootfile')),
    name = (
      roots.find(
        (n) =>
          n.getAttribute('media-type') ===
          'application/vnd.recordare.musicxml+xml',
      ) ?? roots[0]
    )?.getAttribute('full-path')
  if (!name || !files[name])
    throw Error('Compressed MusicXML root score is missing')
  return new TextDecoder().decode(files[name])
}
export async function readScoreXml(
  folder: string,
  file: string,
): Promise<string> {
  if (!/\.(musicxml|mxl)$/i.test(file))
    throw Error('Choose MusicXML or compressed MusicXML')
  const path = await confined(folder, file)
  if ((await stat(path)).size > LIMIT) throw Error('Score file exceeds 64 MiB')
  const bytes = await readFile(path)
  return /\.mxl$/i.test(file) ? unpackMusicXml(bytes) : bytes.toString('utf8')
}
