<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Delete, VideoPlay, Edit, Film } from '@element-plus/icons-vue'
import { useTasksStore } from '@/stores/tasks'
import {
  executeTask,
  executeAllTasks,
  deleteTask,
  batchDeleteTasks,
  generateStrm,
  type Task
} from '@/api/tasks'
import { formatDateTime } from '@/utils/format'
import { useBreakpoints } from '@/composables/useBreakpoints'
import CreateTaskDialog from '@/components/CreateTaskDialog.vue'
import EditTaskDialog from '@/components/EditTaskDialog.vue'
import FileListDialog from '@/components/FileListDialog.vue'

const store = useTasksStore()
const { isMobile } = useBreakpoints()
const createDialogRef = ref<InstanceType<typeof CreateTaskDialog>>()
const editDialogRef = ref<InstanceType<typeof EditTaskDialog>>()
const fileListRef = ref<InstanceType<typeof FileListDialog>>()

const STATUS: Record<string, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: '等待中', type: 'info' },
  processing: { label: '追剧中', type: 'warning' },
  completed: { label: '已完结', type: 'success' },
  failed: { label: '失败', type: 'danger' }
}
const statusFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '等待中' },
  { value: 'processing', label: '追剧中' },
  { value: 'completed', label: '已完结' },
  { value: 'failed', label: '失败' }
]

const deleteCloud = ref(false)
const selectedIds = ref<number[]>([])
const executingIds = ref<number[]>([])

function maybeOpenFromPending() {
  if (store.pendingShareLink) {
    const link = store.pendingShareLink
    store.pendingShareLink = ''
    createDialogRef.value?.open(link)
  }
}

onMounted(() => {
  store.fetch()
  maybeOpenFromPending()
})
watch(() => store.pendingShareLink, maybeOpenFromPending)

// 状态筛选立即刷新；搜索做 500ms 防抖（对应旧版 debounce）
watch(
  () => store.filter.status,
  () => store.fetch()
)
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.filter.search,
  () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => store.fetch(), 500)
  }
)

function taskName(t: Task) {
  return t.shareFolderName ? `${t.resourceName || ''}/${t.shareFolderName}` : t.resourceName || '未知'
}
function progress(t: Task) {
  if (!t.totalEpisodes) return 0
  return Math.min(100, Math.round(((t.currentEpisodes || 0) / t.totalEpisodes) * 100))
}

// 选择：桌面端由 el-table 的 selection-change 驱动，移动端由卡片复选框驱动，
// 统一收敛到 selectedIds，批量操作只依赖它。
function onSelectionChange(rows: Task[]) {
  selectedIds.value = rows.map((r) => r.id)
}
function toggleSelect(id: number, checked: boolean) {
  if (checked) selectedIds.value = [...selectedIds.value, id]
  else selectedIds.value = selectedIds.value.filter((x) => x !== id)
}
const selectedCount = computed(() => selectedIds.value.length)

async function onExecute(row: Task) {
  executingIds.value = [...executingIds.value, row.id]
  try {
    const res = await executeTask(row.id)
    if (res.success) {
      ElMessage.success('任务执行完成')
      store.fetch()
    } else {
      ElMessage.warning('任务执行失败：' + (res.error || ''))
    }
  } finally {
    executingIds.value = executingIds.value.filter((id) => id !== row.id)
  }
}

async function onExecuteAll() {
  try {
    await ElMessageBox.confirm('确定要执行所有任务吗？', '执行全部', { type: 'warning' })
  } catch {
    return
  }
  const res = await executeAllTasks()
  if (res.success) ElMessage.success('任务已在后台执行，请稍后查看结果')
  else ElMessage.warning('执行失败：' + (res.error || ''))
}

