<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderOpened } from '@element-plus/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import { updateTask, type Task } from '@/api/tasks'
import { getShareFolders } from '@/api/folders'
import { parseCloudShare, getShareCloudType } from '@/utils/share'
import FolderTreeDialog from './FolderTreeDialog.vue'

const emit = defineEmits<{ saved: [] }>()

const accountsStore = useAccountsStore()
const targetDialogRef = ref<InstanceType<typeof FolderTreeDialog>>()
const shareDialogRef = ref<InstanceType<typeof FolderTreeDialog>>()

const visible = ref(false)
const submitting = ref(false)

const statusOptions = [
  { value: 'pending', label: '等待中' },
  { value: 'processing', label: '追剧中' },
  { value: 'completed', label: '已完结' },
  { value: 'failed', label: '失败' }
]
const matchOperators = [
  { value: '', label: '不限' },
  { value: 'lt', label: '小于' },
  { value: 'eq', label: '等于' },
  { value: 'gt', label: '大于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' }
]

const form = reactive({
  id: 0,
  accountId: 0 as number,
  shareLink: '',
  accessCode: '',
  resourceName: '',
  realFolderId: '',
  realFolderName: '',
  shareFolderId: '',
  shareFolderName: '',
  currentEpisodes: 0,
  totalEpisodes: 0,
  status: 'pending',
  matchPattern: '',
  matchOperator: '',
  matchValue: '',
  remark: '',
  enableCron: false,
  cronExpression: '',
  enableTaskScraper: false,
  saveSubDir: true
})

// 原始账号/链接，用于切换后判断是否需重选目录
const original = reactive({ accountId: 0, shareLink: '' })

const shareCloudType = computed(() => getShareCloudType(form.shareLink))
const accountOptions = computed(() =>
  accountsStore.accounts
    .filter((a) => !a.original_username?.startsWith('n_'))
    .filter((a) => !shareCloudType.value || a.cloudType === shareCloudType.value)
    .map((a) => ({
      value: a.id,
      label: `${a.cloudType === 'quark' ? '夸克网盘' : '天翼云盘'} - ${a.username}`
    }))
)

watch(shareCloudType, () => {
  if (form.accountId && !accountOptions.value.some((o) => o.value === form.accountId)) {
    form.accountId = accountOptions.value[0]?.value ?? 0
  }
})

// 切换账号/链接后，同步目标目录与源目录（与旧版 syncEditFolders 一致）
watch(
  () => [form.accountId, form.shareLink] as const,
  () => {
    const accountUnchanged = form.accountId === original.accountId
    const linkUnchanged = form.shareLink.trim() === original.shareLink.trim()
    if (!accountUnchanged) {
      form.realFolderId = ''
      form.realFolderName = ''
    }
    if (!(accountUnchanged && linkUnchanged)) {
      form.shareFolderId = ''
      form.shareFolderName = ''
    }
  }
)

async function open(task: Task) {
  await accountsStore.ensure()
  Object.assign(form, {
    id: task.id,
    accountId: task.accountId,
    shareLink: task.shareLink || '',
    accessCode: task.accessCode || '',
    resourceName: task.resourceName || '',
    realFolderId: task.realFolderId || '',
    realFolderName: task.realFolderName || task.realFolderId || '',
    shareFolderId: task.shareFolderId || '',
    shareFolderName: task.shareFolderName || '',
    currentEpisodes: task.currentEpisodes || 0,
    totalEpisodes: task.totalEpisodes || 0,
    status: task.status || 'pending',
    matchPattern: task.matchPattern || '',
    matchOperator: task.matchOperator || '',
    matchValue: task.matchValue || '',
    remark: task.remark || '',
    enableCron: !!task.enableCron,
    cronExpression: task.cronExpression || '',
    enableTaskScraper: !!task.enableTaskScraper,
    saveSubDir: task.saveSubDir !== false
  })
  original.accountId = task.accountId
  original.shareLink = task.shareLink || ''
  visible.value = true
}
defineExpose({ open })

function onShareLinkBlur() {
  const raw = form.shareLink?.trim()
  if (!raw) return
  try {
    const { url, accessCode } = parseCloudShare(decodeURIComponent(raw))
    if (url) form.shareLink = url
    if (accessCode) form.accessCode = accessCode
  } catch {
    /* 保留原文 */
  }
}

async function pickTarget() {
  if (!form.accountId) {
    ElMessage.warning('请先选择账号')
    return
  }
  const r = await targetDialogRef.value?.open(form.accountId)
  if (r) {
    form.realFolderId = r.id
    form.realFolderName = r.path || r.name
  }
}

