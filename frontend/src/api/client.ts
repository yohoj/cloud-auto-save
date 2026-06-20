import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

// 同源调用：dev 经 Vite 代理到 :3000，prod 与后端同源。
// withCredentials 携带 express-session 的 cookie。
const client = axios.create({
  baseURL: '/',
  withCredentials: true,
  timeout: 30000
})

// 请求拦截：可选注入 x-api-key（headless / API 直连场景）
client.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem('apiKey')
  if (apiKey) {
    config.headers.set('x-api-key', apiKey)
  }
  return config
})

// 响应拦截：401 → 标记未登录并跳登录页；其余错误统一 toast
client.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status
    if (status === 401 && !error.config?.skipAuthHandler) {
      // 延迟取用 store，规避 client ↔ store 的循环依赖在模块求值期触发
      useAuthStore().isAuthenticated = false
      if (router.currentRoute.value.meta.public !== true) {
        void router.push({ name: 'login' })
      }
    } else if (!error.config?.skipErrorToast) {
      const msg = error.response?.data?.error || error.message || '请求失败'
      ElMessage.error(msg)
    }
    return Promise.reject(error)
  }
)

export default client
