import { uniqueId } from './ids'
import type { PdfDocument, PdfTrack, Track } from './model'

export function pdfTrack(sheet: PdfDocument, tracks: Track[]): PdfTrack {
  return { id:uniqueId(sheet.id,tracks.map(track => track.id)), kind:'pdf', documentId:sheet.id,
    name:sheet.name, height:300, color:'#8e99ab', mode:'mute', solo:false, volume:0, pan:0 }
}