async function pickShareFolder() {
  if (!form.accountId) {
    ElMessage.warning('请先选择账号')
    return
  }
  const linkChanged = form.shareLink.trim() !== original.shareLink.trim()
  const r = await shareDialogRef.value?.open(form.accountId, {
    title: '选择分享目录',
    enableCreate: false,
    load: (folderId) =>
      getShareFolders({
        accountId: form.accountId,
        taskId: form.id,
        folderId,
        ...(linkChanged ? { shareLink: form.shareLink.trim(), accessCode: form.accessCode.trim() } : {})
      }).then((res) => (res.success ? res.data ?? [] : []))
  })
  if (r) {
    form.shareFolderId = r.id
    form.shareFolderName = r.path || r.name
  }
}

async function submit() {
  if (shareCloudType.value) {
    const acc = accountsStore.accounts.find((a) => a.id === form.accountId)
    if (acc && acc.cloudType !== shareCloudType.value) {
      ElMessage.warning(`${shareCloudType.value === 'quark' ? '夸克' : '天翼'}分享链接只能选择对应网盘账号`)
      return
    }
  }
  if (form.accountId !== original.accountId && !form.realFolderId) {
    ElMessage.warning('切换账号/网盘后请重新选择保存目录')
    return
  }
  submitting.value = true
  try {
    const res = await updateTask(form.id, {
      accountId: form.accountId,
      shareLink: form.shareLink,
      accessCode: form.accessCode,
      resourceName: form.resourceName,
      realFolderId: form.realFolderId,
      realFolderName: form.realFolderName,
      currentEpisodes: Number(form.currentEpisodes) || 0,
      totalEpisodes: Number(form.totalEpisodes) || 0,
      status: form.status,
      matchPattern: form.matchPattern,
      matchOperator: form.matchOperator,
      matchValue: form.matchValue,
      remark: form.remark,
      enableCron: form.enableCron,
      cronExpression: form.cronExpression,
      enableTaskScraper: form.enableTaskScraper,
      saveSubDir: form.saveSubDir,
      // 源目录为空时不下发，由后端默认取新分享根目录
      ...(form.shareFolderId
        ? { shareFolderId: form.shareFolderId, shareFolderName: form.shareFolderName }
        : {})
    })
    if (res.success) {
      ElMessage.success('修改成功')
      visible.value = false
      emit('saved')
    } else {
      ElMessage.error('修改失败：' + (res.error || ''))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="修改任务" width="600px" top="6vh">
    <el-form label-width="92px" @submit.prevent>
      <el-form-item label="分享链接">
        <el-input v-model="form.shareLink" type="textarea" :rows="2" @blur="onShareLinkBlur" />
      </el-form-item>
      <el-form-item label="访问码">
        <el-input v-model="form.accessCode" style="width: 200px" />
      </el-form-item>
      <el-form-item label="账号">
        <el-select v-model="form.accountId" style="width: 100%">
          <el-option v-for="o in accountOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="任务名称">
        <el-input v-model="form.resourceName" />
      </el-form-item>
      <el-form-item label="保存目录">
        <el-input v-model="form.realFolderName" readonly placeholder="点右侧选择">
          <template #append>
            <el-button :icon="FolderOpened" @click="pickTarget">选择</el-button>
          </template>
        </el-input>
      </el-form-item>
      <el-form-item label=" ">
        <el-checkbox v-model="form.saveSubDir">保存子目录</el-checkbox>
        <span class="save-subdir-hint">取消勾选则只转存当前目录下的文件，不含子目录</span>
      </el-form-item>
      <el-form-item label="分享源目录">
        <el-input v-model="form.shareFolderName" readonly placeholder="留空则取分享根目录">
          <template #append>
            <el-button :icon="FolderOpened" @click="pickShareFolder">选择</el-button>
          </template>
        </el-input>
      </el-form-item>
      <el-form-item label="进度">
        <el-input v-model="form.currentEpisodes" style="width: 110px" placeholder="当前" />
        <span style="margin: 0 8px">/</span>
        <el-input v-model="form.totalEpisodes" style="width: 110px" placeholder="总数" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.status" style="width: 140px">
          <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="匹配模式">
        <el-input v-model="form.matchPattern" placeholder="正则，提取用于比较的值" />
      </el-form-item>
      <el-form-item label="匹配规则">
        <el-select v-model="form.matchOperator" style="width: 120px">
          <el-option v-for="o in matchOperators" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-model="form.matchValue" placeholder="匹配值" style="width: 180px; margin-left: 8px" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" />
      </el-form-item>
      <el-form-item label="刮削">
        <el-switch v-model="form.enableTaskScraper" />
      </el-form-item>
      <el-form-item label="定时任务">
        <el-switch v-model="form.enableCron" />
        <el-input
          v-if="form.enableCron"
          v-model="form.cronExpression"
          placeholder="cron 表达式"
          style="width: 240px; margin-left: 12px"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
    </template>

    <FolderTreeDialog ref="targetDialogRef" />
    <FolderTreeDialog ref="shareDialogRef" />
  </el-dialog>
</template>

<style scoped>
.save-subdir-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
