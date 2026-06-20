/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// 给 axios 请求配置扩展自定义开关：跳过 401 自动处理 / 跳过错误提示
import 'axios'
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipAuthHandler?: boolean
    skipErrorToast?: boolean
  }
}
