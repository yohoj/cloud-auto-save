<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { testCustomPush, type CustomPushConfig, type CustomPushField } from '@/api/settings'

const store = useSettingsStore()

const dialogVisible = ref(false)
const editingIndex = ref<number | null>(null)
const testing = ref(false)
const saving = ref(false)

const methods = ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']
const contentTypes = ['application/json', 'application/x-www-form-urlencoded', 'text/plain']
const fieldTypes = [
  { value: 'string', label: '普通字段' },
  { value: 'json', label: 'JSON' },
  { value: 'header', label: '请求头' }
]

const form = reactive<CustomPushConfig>({
  name: '',
  description: '',
  url: '',
  method: 'POST',
  contentType: 'application/json',
  enabled: true,
  fields: []
})

function resetForm() {
  Object.assign(form, {
    name: '',
    description: '',
    url: '',
    method: 'POST',
    contentType: 'application/json',
    enabled: true,
    fields: [] as CustomPushField[]
  })
}

function openAdd() {
  resetForm()
  editingIndex.value = null
  dialogVisible.value = true
}

function openEdit(index: number) {
  const cfg = store.config.customPush[index]
  Object.assign(form, JSON.parse(JSON.stringify(cfg)))
  if (!Array.isArray(form.fields)) form.fields = []
  editingIndex.value = index
  dialogVisible.value = true
}

function addField() {
  form.fields.push({ type: 'string', key: '', value: '' })
}
function removeField(i: number) {
  form.fields.splice(i, 1)
}

function buildConfig(): CustomPushConfig | null {
  if (!form.name.trim() || !form.url.trim()) {
    ElMessage.warning('名称和 URL 不能为空')
    return null
  }
  const keys = new Set<string>()
  for (const f of form.fields) {
    if (f.type === 'json') {
      try {
        JSON.parse(f.value)
      } catch {
        ElMessage.warning(`字段「${f.key || '(JSON)'}」的 JSON 值格式无效`)
        return null
      }
    } else if (!f.key.trim()) {
      ElMessage.warning(`类型为「${f.type}」的字段必须填写字段名`)
      return null
    }
    if (f.key) {
      if (keys.has(f.key)) {
        ElMessage.warning(`字段名「${f.key}」重复`)
        return null
      }
      keys.add(f.key)
    }
  }
  return JSON.parse(JSON.stringify(form))
}

async function persist() {
  const res = await store.saveGeneral()
  if (res.success) ElMessage.success('保存成功')
  else ElMessage.error('保存失败：' + (res.error || ''))
}

async function onSave() {
  const cfg = buildConfig()
  if (!cfg) return
  saving.value = true
  try {
    if (editingIndex.value === null) store.config.customPush.push(cfg)
    else store.config.customPush[editingIndex.value] = cfg
    await persist()
    dialogVisible.value = false
  } finally {
    saving.value = false
  }
}

async function onDelete(index: number) {
  try {
    await ElMessageBox.confirm('确定删除此自定义推送配置吗？', '删除', { type: 'warning' })
  } catch {
    return
  }
  store.config.customPush.splice(index, 1)
  await persist()
}

async function onToggle(index: number) {
  const cfg = store.config.customPush[index]
  cfg.enabled = !cfg.enabled
  await persist()
}

async function onTest() {
  const cfg = buildConfig()
  if (!cfg) return
  testing.value = true
  try {
    const res = await testCustomPush(cfg)
    if (res.success) ElMessage.success('测试推送成功')
    else ElMessage.error('测试推送失败：' + (res.error || ''))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="cp">
    <el-button type="primary" :icon="Plus" @click="openAdd">添加自定义推送</el-button>

    <el-table :data="store.config.customPush" border size="small" style="margin-top: 12px">
      <el-table-column prop="name" label="名称" min-width="120" />
      <el-table-column prop="description" label="描述" min-width="160" show-overflow-tooltip />
      <el-table-column label="启用" width="80" align="center">
        <template #default="{ $index }">
          <el-switch
            :model-value="store.config.customPush[$index].enabled"
            @update:model-value="onToggle($index)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" align="center">
        <template #default="{ $index }">
          <el-button size="small" @click="openEdit($index)">编辑</el-button>
          <el-button size="small" type="danger" :icon="Delete" @click="onDelete($index)" />
        </template>
      </el-table-column>
      <template #empty>暂无自定义推送配置</template>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="editingIndex === null ? '添加自定义推送' : '编辑自定义推送'"
      width="640px"
      top="6vh"
    >
      <el-form label-width="90px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" />
        </el-form-item>
        <el-form-item label="URL" required>
          <el-input v-model="form.url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="方法">
          <el-select v-model="form.method" style="width: 140px">
            <el-option v-for="m in methods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="Content-Type">
          <el-select v-model="form.contentType" style="width: 280px" allow-create filterable>
            <el-option v-for="c in contentTypes" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>

        <el-divider content-position="left">字段</el-divider>
        <div v-for="(f, i) in form.fields" :key="i" class="cp-field">
          <el-select v-model="f.type" style="width: 110px">
            <el-option v-for="t in fieldTypes" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
          <el-input v-model="f.key" placeholder="字段名" style="width: 150px" :disabled="f.type === 'json'" />
          <el-input
            v-model="f.value"
            :type="f.type === 'json' ? 'textarea' : 'text'"
            :rows="f.type === 'json' ? 3 : 1"
            placeholder="字段值"
            style="flex: 1"
          />
          <el-button :icon="Delete" circle size="small" @click="removeField(i)" />
        </div>
        <el-button size="small" :icon="Plus" @click="addField">添加字段</el-button>
      </el-form>

      <template #footer>
        <el-button :loading="testing" @click="onTest">测试推送</el-button>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cp-field {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
