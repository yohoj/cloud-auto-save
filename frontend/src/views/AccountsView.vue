<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, Edit, Star, StarFilled, Refresh } from '@element-plus/icons-vue'
import { useAccountsStore } from '@/stores/accounts'
import {
  deleteAccount,
  clearRecycle,
  setDefault,
  updateAlias,
  updateStrmPrefix,
  type Account,
  type ApiResult
} from '@/api/accounts'
import { formatCapacity } from '@/utils/format'
import { useBreakpoints } from '@/composables/useBreakpoints'
import AccountDialog from '@/components/AccountDialog.vue'

const store = useAccountsStore()
const { isMobile } = useBreakpoints()
const dialogRef = ref<InstanceType<typeof AccountDialog>>()

onMounted(() => store.fetch())

function onAdd() {
  dialogRef.value?.open()
}
function onEdit(row: Account) {
  dialogRef.value?.open(row)
}

async function onDelete(row: Account) {
  try {
    await ElMessageBox.confirm(
      '确定要删除这个账号吗？关联的任务和常用目录会一起删除，但不会删除网盘文件。',
      '删除账号',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  const res = await deleteAccount(row.id)
  if (res.success) {
    ElMessage.success('账号删除成功')
    store.fetch()
  } else {
    ElMessage.error('删除失败：' + (res.error || ''))
  }
}

async function onSetDefault(row: Account) {
  if (row.isDefault) return
  const res = await setDefault(row.id)
  if (res.success) {
    ElMessage.success('已设为默认账号')
    store.fetch()
  } else {
    ElMessage.error('设置失败：' + (res.error || ''))
  }
}

async function onClearRecycle() {
  try {
    await ElMessageBox.confirm('确定要清空所有天翼云盘账号的回收站吗？', '清空回收站', {
      type: 'warning'
    })
  } catch {
    return
  }
  const res = await clearRecycle()
  if (res.success) ElMessage.success('后台任务执行中，请稍后查看结果')
  else ElMessage.error('清空失败：' + (res.error || ''))
}

// 通用的「点选编辑」：弹出 prompt，提交后刷新（对应旧版 prompt() 交互）
async function editField(
  label: string,
  current: string,
  save: (value: string) => Promise<ApiResult>
) {
  let value: string
  try {
    const r = await ElMessageBox.prompt(`请输入新的${label}`, '修改' + label, {
      inputValue: current,
      confirmButtonText: '保存',
      cancelButtonText: '取消'
    })
    value = r.value ?? ''
  } catch {
    return
  }
  const res = await save(value)
  if (res.success) {
    ElMessage.success('更新成功')
    store.fetch()
  } else {
    ElMessage.error('更新失败：' + (res.error || ''))
  }
}

const editAlias = (row: Account) => editField('别名', row.alias || '', (v) => updateAlias(row.id, v))
const editCloudPrefix = (row: Account) =>
  editField('媒体目录前缀', row.cloudStrmPrefix || '', (v) => updateStrmPrefix(row.id, v, 'cloud'))
const editLocalPrefix = (row: Account) =>
  editField('本地目录前缀', row.localStrmPrefix || '', (v) => updateStrmPrefix(row.id, v, 'local'))
const editEmbyReplace = (row: Account) =>
  editField('Emby替换路径', row.embyPathReplace || '', (v) => updateStrmPrefix(row.id, v, 'emby'))
</script>

<template>
  <div class="accounts-view">
    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="onAdd">添加账号</el-button>
      <el-button :icon="Delete" @click="onClearRecycle">清空天翼回收站</el-button>
      <span class="spacer" />
      <el-button text :icon="Refresh" :loading="store.loading" @click="store.fetch()">刷新</el-button>
    </div>

    <!-- 桌面端：表格 -->
    <el-table v-if="!isMobile" v-loading="store.loading" :data="store.accounts" border stripe size="small">
      <el-table-column label="默认" width="56" align="center">
        <template #default="{ row }">
          <el-icon
            class="star"
            :class="{ active: row.isDefault }"
            :title="row.isDefault ? '默认账号' : '设为默认账号'"
            @click="onSetDefault(row)"
          >
            <StarFilled v-if="row.isDefault" />
            <Star v-else />
          </el-icon>
        </template>
      </el-table-column>

      <el-table-column prop="username" label="账户名" min-width="150" show-overflow-tooltip />

      <el-table-column label="网盘类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.cloudType === 'quark' ? 'warning' : 'primary'" size="small">
            {{ row.cloudType === 'quark' ? '夸克网盘' : '天翼云盘' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="别名" min-width="110">
        <template #default="{ row }">
          <span class="editable" @click="editAlias(row)">{{ row.alias || '—' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="个人容量" min-width="150" align="center">
        <template #default="{ row }">{{ formatCapacity(row.capacity?.cloudCapacityInfo) || '—' }}</template>
      </el-table-column>

      <el-table-column label="家庭容量" min-width="150" align="center">
        <template #default="{ row }">{{ formatCapacity(row.capacity?.familyCapacityInfo) || '—' }}</template>
      </el-table-column>

      <el-table-column label="媒体目录" min-width="170">
        <template #default="{ row }">
          <span class="editable" @click="editCloudPrefix(row)">{{ row.cloudStrmPrefix || '—' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="本地目录" min-width="170">
        <template #default="{ row }">
          <span class="editable" @click="editLocalPrefix(row)">{{ row.localStrmPrefix || '—' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Emby路径替换" min-width="170">
        <template #default="{ row }">
          <span class="editable" @click="editEmbyReplace(row)">{{ row.embyPathReplace || '—' }}</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="150" fixed="right" align="center">
        <template #default="{ row }">
          <el-button size="small" :icon="Edit" @click="onEdit(row)">修改</el-button>
          <el-button size="small" type="danger" :icon="Delete" @click="onDelete(row)" />
        </template>
      </el-table-column>
    </el-table>

    <!-- 移动端：卡片列表 -->
    <div v-else v-loading="store.loading" class="card-list">
      <el-empty v-if="!store.accounts.length && !store.loading" description="暂无账号" />
      <div v-for="row in store.accounts" :key="row.id" class="data-card">
        <div class="data-card__head">
          <el-icon class="star" :class="{ active: row.isDefault }" @click="onSetDefault(row)">
            <StarFilled v-if="row.isDefault" />
            <Star v-else />
          </el-icon>
          <span class="data-card__title">{{ row.username }}</span>
          <el-tag :type="row.cloudType === 'quark' ? 'warning' : 'primary'" size="small">
            {{ row.cloudType === 'quark' ? '夸克网盘' : '天翼云盘' }}
          </el-tag>
        </div>

        <div class="data-card__row">
          <span class="k">别名</span>
          <span class="v editable" @click="editAlias(row)">{{ row.alias || '—' }}</span>
        </div>
        <div class="data-card__row">
          <span class="k">个人容量</span>
          <span class="v">{{ formatCapacity(row.capacity?.cloudCapacityInfo) || '—' }}</span>
        </div>
        <div class="data-card__row">
          <span class="k">家庭容量</span>
          <span class="v">{{ formatCapacity(row.capacity?.familyCapacityInfo) || '—' }}</span>
        </div>
        <div class="data-card__row">
          <span class="k">媒体目录</span>
          <span class="v editable" @click="editCloudPrefix(row)">{{ row.cloudStrmPrefix || '—' }}</span>
        </div>
        <div class="data-card__row">
          <span class="k">本地目录</span>
          <span class="v editable" @click="editLocalPrefix(row)">{{ row.localStrmPrefix || '—' }}</span>
        </div>
        <div class="data-card__row">
          <span class="k">Emby替换</span>
          <span class="v editable" @click="editEmbyReplace(row)">{{ row.embyPathReplace || '—' }}</span>
        </div>

        <div class="data-card__actions">
          <el-button size="small" :icon="Edit" @click="onEdit(row)">修改</el-button>
          <el-button size="small" type="danger" :icon="Delete" @click="onDelete(row)">删除</el-button>
        </div>
      </div>
    </div>

    <AccountDialog ref="dialogRef" @saved="store.fetch()" />
  </div>
</template>

<style scoped>
.star {
  cursor: pointer;
  font-size: 18px;
  color: var(--el-text-color-placeholder);
  transition: color 0.15s;
}
.star.active {
  color: var(--el-color-warning);
}
.star:hover {
  color: var(--el-color-warning);
}
.editable {
  cursor: pointer;
  display: inline-block;
  min-width: 100%;
  color: var(--el-text-color-primary);
  border-bottom: 1px dashed transparent;
}
.editable:hover {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
}
.data-card__row .editable {
  min-width: 0;
}
</style>
