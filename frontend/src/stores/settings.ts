import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSettings, saveGeneralSettings, saveMediaSettings, type AppConfig } from '@/api/settings'

export function defaultConfig(): AppConfig {
  return {
    task: {
      taskExpireDays: 3,
      taskCheckCron: '0 19-23 * * *',
      cleanRecycleCron: '0 */8 * * *',
      maxRetries: 3,
      retryInterval: 300,
      enableAutoClearRecycle: false,
      enableAutoClearFamilyRecycle: false,
      mediaSuffix: '',
      enableOnlySaveMedia: false,
      enableAutoCreateFolder: false
    },
    wecom: { enable: false, webhook: '' },
    telegram: {
      enable: false,
      proxyDomain: '',
      botToken: '',
      chatId: '',
      bot: { enable: false, botToken: '', chatId: '' }
    },
    wxpusher: { enable: false, spt: '' },
    proxy: {
      host: '',
      port: 0,
      username: '',
      password: '',
      services: { telegram: true, tmdb: true, openai: true, quark: false, customPush: false }
    },
    bark: { enable: false, serverUrl: '', key: '' },
    pushplus: { enable: false, token: '', topic: '', channel: 'wechat', webhook: '', to: '' },
    smartStrm: { enable: false, webhook: '', taskMapping: '' },
    fntv: { enable: false, base_url: '', username: '', password: '', secret_string: '', api_key: '', mdb_mapping: '' },
    system: { username: '', password: '', baseUrl: '', apiKey: '', corsOrigins: '' },
    strm: { enable: false },
    emby: { enable: false, serverUrl: '', apiKey: '' },
    cloudSaver: { baseUrl: '', username: '', password: '' },
    tmdb: { enableScraper: false, apiKey: '', tmdbApiKey: '' },
    openai: { enable: false, baseUrl: '', apiKey: '', model: '', rename: { template: '', movieTemplate: '' } },
    alist: { enable: false, baseUrl: '', apiKey: '' },
    customPush: []
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<AppConfig>(defaultConfig())
  const loading = ref(false)
  let loaded = false

  async function load() {
    loading.value = true
    try {
      const data = await getSettings()
      if (data) {
        // 合并到默认骨架，保证所有字段存在
        config.value = { ...defaultConfig(), ...data }
        loaded = true
      }
    } finally {
      loading.value = false
    }
  }

  async function ensure() {
    if (!loaded) await load()
  }

  // 通用设置保存（任务/通知/代理/系统/自定义推送）
  function saveGeneral() {
    const c = config.value
    return saveGeneralSettings({
      task: c.task,
      wecom: c.wecom,
      telegram: c.telegram,
      wxpusher: c.wxpusher,
      proxy: c.proxy,
      bark: c.bark,
      system: c.system,
      pushplus: c.pushplus,
      smartStrm: c.smartStrm,
      customPush: c.customPush
    })
  }

  // 媒体设置保存
  function saveMedia() {
    const c = config.value
    return saveMediaSettings({
      strm: c.strm,
      emby: c.emby,
      cloudSaver: c.cloudSaver,
      tmdb: c.tmdb,
      openai: c.openai,
      alist: c.alist,
      fntv: c.fntv
    })
  }

  return { config, loading, load, ensure, saveGeneral, saveMedia }
})
