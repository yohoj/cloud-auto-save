<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, MagicStick, EditPen } from '@element-plus/icons-vue'
import {
  getFolderFiles,
  deleteFiles,
  renameFiles,
  aiRename,
  type CloudFile,
  type RenameItem
} from '@/api/files'
import { formatBytes } from '@/utils/format'
import type { Task } from '@/api/tasks'

const emit = defineEmits<{ changed: [] }>()

const visible = ref(false)
const loading = ref(false)
const files = ref<CloudFile[]>([])
const selected = ref<CloudFile[]>([])
let task: Task | null = null

const regexDialog = reactive({ visible: false, sourceRegex: '', targetRegex: '', autoUpdate: false })
const preview = reactive<{ visible: boolean; items: RenameItem[]; autoUpdate: boolean }>({
  visible: false,
  items: [],
  autoUpdate: false
})
const submitting = ref(false)

function fileName(f: CloudFile) {
  return f.name || f.fileName || ''
}
function displayName(f: CloudFile) {
  return f.displayName || f.relativePath || fileName(f)
}

async function open(t: Task) {
  task = t
  files.value = []
  selected.value = []
  visible.value = true
  await load()
}
defineExpose({ open })

async function load() {
  if (!task) return
  loading.value = true
  try {
    const res = await getFolderFiles(task.accountId, task.id)
    if (res.success) files.value = res.data ?? []
    else ElMessage.error(res.error || '获取文件列表失败')
  } finally {
    loading.value = false
  }
}

function ensureSelected(): boolean {
  if (!selected.value.length) {
    ElMessage.warning('请先选择文件')
    return false
  }
  return true
}

async function onDelete() {
  if (!ensureSelected() || !task) return
  try {
    await ElMessageBox.confirm('确定删除选中的文件吗？若有对应 STRM 会同步删除。', '删除文件', {
      type: 'warning'
    })
  } catch {
    return
  }
  const payload = selected.value.map((f) => ({
    id: f.id,
    name: fileName(f),
    relativeDir: f.relativeDir || ''
  }))
  const res = await deleteFiles(task.id, payload)
  if (res.success) {
    ElMessage.success('删除成功')
    emit('changed')
    await load()
  } else {
    ElMessage.error('删除失败：' + (res.error || ''))
  }
}

function openRegexRename() {
  if (!ensureSelected()) return
  regexDialog.sourceRegex = task?.sourceRegex || ''
  regexDialog.targetRegex = task?.targetRegex || ''
  regexDialog.autoUpdate = false
  regexDialog.visible = true
}

function buildRegexPreview() {
  let re: RegExp
  try {
    re = new RegExp(regexDialog.sourceRegex)
  } catch {
    ElMessage.error('源正则表达式无效')
    return
  }
  const items = selected.value
    .map((f): RenameItem | null => {
      const name = fileName(f)
      const dest = name.replace(re, regexDialog.targetRegex)
      return dest !== name
        ? {
            fileId: f.id,
            oldName: name,
            oldDisplayName: displayName(f),
            relativeDir: f.relativeDir || '',
            destFileName: dest
          }
        : null
    })
    .filter((x): x is RenameItem => x !== null)
  if (!items.length) {
    ElMessage.warning('没有文件匹配该正则')
    return
  }
  regexDialog.visible = false
  preview.items = items
  preview.autoUpdate = regexDialog.autoUpdate
  preview.visible = true
}

async function openAIRename() {
  if (!ensureSelected() || !task) return
  loading.value = true
  try {
    const res = await aiRename(
      task.id,
      selected.value.map((f) => ({
        id: f.id,
        name: fileName(f),
        displayName: displayName(f),
        relativeDir: f.relativeDir || ''
      }))
    )
    if (res.success && res.data?.length) {
      preview.items = res.data
      preview.autoUpdate = false
      preview.visible = true
    } else {
      ElMessage.warning('AI 分析失败：' + (res.error || '无结果'))
    }
  } finally {
    loading.value = false
  }
}

async function submitPreview() {
  if (!task || !preview.items.length) return
  submitting.value = true
  try {
    const res = await renameFiles(
      task.id,
      task.accountId,
      preview.items,
      preview.autoUpdate ? regexDialog.sourceRegex : null,
      preview.autoUpdate ? regexDialog.targetRegex : null
    )
    if (res.success) {
      const failed = res.data ?? []
      if (failed.length) ElMessage.warning('部分文件重命名失败：' + failed.join(', '))
      else ElMessage.success('重命名成功')
      preview.visible = false
      emit('changed')
      await load()
    } else {
      ElMessage.error('重命名失败：' + (res.error || ''))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="文件列表" width="760px" top="6vh">
    <div class="fl-toolbar">
      <el-button :icon="EditPen" :disabled="!selected.length" @click="openRegexRename">批量重命名</el-button>
      <el-button :icon="MagicStick" :disabled="!selected.length" @click="openAIRename">AI 重命名</el-button>
      <el-button type="danger" :icon="Delete" :disabled="!selected.length" @click="onDelete">批量删除</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="files"
      height="420"
      border
      size="small"
      @selection-change="(rows: CloudFile[]) => (selected = rows)"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column label="文件名" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">{{ displayName(row) }}</template>
      </el-table-column>
      <el-table-column label="大小" width="110" align="right">
        <template #default="{ row }">{{ formatBytes(row.size) }}</template>
      </el-table-column>
      <el-table-column label="修改时间" width="170" align="center">
        <template #default="{ row }">{{ row.lastOpTime || '' }}</template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>

    <!-- 正则重命名选项 -->
    <el-dialog v-model="regexDialog.visible" title="批量重命名（正则）" width="520px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="源正则">
          <el-input v-model="regexDialog.sourceRegex" placeholder="匹配原文件名的正则" />
        </el-form-item>
        <el-form-item label="目标格式">
          <el-input v-model="regexDialog.targetRegex" placeholder="替换为，可用 $1 等捕获组" />
        </el-form-item>
        <el-form-item label="自动更新">
          <el-switch v-model="regexDialog.autoUpdate" />
          <span class="fl-hint">开启后保存该正则，后续新增文件自动重命名</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="regexDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="buildRegexPreview">预览</el-button>
      </template>
    </el-dialog>

    <!-- 重命名预览 -->
    <el-dialog v-model="preview.visible" title="重命名预览" width="700px" append-to-body>
      <el-table :data="preview.items" height="380" border size="small">
        <el-table-column label="原文件名" show-overflow-tooltip>
          <template #default="{ row }">{{ row.oldDisplayName || row.oldName }}</template>
        </el-table-column>
        <el-table-column label="新文件名" show-overflow-tooltip>
          <template #default="{ row }">{{ row.destFileName }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="preview.visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitPreview">确定重命名</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<style scoped>
.fl-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.fl-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
