// 后端统一响应格式：所有路由返回 { success, error?, code?, data? }
export interface ApiResult<T = unknown> {
  success: boolean
  error?: string
  code?: string
  data?: T
}
