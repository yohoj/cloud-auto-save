import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useTheme } from './composables/useTheme'
import './styles/main.css'

async function bootstrap() {
  const app = createApp(App)

  app.use(createPinia())
  app.use(ElementPlus)
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component as never)
  }

  // 主题（深色模式）初始化
  useTheme().init()

  // 首屏鉴权探测：探一次需要鉴权的接口，200=已登录、401=未登录，
  // 据此让 router 的首个守卫做出正确的初始跳转，避免登录态闪烁。
  await useAuthStore().checkAuth()

  app.use(router)
  app.mount('#app')
}

bootstrap()
