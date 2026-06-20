<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAccountsStore } from '@/stores/accounts'
import { generateAllStrm } from '@/api/misc'

const visible = ref(false)
const accountsStore = useAccountsStore()
const checked = ref<number[]>([])
const overwrite = ref(false)
const generating = ref(false)

async function open() {
  visible.value = true
  checked.value = []
  await accountsStore.ensure()
}
defineExpose({ open })

const options = computed(() =>
  accountsStore.accounts
    .filter((a) => !a.original_username?.startsWith('n_'))
    .map((a) => ({ value: a.id, label: a.alias ? `${a.username}（${a.alias}）` : a.username }))
)

const allChecked = computed({
  get: () => options.value.length > 0 && checked.value.length === options.value.length,
  set: (v: boolean) => {
    checked.value = v ? options.value.map((o) => o.value) : []
  }
})

async function generate() {
  if (!checked.value.length) {
    ElMessage.warning('请至少选择一个账号')
    return
  }
  generating.value = true
  try {
    const res = await generateAllStrm(checked.value, overwrite.value)
    if (res.success) {
      ElMessage.success(res.data || '执行中，请稍后查看结果')
      visible.value = false
    } else {
      ElMessage.error('生成失败：' + (res.error || ''))
    }
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="STRM 生成器" width="460px">
    <div class="strm-head">
      <el-checkbox v-model="allChecked">全选账号</el-checkbox>
      <el-checkbox v-model="overwrite">覆盖已存在的 STRM</el-checkbox>
    </div>
    <el-checkbox-group v-model="checked" class="strm-list">
      <el-checkbox v-for="o in options" :key="o.value" :value="o.value" :label="o.label" />
    </el-checkbox-group>
    <el-empty v-if="!options.length" description="暂无账号" />

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="generating" @click="generate">开始生成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.strm-head {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.strm-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow: auto;
}
</style>
