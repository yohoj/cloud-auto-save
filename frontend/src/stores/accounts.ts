import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAccounts, type Account } from '@/api/accounts'

// 账号列表为跨页面共享状态（任务页的账号下拉也会复用）。
// 仅承载列表与拉取；增删改由组件直接调 api/accounts 后回调 fetch() 刷新。
export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const loading = ref(false)
  let loaded = false

  async function fetch() {
    loading.value = true
    try {
      accounts.value = await getAccounts()
      loaded = true
    } finally {
      loading.value = false
    }
  }

  // 首次访问时按需加载（避免每个页面重复请求慢接口）
  async function ensure() {
    if (!loaded) await fetch()
  }

  return { accounts, loading, fetch, ensure }
})
