import client from './client'
import type { ApiResult } from './types'

export interface FolderNode {
  id: string
  name: string
  isFile?: boolean
  isParent?: boolean
  disableExpand?: boolean
  path?: string
}

// 获取目录树节点（懒加载）。folderId 默认 -11（天翼根；后端会把夸克的 -11 转成 0）
export function getFolderNodes(accountId: number | string, folderId = '-11', refresh = false) {
  return client
    .get<ApiResult<FolderNode[]>>(`/api/folders/${accountId}`, {
      params: { folderId, ...(refresh ? { refresh: 'true' } : {}) }
    })
    .then((r) => r.data)
}

export function createFolder(accountId: number | string, parentFolderId: string, folderName: string) {
  return client
    .post<ApiResult<FolderNode>>(`/api/folders/${accountId}`, { parentFolderId, folderName })
    .then((r) => r.data)
}

// 分享目录树（编辑任务时选择源目录）。后端解析失败返回 500，这里归一化。
export function getShareFolders(params: {
  accountId: number | string
  folderId: string
  taskId?: number | string
  shareLink?: string
  accessCode?: string
  refresh?: boolean
}) {
  const { accountId, ...query } = params
  return client
    .get<ApiResult<FolderNode[]>>(`/api/share/folders/${accountId}`, {
      params: query,
      skipErrorToast: true
    })
    .then((r) => r.data)
    .catch(
      (e): ApiResult<FolderNode[]> => ({
        success: false,
        error: e?.response?.data?.error || e?.message || '获取分享目录失败'
      })
    )
}
