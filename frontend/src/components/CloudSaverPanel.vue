<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { cloudSaverSearch, type CloudSaverResult } from '@/api/misc'
import { useTasksStore } from '@/stores/tasks'
import { getShareCloudType } from '@/utils/share'

const visible = ref(false)
const keyword = ref('')
const loading = ref(false)
const results = ref<CloudSaverResult[]>([])
const selectedIndex = ref(-1)
const router = useRouter()
const tasksStore = useTasksStore()

function open() {
  visible.value = true
}
defineExpose({ open })

function linkOf(r: CloudSaverResult): string {
  const cl = r.cloudLinks?.[0]
  return typeof cl === 'string' ? cl : cl?.link || ''
}
function typeLabel(r: CloudSaverResult): string {
  const cl = r.cloudLinks?.[0]
  const t =
    r.cloudType ||
    (typeof cl === 'object' ? cl?.cloudType : '') ||
    getShareCloudType(linkOf(r))
  return t === 'quark' ? '夸克' : '天翼'
}

async function search() {
  if (!keyword.value.trim()) {
    ElMessage.warning('请输入搜索关键字')
    return
  }
  loading.value = true
  selectedIndex.value = -1
  try {
    const res = await cloudSaverSearch(keyword.value.trim())
    if (res.success) results.value = res.data ?? []
    else ElMessage.error(res.error || '搜索失败')
  } catch (e) {
    ElMessage.error('搜索失败：' + (e instanceof Error ? e.message : ''))
  } finally {
    loading.value = false
  }
}

function openLink(r: CloudSaverResult) {
  const l = linkOf(r)
  if (l) window.open(l, '_blank')
}

function createTask(r: CloudSaverResult) {
  const l = linkOf(r)
  if (!l) {
    ElMessage.warning('该资源无可用链接')
    return
  }
  tasksStore.pendingShareLink = l
  visible.value = false
  router.push('/tasks')
}
</script>

<template>
  <el-dialog v-model="visible" title="CloudSaver 资源搜索" width="600px" top="6vh">
    <div class="cs-search">
      <el-input
        v-model="keyword"
        placeholder="输入关键字搜索资源"
        clearable
        @keyup.enter="search"
      />
      <el-button type="primary" :icon="Search" :loading="loading" @click="search">搜索</el-button>
    </div>

    <div v-loading="loading" class="cs-results">
      <el-empty v-if="!results.length" description="暂无结果" />
      <div
        v-for="(r, i) in results"
        :key="i"
        class="cs-item"
        :class="{ active: selectedIndex === i }"
        @click="selectedIndex = i"
      >
        <el-tag :type="typeLabel(r) === '夸克' ? 'warning' : 'primary'" size="small" effect="plain">
          {{ typeLabel(r) }}
        </el-tag>
        <span class="cs-title">{{ r.title }}</span>
        <div class="cs-actions">
          <el-button size="small" text @click.stop="openLink(r)">打开</el-button>
          <el-button size="small" type="primary" text @click.stop="createTask(r)">创建任务</el-button>
        </div>
      </div>
    </div>
    <p class="cs-credit">资源来自 CloudSaver，请确保已在「媒体设置」配置 CloudSaver 服务。</p>
  </el-dialog>
</template>

<style scoped>
.cs-search {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.cs-results {
  min-height: 200px;
  max-height: 440px;
  overflow: auto;
}
.cs-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.cs-item:hover,
.cs-item.active {
  background: var(--el-fill-color-light);
}
.cs-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cs-actions {
  flex-shrink: 0;
}
.cs-credit {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
