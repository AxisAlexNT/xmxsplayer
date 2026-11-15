export interface ControlFeedback {
  color: string
  level: number
  state: 'off' | 'idle' | 'on' | 'queued'
}
export interface DeviceFeedback {
  deviceId: string
  status: 'off' | 'active' | 'error'
  controls: Record<string, ControlFeedback>
  error?: string
}
