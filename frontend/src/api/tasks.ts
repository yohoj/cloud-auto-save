import client from './client'
import type { ApiResult } from './types'

export interface TaskAccount {
  username: string
  cloudType: 'cloud189' | 'quark'
}

export interface Task {
  id: number
  accountId: number
  account?: TaskAccount
  shareLink: string
  resourceName?: string
  shareFolderName?: string
  shareFolderId?: string
  realFolderId?: string
  realFolderName?: string
  currentEpisodes: number
  totalEpisodes: number
  lastFileUpdateTime?: string | null
  remark?: string
  status: string
  enableCron: boolean
  cronExpression?: string
  accessCode?: string
  matchPattern?: string
  matchOperator?: string
  matchValue?: string
  sourceRegex?: string
  targetRegex?: string
  enableTaskScraper?: boolean
}

export interface UpdateTaskPayload {
  accountId?: number
  shareLink?: string
  accessCode?: string
  resourceName?: string
  realFolderId?: string
  realFolderName?: string
  currentEpisodes?: number
  totalEpisodes?: number
  status?: string
  shareFolderId?: string
  shareFolderName?: string
  matchPattern?: string
  matchOperator?: string
  matchValue?: string
  remark?: string
  enableCron?: boolean
  cronExpression?: string
  enableTaskScraper?: boolean
}

export interface ShareFolder {
  id: string
  name: string
  folderName?: string
  path?: string
  isParent?: boolean
}

export interface CreateTaskPayload {
  accountId: number | string
  shareLink: string
  taskName: string
  targetFolderId: string
  targetFolder?: string
  accessCode?: string
  totalEpisodes?: string | number
  matchPattern?: string
  matchOperator?: string
  matchValue?: string
  overwriteFolder?: number
  remark?: string
  enableCron?: boolean
  cronExpression?: string
  sourceRegex?: string
  targetRegex?: string
  enableTaskScraper?: boolean
  selectedFolders?: string[]
}

export function getTasks(params: { status?: string; search?: string } = {}) {
  return client.get<ApiResult<Task[]>>('/api/tasks', { params }).then((r) => r.data.data ?? [])
}

export function createTask(payload: CreateTaskPayload) {
  return client.post<ApiResult<Task[]>>('/api/tasks', payload).then((r) => r.data)
}

export function updateTask(id: number, payload: UpdateTaskPayload) {
  return client.put<ApiResult<Task>>(`/api/tasks/${id}`, payload).then((r) => r.data)
}

// /api/share/parse 解析失败时后端返回 500，这里归一化为 { success:false, error }
export function parseShare(shareLink: string, accessCode: string, accountId: number | string) {
  return client
    .post<ApiResult<ShareFolder[]>>(
      '/api/share/parse',
      { shareLink, accessCode, accountId },
      { skipErrorToast: true }
    )
    .then((r) => r.data)
    .catch(
      (e): ApiResult<ShareFolder[]> => ({
        success: false,
        error: e?.response?.data?.error || e?.message || '解析失败'
      })
    )
}

export function executeTask(id: number) {
  return client.post<ApiResult>(`/api/tasks/${id}/execute`).then((r) => r.data)
}

export function executeAllTasks() {
  return client.post<ApiResult>('/api/tasks/executeAll').then((r) => r.data)
}

export function deleteTask(id: number, deleteCloud: boolean) {
  return client.delete<ApiResult>(`/api/tasks/${id}`, { data: { deleteCloud } }).then((r) => r.data)
}

export function batchDeleteTasks(taskIds: number[], deleteCloud: boolean) {
  return client
    .delete<ApiResult>('/api/tasks/batch', { data: { taskIds, deleteCloud } })
    .then((r) => r.data)
}

export function generateStrm(taskIds: number[], overwrite: boolean) {
  return client.post<ApiResult>('/api/tasks/strm', { taskIds, overwrite }).then((r) => r.data)
}
