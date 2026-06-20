import client from './client'
import type { ApiResult } from './types'

export interface CloudFile {
  id: string
  name?: string
  fileName?: string
  displayName?: string
  relativePath?: string
  relativeDir?: string
  size?: number
  lastOpTime?: string
}

export interface RenameItem {
  fileId: string
  oldName: string
  oldDisplayName?: string
  displayName?: string
  relativeDir?: string
  destFileName: string
}

export function getFolderFiles(accountId: number | string, taskId: number | string) {
  return client
    .get<ApiResult<CloudFile[]>>('/api/folder/files', { params: { accountId, taskId } })
    .then((r) => r.data)
}

export function deleteFiles(
  taskId: number | string,
  files: { id: string; name: string; relativeDir?: string }[]
) {
  return client.delete<ApiResult>('/api/tasks/files', { data: { taskId, files } }).then((r) => r.data)
}

// 返回 data 为失败文件名数组（空数组表示全部成功）
export function renameFiles(
  taskId: number | string,
  accountId: number | string,
  files: RenameItem[],
  sourceRegex: string | null = null,
  targetRegex: string | null = null
) {
  return client
    .post<ApiResult<string[]>>('/api/files/rename', { taskId, accountId, files, sourceRegex, targetRegex })
    .then((r) => r.data)
}

// AI 分析，返回重命名预览列表
export function aiRename(taskId: number | string, files: { id: string; name: string; displayName?: string; relativeDir?: string }[]) {
  return client.post<ApiResult<RenameItem[]>>('/api/files/ai-rename', { taskId, files }).then((r) => r.data)
}
