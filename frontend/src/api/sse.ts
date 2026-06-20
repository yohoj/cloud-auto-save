// 日志 SSE 封装。后端 /api/logs/events 推送三类消息：
//   { type: 'history', logs: string[] }  连接时一次性历史日志
//   { type: 'log', message: string }      新增日志行
//   { type: 'aimessage', message: string } AI 聊天流式片段
// EventSource 同源会自动带上 session cookie（dev 经 Vite 代理）。

export interface LogStreamHandlers {
  onHistory?: (lines: string[]) => void
  onLog?: (message: string) => void
  onAIMessage?: (message: string) => void
  onOpen?: () => void
  onError?: (e: Event) => void
}

export interface LogStream {
  close: () => void
}

export function createLogStream(handlers: LogStreamHandlers): LogStream {
  const es = new EventSource('/api/logs/events', { withCredentials: true })

  es.onopen = () => handlers.onOpen?.()
  es.onerror = (e) => handlers.onError?.(e)
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as {
        type: string
        logs?: string[]
        message?: string
      }
      if (data.type === 'history') handlers.onHistory?.(data.logs ?? [])
      else if (data.type === 'log') handlers.onLog?.(data.message ?? '')
      else if (data.type === 'aimessage') handlers.onAIMessage?.(data.message ?? '')
    } catch {
      /* 忽略无法解析的帧 */
    }
  }

  return { close: () => es.close() }
}
