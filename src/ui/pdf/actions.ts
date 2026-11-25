import { shallowRef } from 'vue'
import type { PdfAction } from '../../shared/model'

export interface SheetCommand { folder: string; id: string; action: PdfAction }
export const pendingSheetCommands = shallowRef<SheetCommand[]>([])
