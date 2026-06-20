import client from './client'
import type { ApiResult } from './types'

export interface CustomPushField {
  type: 'string' | 'json' | 'header'
  key: string
  value: string
}

export interface CustomPushConfig {
  name: string
  description?: string
  url: string
  method: string
  contentType: string
  enabled: boolean
  fields: CustomPushField[]
}

export interface AppConfig {
  task: {
    taskExpireDays: number
    taskCheckCron: string
    cleanRecycleCron: string
    maxRetries: number
    retryInterval: number
    enableAutoClearRecycle: boolean
    enableAutoClearFamilyRecycle: boolean
    mediaSuffix: string
    enableOnlySaveMedia: boolean
    enableAutoCreateFolder: boolean
  }
  wecom: { enable: boolean; webhook: string }
  telegram: {
    enable: boolean
    proxyDomain: string
    botToken: string
    chatId: string
    bot: { enable: boolean; botToken: string; chatId: string }
  }
  wxpusher: { enable: boolean; spt: string }
  proxy: {
    host: string
    port: number
    username: string
    password: string
    services: { telegram: boolean; tmdb: boolean; openai: boolean; quark: boolean; customPush: boolean }
  }
  bark: { enable: boolean; serverUrl: string; key: string }
  pushplus: { enable: boolean; token: string; topic: string; channel: string; webhook: string; to: string }
  smartStrm: { enable: boolean; webhook: string; taskMapping: string }
  fntv: {
    enable: boolean
    base_url: string
    username: string
    password: string
    secret_string: string
    api_key: string
    mdb_mapping: string
  }
  system: { username: string; password: string; baseUrl: string; apiKey: string; corsOrigins: string }
  strm: { enable: boolean }
  emby: { enable: boolean; serverUrl: string; apiKey: string }
  cloudSaver: { baseUrl: string; username: string; password: string }
  tmdb: { enableScraper: boolean; apiKey: string; tmdbApiKey: string }
  openai: {
    enable: boolean
    baseUrl: string
    apiKey: string
    model: string
    rename: { template: string; movieTemplate: string }
  }
  alist: { enable: boolean; baseUrl: string; apiKey: string }
  customPush: CustomPushConfig[]
}

export function getSettings() {
  return client.get<ApiResult<AppConfig>>('/api/settings').then((r) => r.data.data)
}

// 通用设置（任务/通知/代理/系统）
export function saveGeneralSettings(payload: Partial<AppConfig>) {
  return client.post<ApiResult>('/api/settings', payload).then((r) => r.data)
}

// 媒体设置（strm/emby/tmdb/openai/alist/fntv/cloudSaver）
export function saveMediaSettings(payload: Partial<AppConfig>) {
  return client.post<ApiResult>('/api/settings/media', payload).then((r) => r.data)
}

export function testFntv() {
  return client.post<ApiResult<string>>('/api/fntv/test').then((r) => r.data)
}

export function testCustomPush(config: CustomPushConfig) {
  return client.post<ApiResult>('/api/custom-push/test', config).then((r) => r.data)
}
