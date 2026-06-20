import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { getTasks, type Task } from '@/api/tasks'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const loading = ref(false)
  const filter = reactive({ status: 'all', search: '' })
  // CloudSaver「创建任务」跨页面传递分享链接
  const pendingShareLink = ref('')

  async function fetch() {
    loading.value = true
    try {
      tasks.value = await getTasks({ status: filter.status, search: filter.search })
    } finally {
      loading.value = false
    }
  }

  return { tasks, loading, filter, pendingShareLink, fetch }
})
