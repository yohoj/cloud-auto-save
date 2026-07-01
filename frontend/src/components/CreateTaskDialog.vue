<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown, FolderOpened } from '@element-plus/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import { createTask, parseShare, executeTask, type ShareFolder } from '@/api/tasks'
import { parseCloudShare, getShareCloudType } from '@/utils/share'
import FolderTreeDialog from './FolderTreeDialog.vue'

const emit = defineEmits<{ saved: [] }>()

const accountsStore = useAccountsStore()
const folderDialogRef = ref<InstanceType<typeof FolderTreeDialog>>()

const visible = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const parseError = ref('')
const shareFolders = ref<ShareFolder[]>([])
const showAdvanced = ref(false)

const form = reactive({
  accountId: '' as number | string,
  shareLink: '',
  accessCode: '',
  selectedShareFolderId: '',
  taskName: '',
  targetFolderId: '',
  targetFolder: '',
  totalEpisodes: '',
  remark: '',
  matchPattern: '',
  matchOperator: '',
  matchValue: '',
  sourceRegex: '',
  targetRegex: '',
  enableTaskScraper: false,
  enableCron: false,
  cronExpression: '',
  saveSubDir: true
})

const matchOperators = [
  { value: '', label: '不限' },
  { value: 'lt', label: '小于' },
  { value: 'eq', label: '等于' },
  { value: 'gt', label: '大于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' }
]

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

// 分享链接的网盘类型变化后，若当前账号不匹配则切到首个可选账号
watch(shareCloudType, () => {
  if (!form.accountId) return
  if (!accountOptions.value.some((o) => o.value === form.accountId)) {
    form.accountId = accountOptions.value[0]?.value ?? ''
  }
})

// 切换账号后，之前选的目标目录属于旧账号，需清空
watch(
  () => form.accountId,
  () => {
    form.targetFolderId = ''
    form.targetFolder = ''
  }
)

async function open(initialShareLink?: string) {
  resetForm()
  await accountsStore.ensure()
  const def = accountsStore.accounts.find((a) => a.isDefault && !a.original_username?.startsWith('n_'))
  form.accountId = def?.id ?? accountOptions.value[0]?.value ?? ''
  visible.value = true
  if (initialShareLink) {
    form.shareLink = initialShareLink
    // 等账号就绪后解析
    await onParse()
  }
}
defineExpose({ open })

function resetForm() {
  Object.assign(form, {
    accountId: '',
    shareLink: '',
    accessCode: '',
    selectedShareFolderId: '',
    taskName: '',
    targetFolderId: '',
    targetFolder: '',
    totalEpisodes: '',
    remark: '',
    matchPattern: '',
    matchOperator: '',
    matchValue: '',
    sourceRegex: '',
    targetRegex: '',
    enableTaskScraper: false,
    enableCron: false,
    cronExpression: '',
    saveSubDir: true
  })
  shareFolders.value = []
  parseError.value = ''
  showAdvanced.value = false
}

async function onParse() {
  parseError.value = ''
  const raw = form.shareLink?.trim()
  if (!raw || !form.accountId) return
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    /* 保留原文 */
  }
  const { url, accessCode } = parseCloudShare(decoded)
  if (accessCode) form.accessCode = accessCode
  const link = url || raw
  parsing.value = true
  try {
    const res = await parseShare(link, form.accessCode || '', form.accountId)
    if (res.success && res.data?.length) {
      shareFolders.value = res.data
      form.selectedShareFolderId = String(res.data[0].id)
      form.taskName = res.data[0].folderName || res.data[0].name
    } else {
      shareFolders.value = []
      parseError.value = res.error ? `解析失败：${res.error}` : '未解析到分享目录'
    }
  } finally {
    parsing.value = false
  }
}

async function pickTargetFolder() {
  if (!form.accountId) {
    ElMessage.warning('请先选择账号')
    return
  }
  const result = await folderDialogRef.value?.open(form.accountId)
  if (result) {
    form.targetFolderId = result.id
    form.targetFolder = result.path || result.name
  }
}

