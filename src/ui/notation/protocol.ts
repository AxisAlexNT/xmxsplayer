export interface NotationOptions {
  pageWidth: number
  scale: number
}
export interface NotationOnset {
  qstamp: number
  id: string
  page: number
  staff: number
  key?: number
  end?: number
}
export interface NotationMeasure {
  qstamp: number
  id: string
  page: number
  end: number
}
export interface NotationInfo {
  pageCount: number
  timemap: NotationOnset[]
  measures: NotationMeasure[]
  end: number
  version: string
}
export interface NotationCommands {
  load: {
    input: { musicxml: string; options: NotationOptions }
    output: NotationInfo
  }
  render: { input: { page: number }; output: string }
  midi: { input: undefined; output: string }
  relayout: { input: NotationOptions; output: NotationInfo }
}
export type NotationRequest = {
  [K in keyof NotationCommands]: {
    id: number
    cmd: K
    data: NotationCommands[K]['input']
  }
}[keyof NotationCommands]
export interface NotationResponse {
  id: number
  data?: NotationCommands[keyof NotationCommands]['output']
  error?: string
}

export interface AxisPoint {
  bar?: boolean
  tick: number
  x: number
}
