import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  LogEntry,
  RuntimeState,
  TransportState,
} from '../../shared/protocol'
export const useRuntimeStore = defineStore('runtime', () => {
  const connected = ref(false)
  const logs = ref<(LogEntry & { time: string })[]>([])
  const transport = ref<TransportState>({
    playing: false,
    recording: false,
    holding: false,
    tick: 0,
    rate: 1,
    followFactor: 1,
    perfTime: 0,
  })
  const state = ref<RuntimeState>({
    activeSceneId: null,
    registers: Array(8).fill(false),
    armedCueId: null,
    pendingActions: [],
    expectedNext: null,
    clips: {},
    effective: { zones: [], patch: [] },
  })
  function log(entry: LogEntry): void {
    logs.value = [
      ...logs.value.slice(-499),
      { ...entry, time: new Date().toLocaleTimeString() },
    ]
  }
  return { connected, logs, transport, state, log }
})
