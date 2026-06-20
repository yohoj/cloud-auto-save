<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import CustomPushManager from '@/components/CustomPushManager.vue'

const store = useSettingsStore()

onMounted(() => store.ensure())

function genApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = ''
  for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length))
  store.config.system.apiKey = key
}

async function save() {
  if (store.config.task.retryInterval < 60) {
    ElMessage.warning('任务重试间隔不能小于 60 秒')
    return
  }
  const res = await store.saveGeneral()
  if (res.success) ElMessage.success('保存成功')
  else ElMessage.error('保存失败：' + (res.error || ''))
}
</script>

<template>
  <div v-loading="store.loading" class="settings-view">
    <div class="settings-head">
      <h2>系统设置</h2>
      <div>
        <el-button text :icon="Refresh" @click="store.load()">重新加载</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </div>
    </div>

    <div class="settings-shell">
      <el-tabs class="settings-tabs">
        <el-tab-pane label="任务">
          <el-form label-width="150px" class="form">
          <el-form-item label="任务检查 cron">
            <el-input v-model="store.config.task.taskCheckCron" placeholder="0 19-23 * * *（多个用 | 分隔）" />
          </el-form-item>
          <el-form-item label="回收站清理 cron">
            <el-input v-model="store.config.task.cleanRecycleCron" />
          </el-form-item>
          <el-form-item label="任务过期天数">
            <el-input-number v-model="store.config.task.taskExpireDays" :min="1" />
          </el-form-item>
          <el-form-item label="最大重试次数">
            <el-input-number v-model="store.config.task.maxRetries" :min="0" />
          </el-form-item>
          <el-form-item label="重试间隔（秒）">
            <el-input-number v-model="store.config.task.retryInterval" :min="60" :step="30" />
          </el-form-item>
          <el-form-item label="媒体文件后缀">
            <el-input v-model="store.config.task.mediaSuffix" type="textarea" :rows="2" placeholder=".mkv;.mp4;..." />
          </el-form-item>
          <el-form-item label="仅保存媒体文件">
            <el-switch v-model="store.config.task.enableOnlySaveMedia" />
          </el-form-item>
          <el-form-item label="目录不存在时创建">
            <el-switch v-model="store.config.task.enableAutoCreateFolder" />
          </el-form-item>
          <el-form-item label="自动清空回收站">
            <el-switch v-model="store.config.task.enableAutoClearRecycle" />
          </el-form-item>
          <el-form-item label="自动清空家庭回收站">
            <el-switch v-model="store.config.task.enableAutoClearFamilyRecycle" />
          </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="系统">
          <el-form label-width="150px" class="form">
          <el-form-item label="登录用户名">
            <el-input v-model="store.config.system.username" />
          </el-form-item>
          <el-form-item label="登录密码">
            <el-input v-model="store.config.system.password" type="password" show-password placeholder="******** 表示不变" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="store.config.system.apiKey" placeholder="用于 x-api-key 鉴权">
              <template #append>
                <el-button @click="genApiKey">生成</el-button>
              </template>
            </el-input>
          </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="通知">
          <el-form label-width="150px" class="form notify">
          <el-divider content-position="left">企业微信</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.wecom.enable" />
          </el-form-item>
          <el-form-item label="Webhook">
            <el-input v-model="store.config.wecom.webhook" />
          </el-form-item>

          <el-divider content-position="left">Telegram</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.telegram.enable" />
          </el-form-item>
          <el-form-item label="Bot Token">
            <el-input v-model="store.config.telegram.botToken" />
          </el-form-item>
          <el-form-item label="Chat ID">
            <el-input v-model="store.config.telegram.chatId" />
          </el-form-item>
          <el-form-item label="代理域名">
            <el-input v-model="store.config.telegram.proxyDomain" />
          </el-form-item>
          <el-form-item label="机器人启用">
            <el-switch v-model="store.config.telegram.bot.enable" />
          </el-form-item>
          <el-form-item label="机器人 Token">
            <el-input v-model="store.config.telegram.bot.botToken" />
          </el-form-item>
          <el-form-item label="机器人 Chat ID">
            <el-input v-model="store.config.telegram.bot.chatId" />
          </el-form-item>

          <el-divider content-position="left">WXPusher</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.wxpusher.enable" />
          </el-form-item>
          <el-form-item label="SPT">
            <el-input v-model="store.config.wxpusher.spt" />
          </el-form-item>

          <el-divider content-position="left">Bark</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.bark.enable" />
          </el-form-item>
          <el-form-item label="ServerUrl">
            <el-input v-model="store.config.bark.serverUrl" />
          </el-form-item>
          <el-form-item label="Key">
            <el-input v-model="store.config.bark.key" />
          </el-form-item>

          <el-divider content-position="left">PushPlus</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.pushplus.enable" />
          </el-form-item>
          <el-form-item label="Token">
            <el-input v-model="store.config.pushplus.token" />
          </el-form-item>
          <el-form-item label="群组编码">
            <el-input v-model="store.config.pushplus.topic" />
          </el-form-item>
          <el-form-item label="发送渠道">
            <el-input v-model="store.config.pushplus.channel" placeholder="wechat/webhook/cp/sms/mail" />
          </el-form-item>

          <el-divider content-position="left">SmartStrm</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.smartStrm.enable" />
          </el-form-item>
          <el-form-item label="Webhook">
            <el-input v-model="store.config.smartStrm.webhook" />
          </el-form-item>
          <el-form-item label="任务映射">
            <el-input v-model="store.config.smartStrm.taskMapping" type="textarea" :rows="2" />
          </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="代理">
          <el-form label-width="150px" class="form">
          <el-form-item label="主机">
            <el-input v-model="store.config.proxy.host" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="store.config.proxy.port" :min="0" :max="65535" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="store.config.proxy.username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="store.config.proxy.password" type="password" show-password />
          </el-form-item>
          <el-form-item label="代理生效服务">
            <el-checkbox v-model="store.config.proxy.services.telegram">Telegram</el-checkbox>
            <el-checkbox v-model="store.config.proxy.services.tmdb">TMDB</el-checkbox>
            <el-checkbox v-model="store.config.proxy.services.openai">OpenAI</el-checkbox>
            <el-checkbox v-model="store.config.proxy.services.customPush">自定义推送</el-checkbox>
          </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="推送">
          <CustomPushManager />
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<style scoped>
.settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  font-size: 18px;
  margin-bottom: 18px;
}
.settings-shell {
  padding: 18px 20px;
  border-radius: 24px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow-soft);
}
.settings-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
  padding: 6px 0 10px;
  display: flex;
  justify-content: center;
}
.settings-tabs :deep(.el-tabs__nav-wrap) {
  width: 100%;
  overflow: visible;
}
.settings-tabs :deep(.el-tabs__nav-scroll) {
  display: block;
  width: 100% !important;
  padding: 3px;
  background: rgba(120, 132, 162, 0.12);
  border: 1px solid rgba(17, 23, 41, 0.08);
  border-radius: 999px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.55) inset,
    0 4px 14px -10px rgba(17, 23, 41, 0.16);
}
.settings-tabs :deep(.el-tabs__nav) {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  width: 100%;
  gap: 3px;
  align-items: stretch;
}
.settings-tabs :deep(.el-tabs__item) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 9px 8px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
.settings-tabs :deep(.el-tabs__item.is-active) {
  background: rgba(255, 255, 255, 0.88);
  box-shadow:
    0 8px 18px -14px rgba(17, 23, 41, 0.28),
    0 1px 2px rgba(17, 23, 41, 0.08),
    0 1px 0 rgba(255, 255, 255, 0.75) inset;
}
html.dark .settings-tabs :deep(.el-tabs__nav-scroll) {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.08) inset,
    0 6px 18px -12px rgba(0, 0, 0, 0.45);
}
html.dark .settings-tabs :deep(.el-tabs__item.is-active) {
  background: rgba(255, 255, 255, 0.14);
  box-shadow:
    0 10px 18px -14px rgba(0, 0, 0, 0.48),
    0 1px 2px rgba(0, 0, 0, 0.24),
    0 1px 0 rgba(255, 255, 255, 0.1) inset;
}
.form {
  max-width: 640px;
}
.notify :deep(.el-divider__text) {
  font-weight: 600;
}

@media (max-width: 768px) {
  .settings-head {
    margin-bottom: 14px;
  }
  .settings-shell {
    padding: 14px 14px 16px;
  }
  .settings-tabs :deep(.el-tabs__item) {
    padding: 8px 4px;
    font-size: 12px;
  }
}
</style>
