<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderAdd } from '@element-plus/icons-vue'
import { getFolderNodes, createFolder, type FolderNode } from '@/api/folders'

type PickResult = { id: string; name: string; path: string }
type LoadFn = (folderId: string) => Promise<FolderNode[]>
interface OpenOptions {
  title?: string
  enableCreate?: boolean
  load?: LoadFn
}

const visible = ref(false)
const accountId = ref<number | string>('')
const title = ref('选择目录')
const enableCreate = ref(true)
const treeRef = ref<{ getNode: (key: string) => unknown } | null>(null)
const treeKey = ref(0)
const selected = ref<FolderNode | null>(null)
let resolver: ((v: PickResult | null) => void) | null = null
let loadFn: LoadFn = (folderId) =>
  getFolderNodes(accountId.value, folderId).then((r) => (r.success ? r.data ?? [] : []))

const treeProps = {
  isLeaf: (data: FolderNode) => Boolean(data.isFile || data.disableExpand),
  label: 'name'
}

function open(accId: number | string, opts: OpenOptions = {}) {
  accountId.value = accId
  title.value = opts.title ?? '选择目录'
  enableCreate.value = opts.enableCreate ?? true
  loadFn =
    opts.load ??
    ((folderId) => getFolderNodes(accId, folderId).then((r) => (r.success ? r.data ?? [] : [])))
  selected.value = null
  treeKey.value++
  visible.value = true
  return new Promise<PickResult | null>((resolve) => {
    resolver = resolve
  })
}
defineExpose({ open })

async function loadNode(node: { level: number; data: FolderNode }, resolve: (data: FolderNode[]) => void) {
  const folderId = node.level === 0 ? '-11' : String(node.data.id)
  try {
    resolve(await loadFn(folderId))
  } catch {
    resolve([])
  }
}

function onNodeClick(data: FolderNode) {
  selected.value = data
}

function buildPath(): string {
  if (!selected.value) return ''
  const node = treeRef.value?.getNode(selected.value.id) as
    | { level: number; data: FolderNode; parent?: unknown }
    | undefined
  if (!node) return selected.value.name
  const parts: string[] = []
  let cur: { level: number; data: FolderNode; parent?: unknown } | undefined = node
  while (cur && cur.level > 0) {
    parts.unshift(cur.data.name)
    cur = cur.parent as typeof cur
  }
  return parts.join('/')
}

function settle(result: PickResult | null) {
  resolver?.(result)
  resolver = null
  visible.value = false
}

function confirm() {
  if (!selected.value) {
    ElMessage.warning('请选择一个目录')
    return
  }
  settle({ id: String(selected.value.id), name: selected.value.name, path: buildPath() })
}

async function onCreateFolder() {
  const parentId = selected.value ? String(selected.value.id) : '-11'
  let name: string
  try {
    const r = await ElMessageBox.prompt('文件夹名称', '新建文件夹', {
      confirmButtonText: '创建',
      cancelButtonText: '取消'
    })
    name = (r.value || '').trim()
  } catch {
    return
  }
  if (!name) return
  const res = await createFolder(accountId.value, parentId, name)
  if (!res.success) {
    ElMessage.error('创建失败：' + (res.error || ''))
    return
  }
  ElMessage.success('创建成功')
  treeKey.value++
  selected.value = null
}
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="480px" append-to-body @closed="settle(null)">
    <div class="ft-toolbar">
      <el-button v-if="enableCreate" size="small" :icon="FolderAdd" @click="onCreateFolder">
        在{{ selected ? `「${selected.name}」下` : '根目录' }}新建文件夹
      </el-button>
      <span class="ft-hint">点目录名选择，点箭头展开</span>
    </div>
    <el-tree
      :key="treeKey"
      ref="treeRef"
      class="ft-tree"
      lazy
      :load="loadNode"
      :props="treeProps"
      node-key="id"
      highlight-current
      @node-click="onNodeClick"
    />
    <template #footer>
      <span class="ft-path">已选：{{ selected ? buildPath() || selected.name : '未选择' }}</span>
      <el-button @click="settle(null)">取消</el-button>
      <el-button type="primary" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ft-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.ft-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ft-tree {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 6px;
}
.ft-path {
  float: left;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 32px;
}
</style>
