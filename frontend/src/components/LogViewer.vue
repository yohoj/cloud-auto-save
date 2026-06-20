<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useLogsStore } from '@/stores/logs'

const logs = useLogsStore()
const boxRef = ref<HTMLElement>()

onMounted(() => {
  logs.connect()
})

// 新日志到达后自动滚到底部
watch(
  () => logs.logs.length,
  async () => {
    await nextTick()
    if (boxRef.value) {
      boxRef.value.scrollTop = boxRef.value.scrollHeight
    }
  }
)
</script>

<template>
  <div class="log-viewer">
    <div class="log-toolbar">
      <el-tag :type="logs.connected ? 'success' : 'info'" size="small" effect="light">
        {{ logs.connected ? '已连接' : '未连接' }}
      </el-tag>
      <span style="flex: 1"></span>
      <el-button size="small" text @click="logs.clear()">清空</el-button>
    </div>
    <div ref="boxRef" class="log-box">
      <div v-for="(line, i) in logs.logs" :key="i" class="log-line">{{ line }}</div>
      <el-empty v-if="logs.logs.length === 0" description="暂无日志" />
    </div>
  </div>
</template>
