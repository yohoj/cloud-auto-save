import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createLogStream, type LogStream } from '@/api/sse'

const MAX_LOGS = 1000

export const useLogsStore = defineStore('logs', () => {
  const logs = ref<string[]>([])
  const connected = ref(false)
  let stream: LogStream | null = null

  function append(line: string) {
    logs.value.push(line)
    if (logs.value.length > MAX_LOGS) {
      logs.value.splice(0, logs.value.length - MAX_LOGS)
    }
  }

  function connect() {
    if (stream) return
    stream = createLogStream({
      onHistory: (lines) => {
        logs.value = lines.slice(-MAX_LOGS)
      },
      onLog: (msg) => append(msg),
      onOpen: () => {
        connected.value = true
      },
      onError: () => {
        connected.value = false
      }
    })
  }

  function disconnect() {
    stream?.close()
    stream = null
    connected.value = false
  }

  function clear() {
    logs.value = []
  }

  return { logs, connected, connect, disconnect, clear }
})
