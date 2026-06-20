import client from './client'

export interface CapacityInfo {
  usedSize?: number
  totalSize?: number
  freeSize?: number
}

export interface Account {
  id: number
  username: string // 脱敏后的用户名（用于展示）
  original_username: string // 真实用户名（用于提交/去重）
  cloudType: 'cloud189' | 'quark'
  alias: string
  isDefault: boolean
  isActive: boolean
  localStrmPrefix: string
  cloudStrmPrefix: string
  embyPathReplace: string
  capacity?: {
    cloudCapacityInfo: CapacityInfo | null
    familyCapacityInfo: CapacityInfo | null
  }
}

export interface CreateAccountPayload {
  id?: number
  cloudType: string
  username: string
  password?: string
  cookies?: string
  qrLoginId?: string
  alias?: string
  validateCode?: string
  captchaId?: string
  cloudStrmPrefix?: string
  localStrmPrefix?: string
  embyPathReplace?: string
}

export interface ApiResult<T = unknown> {
  success: boolean
  error?: string
  code?: string
  data?: T
}

export interface CaptchaData {
  captchaUrl: string
  captchaId?: string
}

export interface QrcodeData {
  qrId: string
  uuid: string
  expiresIn: number
  imageUrl: string
}

export interface QrPollData {
  status: 'waiting' | 'scanned' | 'success' | 'expired'
  qrLoginId?: string
  username?: string
}

export function getAccounts() {
  return client.get<ApiResult<Account[]>>('/api/accounts').then((r) => r.data.data ?? [])
}

export function createAccount(payload: CreateAccountPayload) {
  return client.post<ApiResult<CaptchaData>>('/api/accounts', payload).then((r) => r.data)
}

export function getQrcode() {
  return client.post<ApiResult<QrcodeData>>('/api/accounts/cloud189/qrcode').then((r) => r.data)
}

export function pollQrcode(qrId: string) {
  return client
    .get<ApiResult<QrPollData>>(`/api/accounts/cloud189/qrcode/${qrId}`)
    .then((r) => r.data)
}

export function deleteAccount(id: number) {
  return client.delete<ApiResult>(`/api/accounts/${id}`).then((r) => r.data)
}

export function clearRecycle() {
  return client.delete<ApiResult>('/api/accounts/recycle').then((r) => r.data)
}

export function updateStrmPrefix(id: number, strmPrefix: string, type: 'local' | 'cloud' | 'emby') {
  return client.put<ApiResult>(`/api/accounts/${id}/strm-prefix`, { strmPrefix, type }).then((r) => r.data)
}

export function updateAlias(id: number, alias: string) {
  return client.put<ApiResult>(`/api/accounts/${id}/alias`, { alias }).then((r) => r.data)
}

export function setDefault(id: number) {
  return client.put<ApiResult>(`/api/accounts/${id}/default`).then((r) => r.data)
}