function validate(): string | null {
  if (!form.accountId) return '请选择账号'
  if (!form.shareLink) return '请输入分享链接'
  if (!shareFolders.value.length || !form.selectedShareFolderId) return '请先解析并选择分享目录'
  if (!form.taskName.trim()) return '任务名称不能为空'
  if (!form.targetFolderId) return '请选择保存目录'
  if (form.matchPattern && !form.matchValue) return '填了匹配模式，匹配值就必须填'
  if (form.enableCron && !form.cronExpression) return '开启了定时任务，必须填写 cron 表达式'
  if (form.targetRegex && !form.sourceRegex) return '填了目标正则，源正则就必须填'
  return null
}

async function submit() {
  const err = validate()
  if (err) {
    ElMessage.warning(err)
    return
  }
  submitting.value = true
  try {
    const res = await createTask({
      accountId: form.accountId,
      shareLink: form.shareLink,
      taskName: form.taskName.trim(),
      targetFolderId: form.targetFolderId,
      targetFolder: form.targetFolder,
      accessCode: form.accessCode,
      totalEpisodes: form.totalEpisodes,
      matchPattern: form.matchPattern,
      matchOperator: form.matchOperator,
      matchValue: form.matchValue,
      overwriteFolder: 0,
      remark: form.remark,
      enableCron: form.enableCron,
      cronExpression: form.cronExpression,
      sourceRegex: form.sourceRegex,
      targetRegex: form.targetRegex,
      enableTaskScraper: form.enableTaskScraper,
      selectedFolders: [form.selectedShareFolderId],
      saveSubDir: form.saveSubDir
    })
    if (res.success) {
      ElMessage.success('任务创建完成，已在后台开始执行')
      // 创建后自动执行（与旧版一致），fire-and-forget
      ;(res.data || []).forEach((t) => {
        executeTask(t.id).catch(() => undefined)
      })
      visible.value = false
      emit('saved')
    } else {
      ElMessage.error('任务创建失败：' + (res.error || ''))
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建任务" width="600px" top="6vh" @closed="resetForm">
    <el-form label-width="92px" @submit.prevent>
      <el-form-item label="分享链接" required>
        <el-input
          v-model="form.shareLink"
          type="textarea"
          :rows="2"
          placeholder="粘贴天翼/夸克分享链接（可含提取码），失焦自动解析"
          @blur="onParse"
        />
      </el-form-item>

      <el-form-item label="访问码">
        <el-input v-model="form.accessCode" placeholder="加密分享的提取码（可自动识别）" style="width: 200px" @blur="onParse" />
        <el-button :loading="parsing" style="margin-left: 8px" @click="onParse">解析</el-button>
        <span v-if="parseError" class="parse-error">{{ parseError }}</span>
      </el-form-item>

      <el-form-item label="账号" required>
        <el-select v-model="form.accountId" placeholder="选择账号" style="width: 100%">
          <el-option v-for="o in accountOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="shareFolders.length" label="分享目录" required>
        <el-select v-model="form.selectedShareFolderId" style="width: 100%">
          <el-option
            v-for="f in shareFolders"
            :key="f.id"
            :label="f.path || f.name"
            :value="String(f.id)"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="任务名称" required>
        <el-input v-model="form.taskName" placeholder="解析后自动填入，可修改" />
      </el-form-item>

      <el-form-item label="保存目录" required>
        <el-input v-model="form.targetFolder" readonly placeholder="点右侧按钮选择目标目录">
          <template #append>
            <el-button :icon="FolderOpened" @click="pickTargetFolder">选择</el-button>
          </template>
        </el-input>
      </el-form-item>

      <el-form-item label=" ">
        <el-checkbox v-model="form.saveSubDir">保存子目录</el-checkbox>
        <span class="save-subdir-hint">取消勾选则只转存当前目录下的文件，不含子目录</span>
      </el-form-item>

      <el-form-item label="总集数">
        <el-input v-model="form.totalEpisodes" placeholder="选填，达到后标记完结" style="width: 200px" />
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="form.remark" placeholder="选填" />
      </el-form-item>

      <section class="advanced">
        <button
          type="button"
          class="advanced__toggle"
          :class="{ 'is-open': showAdvanced }"
          @click="showAdvanced = !showAdvanced"
        >
          <div class="advanced__copy">
            <span class="advanced__title">高级选项</span>
            <span class="advanced__summary">匹配规则 / 重命名 / 刮削</span>
          </div>
          <el-icon class="advanced__arrow"><ArrowDown /></el-icon>
        </button>

        <div v-show="showAdvanced" class="advanced__body">
          <div class="advanced__hint">
            只在需要过滤集数、批量重命名或自动刮削时填写，留空会按默认流程创建任务。
          </div>

          <el-form-item label="匹配模式" class="advanced__item">
            <el-input v-model="form.matchPattern" placeholder="正则，从文件名提取用于比较的值" />
          </el-form-item>

          <el-form-item label="匹配规则" class="advanced__item">
            <div class="advanced__rule-row">
              <el-select v-model="form.matchOperator" class="advanced__rule-select">
                <el-option v-for="o in matchOperators" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
              <el-input v-model="form.matchValue" class="advanced__rule-input" placeholder="匹配值" />
            </div>
          </el-form-item>

          <el-form-item label="源正则" class="advanced__item">
            <el-input v-model="form.sourceRegex" placeholder="自动重命名：源文件名正则" />
          </el-form-item>

          <el-form-item label="目标正则" class="advanced__item">
            <el-input v-model="form.targetRegex" placeholder="自动重命名：目标格式" />
          </el-form-item>

          <el-form-item label="刮削" class="advanced__item advanced__switch-item">
            <div class="advanced__switch-row">
              <el-switch v-model="form.enableTaskScraper" />
              <span class="advanced__switch-text">创建后自动进行媒体信息刮削</span>
            </div>
          </el-form-item>
        </div>
      </section>

      <el-form-item label="定时任务">
        <el-switch v-model="form.enableCron" />
        <el-input
          v-if="form.enableCron"
          v-model="form.cronExpression"
          placeholder="cron 表达式，如 0 19-23 * * *"
          style="width: 240px; margin-left: 12px"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">创建并执行</el-button>
    </template>

    <FolderTreeDialog ref="folderDialogRef" />
  </el-dialog>
</template>

<style scoped>
.parse-error {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-color-danger);
}
.save-subdir-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.advanced {
  margin: 10px 0 14px;
  border: 1px solid var(--glass-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--glass-bg) 78%, transparent);
  box-shadow: var(--glass-shadow-soft);
  overflow: hidden;
}
.advanced__toggle {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  text-align: left;
}
.advanced__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.advanced__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.advanced__summary {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.advanced__arrow {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--el-text-color-secondary);
  transition: transform 0.2s ease;
}
.advanced__toggle.is-open .advanced__arrow {
  transform: rotate(180deg);
}
.advanced__body {
  padding: 0 18px 18px;
  border-top: 1px solid var(--glass-border);
}
.advanced__hint {
  margin: 14px 0 16px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--glass-track) 72%, transparent);
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.advanced__item {
  margin-bottom: 14px;
}
.advanced__item:last-child {
  margin-bottom: 0;
}
.advanced__rule-row {
  display: flex;
  gap: 10px;
  width: 100%;
}
.advanced__rule-select {
  width: 130px;
  flex-shrink: 0;
}
.advanced__rule-input {
  flex: 1;
}
.advanced__switch-item :deep(.el-form-item__content) {
  min-height: 40px;
}
.advanced__switch-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.advanced__switch-text {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

@media (max-width: 768px) {
  .advanced__toggle {
    padding: 14px 14px 13px;
  }
  .advanced__body {
    padding: 0 14px 14px;
  }
  .advanced__rule-row {
    flex-direction: column;
  }
  .advanced__rule-select,
  .advanced__rule-input {
    width: 100%;
  }
}
</style>
