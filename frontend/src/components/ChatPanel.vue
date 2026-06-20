<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Promotion } from '@element-plus/icons-vue'
import { sendChat } from '@/api/misc'
import { createLogStream, type LogStream } from '@/api/sse'

interface Msg {
  role: 'user' | 'ai'
  content: string
}

const visible = ref(false)
const input = ref('')
const sending = ref(false)
const messages = ref<Msg[]>([])
const boxRef = ref<HTMLElement>()
let stream: LogStream | null = null
let aiStreaming = false

function open() {
  visible.value = true
  connect()
}
defineExpose({ open })

function connect() {
  if (stream) return
  stream = createLogStream({
    onAIMessage: (chunk) => {
      if (chunk === '[END]') {
        aiStreaming = false
        return
      }
      const last = messages.value[messages.value.length - 1]
      if (aiStreaming && last && last.role === 'ai') {
        last.content += chunk
      } else {
        messages.value.push({ role: 'ai', content: chunk })
        aiStreaming = true
      }
      scrollToBottom()
    }
  })
}

async function send() {
  const text = input.value.trim()
  if (!text || sending.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  aiStreaming = false
  scrollToBottom()
  sending.value = true
  try {
    const res = await sendChat(text)
    if (!res.success) ElMessage.error('发送失败：' + (res.error || ''))
  } catch {
    messages.value.push({ role: 'ai', content: '发送消息失败，请重试' })
  } finally {
    sending.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  if (boxRef.value) boxRef.value.scrollTop = boxRef.value.scrollHeight
}

watch(visible, (v) => {
  if (!v) {
    stream?.close()
    stream = null
  }
})
</script>

<template>
  <el-dialog v-model="visible" title="AI 助手" width="520px">
    <div ref="boxRef" class="chat-box">
      <el-empty v-if="!messages.length" description="向 AI 助手提问" />
      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div class="bubble">{{ m.content }}</div>
      </div>
    </div>
    <div class="chat-input">
      <el-input
        v-model="input"
        placeholder="输入消息，回车发送"
        :disabled="sending"
        @keyup.enter="send"
      />
      <el-button type="primary" :icon="Promotion" :loading="sending" @click="send">发送</el-button>
    </div>
  </el-dialog>
</template>

<style scoped>
.chat-box {
  height: 380px;
  overflow: auto;
  padding: 8px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}
.msg {
  display: flex;
  margin-bottom: 10px;
}
.msg.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 78%;
  padding: 8px 12px;
  border-radius: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.msg.user .bubble {
  background: var(--el-color-primary);
  color: #fff;
}
.msg.ai .bubble {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
}
.chat-input {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
</style>
