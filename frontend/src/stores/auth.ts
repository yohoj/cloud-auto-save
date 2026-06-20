import { defineStore } from 'pinia'
import { ref } from 'vue'
import { login as apiLogin, logout as apiLogout } from '@/api/auth'
import { getVersion } from '@/api/misc'

export const useAuthStore = defineStore('auth', () => {
  const isAuthenticated = ref(false)
  const username = ref('')
  const version = ref('')

  // 探测登录态：/api/version 200 视为已登录，401 视为未登录
  async function checkAuth(): Promise<boolean> {
    try {
      const info = await getVersion()
      version.value = info.version
      isAuthenticated.value = true
    } catch {
      isAuthenticated.value = false
    }
    return isAuthenticated.value
  }

  async function login(user: string, password: string) {
    const res = await apiLogin(user, password)
    if (res.success) {
      isAuthenticated.value = true
      username.value = user
      // 登录成功后补取版本号
      void getVersion()
        .then((info) => (version.value = info.version))
        .catch(() => undefined)
    }
    return res
  }

  async function logout() {
    try {
      await apiLogout()
    } catch {
      /* 即便后端登出失败也清理前端态 */
    }
    isAuthenticated.value = false
    username.value = ''
  }

  return { isAuthenticated, username, version, checkAuth, login, logout }
})
