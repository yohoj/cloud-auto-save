<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { testFntv } from '@/api/settings'

const store = useSettingsStore()
const fntvTesting = ref(false)

onMounted(() => store.ensure())

async function save() {
  const res = await store.saveMedia()
  if (res.success) ElMessage.success('保存成功')
  else ElMessage.error('保存失败：' + (res.error || ''))
  return res.success
}

async function onTestFntv() {
  fntvTesting.value = true
  try {
    // 先保存，确保后端读取最新配置（与旧版一致）
    if (!(await save())) return
    const res = await testFntv()
    if (res.success) ElMessage.success('飞牛连接成功：' + (res.data || ''))
    else ElMessage.error('飞牛连接失败：' + (res.error || ''))
  } finally {
    fntvTesting.value = false
  }
}
</script>

<template>
  <div v-loading="store.loading" class="media-view">
    <div class="media-head">
      <h2>媒体设置</h2>
      <div>
        <el-button text :icon="Refresh" @click="store.load()">重新加载</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </div>
    </div>

    <div class="settings-grid">
      <section class="settings-panel">
        <el-form label-width="150px" class="form">
          <el-form-item label="启用 STRM 生成">
            <el-switch v-model="store.config.strm.enable" />
          </el-form-item>

          <el-divider content-position="left">Emby</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.emby.enable" />
          </el-form-item>
          <el-form-item label="服务器地址">
            <el-input v-model="store.config.emby.serverUrl" placeholder="http://emby:8096" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="store.config.emby.apiKey" />
          </el-form-item>

          <el-divider content-position="left">OpenList / Alist</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.alist.enable" />
          </el-form-item>
          <el-form-item label="服务器地址">
            <el-input v-model="store.config.alist.baseUrl" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="store.config.alist.apiKey" />
          </el-form-item>
        </el-form>
      </section>

      <section class="settings-panel">
        <el-form label-width="150px" class="form">
          <el-divider content-position="left">TMDB 刮削</el-divider>
          <el-form-item label="启用刮削">
            <el-switch v-model="store.config.tmdb.enableScraper" />
          </el-form-item>
          <el-form-item label="TMDB API Key">
            <el-input v-model="store.config.tmdb.tmdbApiKey" />
          </el-form-item>

          <el-divider content-position="left">AI（OpenAI 兼容）</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.openai.enable" />
          </el-form-item>
          <el-form-item label="Base URL">
            <el-input v-model="store.config.openai.baseUrl" placeholder="https://...//v1" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="store.config.openai.apiKey" />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="store.config.openai.model" />
          </el-form-item>
          <el-form-item label="重命名模板">
            <el-input v-model="store.config.openai.rename.template" placeholder="{name} - {se}{ext}" />
          </el-form-item>
          <el-form-item label="电影模板">
            <el-input v-model="store.config.openai.rename.movieTemplate" placeholder="{name} ({year}){ext}" />
          </el-form-item>
        </el-form>
      </section>

      <section class="settings-panel">
        <el-form label-width="150px" class="form">
          <el-divider content-position="left">飞牛影视</el-divider>
          <el-form-item label="启用">
            <el-switch v-model="store.config.fntv.enable" />
          </el-form-item>
          <el-form-item label="服务器地址">
            <el-input v-model="store.config.fntv.base_url" placeholder="http://10.0.0.6:5666" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="store.config.fntv.username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="store.config.fntv.password" type="password" show-password />
          </el-form-item>
          <el-form-item label="Secret String">
            <el-input v-model="store.config.fntv.secret_string" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="store.config.fntv.api_key" />
          </el-form-item>
          <el-form-item label="媒体库映射">
            <el-input
              v-model="store.config.fntv.mdb_mapping"
              type="textarea"
              :rows="2"
              placeholder="关键字:mdb_name，换行或分号分隔"
            />
          </el-form-item>
          <el-form-item label="连接测试">
            <el-button :loading="fntvTesting" @click="onTestFntv">测试连接</el-button>
          </el-form-item>

          <el-divider content-position="left">CloudSaver</el-divider>
          <el-form-item label="服务器地址">
            <el-input v-model="store.config.cloudSaver.baseUrl" />
          </el-form-item>
          <el-form-item label="用户名">
            <el-input v-model="store.config.cloudSaver.username" />
          </el-form-item>
          <el-form-item label="密码">
            <el-input v-model="store.config.cloudSaver.password" type="password" show-password />
          </el-form-item>
        </el-form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.media-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0;
  font-size: 18px;
  margin-bottom: 18px;
}
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.settings-panel {
  padding: 18px 20px;
  border-radius: 24px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow-soft);
}
.settings-panel:last-child {
  grid-column: 1 / -1;
}
.form {
  max-width: 100%;
}
.form :deep(.el-divider__text) {
  font-weight: 600;
}

@media (max-width: 768px) {
  .media-head {
    margin-bottom: 14px;
  }
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-panel,
  .settings-panel:last-child {
    grid-column: auto;
  }
}
</style>
