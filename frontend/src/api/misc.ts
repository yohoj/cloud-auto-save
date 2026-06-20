import client from './client'
import type { ApiResult } from './types'

export interface VersionInfo {
  version: string
}

// /api/version 需要鉴权，被用作首屏登录态探测：
// skipAuthHandler 让 401 不触发拦截器的自动跳转，由调用方自行判定。
export function getVersion() {
  return client
    .get<VersionInfo>('/api/version', { skipAuthHandler: true, skipErrorToast: true })
    .then((r) => r.data)
}

// AI 聊天：发送消息，回复通过 /api/logs/events 的 aimessage 事件流式返回
export function sendChat(message: string) {
  return client.post<ApiResult>('/api/chat', { message }).then((r) => r.data)
}

export interface CloudSaverResult {
  title: string
  cloudType?: string
  cloudLinks?: (string | { link?: string; cloudType?: string })[]
}

export function cloudSaverSearch(keyword: string) {
  return client
    .get<ApiResult<CloudSaverResult[]>>('/api/cloudsaver/search', {
      params: { keyword },
      skipErrorToast: true
    })
    .then((r) => r.data)
}

// 批量生成 STRM（按账号）
export function generateAllStrm(accountIds: (number | string)[], overwrite: boolean) {
  return client
    .post<ApiResult<string>>('/api/strm/generate-all', { accountIds, overwrite })
    .then((r) => r.data)
}