async function onDelete(row: Task) {
  try {
    await ElMessageBox.confirm(
      deleteCloud.value ? '确定要删除这个任务，并从网盘中一起删除吗？' : '确定要删除这个任务吗？',
      '删除任务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await deleteTask(row.id, deleteCloud.value)
  if (res.success) {
    ElMessage.success('任务删除成功')
    store.fetch()
  } else {
    ElMessage.warning('删除失败：' + (res.error || ''))
  }
}

async function onBatchDelete() {
  if (!selectedIds.value.length) {
    ElMessage.warning('请选择要删除的任务')
    return
  }
  try {
    await ElMessageBox.confirm(
      deleteCloud.value ? '确定要删除选中任务，并从网盘中一起删除吗？' : '确定要删除选中的任务吗？',
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await batchDeleteTasks(selectedIds.value, deleteCloud.value)
  if (res.success) {
    ElMessage.success('批量删除成功')
    store.fetch()
  } else {
    ElMessage.warning('批量删除失败：' + (res.error || ''))
  }
}

async function onGenerateStrm() {
  if (!selectedIds.value.length) {
    ElMessage.warning('请选择要生成 STRM 的任务')
    return
  }
  let overwrite = false
  try {
    await ElMessageBox.confirm('是否覆盖已存在的 STRM 文件？', '生成 STRM', {
      confirmButtonText: '覆盖',
      cancelButtonText: '不覆盖',
      distinguishCancelAndClose: true,
      type: 'info'
    })
    overwrite = true
  } catch (action) {
    if (action === 'close') return // 右上角关闭则取消整个操作
    overwrite = false
  }
  const res = await generateStrm(selectedIds.value, overwrite)
  if (res.success) ElMessage.success('任务后台执行中，请稍后查看结果')
  else ElMessage.warning('生成 STRM 失败：' + (res.error || ''))
}

function onCreate() {
  createDialogRef.value?.open()
}
function onEdit(row: Task) {
  editDialogRef.value?.open(row)
}
function onShowFiles(row: Task) {
  fileListRef.value?.open(row)
}
</script>

<template>
  <div class="tasks-view">
    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="onCreate">新建任务</el-button>
      <el-button :icon="VideoPlay" @click="onExecuteAll">执行全部</el-button>
      <el-button :icon="Film" :disabled="!selectedCount" @click="onGenerateStrm">生成 STRM</el-button>
      <el-button type="danger" :icon="Delete" :disabled="!selectedCount" @click="onBatchDelete">
        批量删除{{ selectedCount ? ` (${selectedCount})` : '' }}
      </el-button>
      <el-checkbox v-model="deleteCloud" class="delete-cloud">同时删除网盘文件</el-checkbox>

      <span class="spacer" />

      <el-select v-model="store.filter.status" style="width: 120px">
        <el-option v-for="o in statusFilterOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-input
        v-model="store.filter.search"
        placeholder="搜索 资源名/备注/账号"
        clearable
        style="width: 220px"
      />
      <el-button text :icon="Refresh" :loading="store.loading" @click="store.fetch()">刷新</el-button>
    </div>

    <!-- 桌面端：表格 -->
    <el-table
      v-if="!isMobile"
      v-loading="store.loading"
      :data="store.tasks"
      border
      stripe
      size="small"
      row-key="id"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="42" />

      <el-table-column label="资源名称" min-width="220">
        <template #default="{ row }">
          <span v-if="row.enableCron" class="cron" title="已开启自定义定时任务">⏰</span>
          <a :href="row.shareLink" target="_blank" rel="noopener" class="ellipsis" :title="taskName(row)">
            {{ taskName(row) }}
          </a>
        </template>
      </el-table-column>

      <el-table-column label="账号" min-width="150">
        <template #default="{ row }">
          <el-tag :type="row.account?.cloudType === 'quark' ? 'warning' : 'primary'" size="small" effect="plain">
            {{ row.account?.cloudType === 'quark' ? '夸克' : '天翼' }}
          </el-tag>
          <span class="account-name">{{ row.account?.username || '' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="更新目录" min-width="160" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="folder-link" title="查看文件列表" @click="onShowFiles(row)">
            {{ row.realFolderName || row.realFolderId || '—' }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="更新数 / 总数" width="150">
        <template #default="{ row }">
          <div class="episodes">
            <span>{{ row.currentEpisodes || 0 }} / {{ row.totalEpisodes || '未知' }}</span>
            <el-progress
              v-if="row.totalEpisodes"
              :percentage="progress(row)"
              :stroke-width="5"
              :show-text="false"
            />
          </div>
        </template>
      </el-table-column>

      <el-table-column label="转存时间" width="150" align="center">
        <template #default="{ row }">{{ formatDateTime(row.lastFileUpdateTime) }}</template>
      </el-table-column>

      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />

      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="STATUS[row.status]?.type || 'info'" size="small">
            {{ STATUS[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="180" fixed="right" align="center">
        <template #default="{ row }">
          <el-button
            size="small"
            type="warning"
            :icon="VideoPlay"
            :loading="executingIds.includes(row.id)"
            @click="onExecute(row)"
          >
            执行
          </el-button>
          <el-button size="small" :icon="Edit" @click="onEdit(row)" />
          <el-button size="small" type="danger" :icon="Delete" @click="onDelete(row)" />
        </template>
      </el-table-column>
    </el-table>

    <!-- 移动端：卡片列表 -->
    <div v-else v-loading="store.loading" class="card-list">
      <el-empty v-if="!store.tasks.length && !store.loading" description="暂无任务" />
      <div v-for="row in store.tasks" :key="row.id" class="data-card">
        <div class="data-card__head">
          <span
            class="data-card__check"
            role="checkbox"
            :aria-checked="selectedIds.includes(row.id)"
            @click="toggleSelect(row.id, !selectedIds.includes(row.id))"
          >
            <el-checkbox :model-value="selectedIds.includes(row.id)" />
          </span>
          <a :href="row.shareLink" target="_blank" rel="noopener" class="data-card__title">
            <span v-if="row.enableCron" class="cron">⏰</span>{{ taskName(row) }}
          </a>
          <el-tag :type="STATUS[row.status]?.type || 'info'" size="small">
            {{ STATUS[row.status]?.label || row.status }}
          </el-tag>
        </div>

        <div class="data-card__row">
          <span class="k">账号</span>
          <span class="v">
            <el-tag :type="row.account?.cloudType === 'quark' ? 'warning' : 'primary'" size="small" effect="plain">
              {{ row.account?.cloudType === 'quark' ? '夸克' : '天翼' }}
            </el-tag>
            <span class="account-name">{{ row.account?.username || '' }}</span>
          </span>
        </div>
        <div class="data-card__row">
          <span class="k">更新目录</span>
          <span class="v folder-link" @click="onShowFiles(row)">
            {{ row.realFolderName || row.realFolderId || '—' }}
          </span>
        </div>
        <div class="data-card__row">
          <span class="k">进度</span>
          <span class="v">
            {{ row.currentEpisodes || 0 }} / {{ row.totalEpisodes || '未知' }}
            <el-progress
              v-if="row.totalEpisodes"
              :percentage="progress(row)"
              :stroke-width="5"
              :show-text="false"
            />
          </span>
        </div>
        <div class="data-card__row">
          <span class="k">转存时间</span>
          <span class="v">{{ formatDateTime(row.lastFileUpdateTime) }}</span>
        </div>
        <div v-if="row.remark" class="data-card__row">
          <span class="k">备注</span>
          <span class="v">{{ row.remark }}</span>
        </div>

        <div class="data-card__actions">
          <el-button
            size="small"
            type="warning"
            :icon="VideoPlay"
            :loading="executingIds.includes(row.id)"
            @click="onExecute(row)"
          >
            执行
          </el-button>
          <el-button size="small" :icon="Edit" @click="onEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" :icon="Delete" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
    </div>

    <CreateTaskDialog ref="createDialogRef" @saved="store.fetch()" />
    <EditTaskDialog ref="editDialogRef" @saved="store.fetch()" />
    <FileListDialog ref="fileListRef" @changed="store.fetch()" />
  </div>
</template>

<style scoped>
.delete-cloud {
  margin-left: 4px;
}
.cron {
  margin-right: 4px;
}
.account-name {
  margin-left: 6px;
}
.ellipsis {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--el-color-primary);
  text-decoration: none;
}
.ellipsis:hover {
  text-decoration: underline;
}
.episodes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.folder-link {
  color: var(--el-color-primary);
  cursor: pointer;
}
.folder-link:hover {
  text-decoration: underline;
}
.data-card__title {
  color: var(--el-color-primary);
  text-decoration: none;
  padding: 6px 0;
}
/* selection: the wrapper is the tap target; the checkbox is display-only,
   so taps near the title never accidentally toggle selection (and vice-versa). */
.data-card__check {
  display: inline-flex;
  align-items: center;
  margin: -8px 4px -8px -8px;
  padding: 8px;
  cursor: pointer;
}
.data-card__check :deep(.el-checkbox) {
  pointer-events: none;
  height: auto;
  margin-right: 0;
}
</style>
