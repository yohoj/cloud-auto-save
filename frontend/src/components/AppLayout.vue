<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, markRaw } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Moon, Sunny, Document, SwitchButton, Film, Tickets, User, Setting } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { useBreakpoints } from '@/composables/useBreakpoints'
import LogViewer from './LogViewer.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const { theme, toggle } = useTheme()
const { isMobile } = useBreakpoints()

const showLogs = ref(false)

const tabs = [
  { name: 'tasks', label: '任务', icon: markRaw(Tickets) },
  { name: 'accounts', label: '账号', icon: markRaw(User) },
  { name: 'media', label: '媒体', icon: markRaw(Film) },
  { name: 'settings', label: '系统', icon: markRaw(Setting) }
]

const active = computed(() => route.name as string)
const activeTab = computed(() => tabs.find((tab) => tab.name === active.value))

function onSelect(name: string) {
  if (name !== active.value) router.push({ name })
}

// 底部 Tab 栏：内容在 el-main 内滚动 —— 监听其滚动方向，向下滚隐藏、向上滚显示。
const mainRef = ref<{ $el: HTMLElement } | null>(null)
const tabbarHidden = ref(false)
let scroller: HTMLElement | null = null
let lastY = 0

function onScroll() {
  if (!scroller) return
  const y = scroller.scrollTop
  if (y <= 4) {
    tabbarHidden.value = false
    lastY = y
    return
  }
  const delta = y - lastY
  // 仅在累计位移超过阈值时改变方向，避免抖动；阈值内不更新 lastY 以便缓慢滚动累积。
  if (delta > 8) {
    tabbarHidden.value = true
    lastY = y
  } else if (delta < -8) {
    tabbarHidden.value = false
    lastY = y
  }
}

onMounted(() => {
  scroller = mainRef.value?.$el ?? null
  scroller?.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => {
  scroller?.removeEventListener('scroll', onScroll)
})
// 切换页面时复位：始终先把 Tab 栏显示出来
watch(
  () => route.name,
  () => {
    tabbarHidden.value = false
    lastY = scroller?.scrollTop ?? 0
  }
)

async function onLogout() {
  await auth.logout()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <el-container class="layout">
    <el-header class="layout-header" height="56px">
      <div class="brand">
        <img src="/icon.svg" alt="" class="brand-logo" />
        <div class="brand-copy">
          <span class="brand-title">云盘自动转存</span>
          <span class="brand-route">{{ activeTab?.label || '控制台' }}</span>
        </div>
      </div>
      <nav class="seg" aria-label="主导航">
        <button
          v-for="t in tabs"
          :key="t.name"
          class="seg__item"
          :class="{ 'is-active': active === t.name }"
          :aria-current="active === t.name ? 'page' : undefined"
          @click="onSelect(t.name)"
        >
          {{ t.label }}
        </button>
      </nav>
      <div class="actions">
        <span v-if="auth.version && !isMobile" class="version">v{{ auth.version }}</span>
        <el-button text :icon="Document" @click="showLogs = true">
          <template v-if="!isMobile">日志</template>
        </el-button>
        <el-button text :icon="theme === 'dark' ? Sunny : Moon" @click="toggle" />
        <el-button text :icon="SwitchButton" @click="onLogout">
          <template v-if="!isMobile">退出</template>
        </el-button>
      </div>
    </el-header>

    <el-main ref="mainRef" class="layout-main">
      <router-view />
    </el-main>

    <!-- 移动端底部 Tab 栏（液态玻璃，随滚动方向显隐） -->
    <nav class="tabbar" :class="{ 'is-hidden': tabbarHidden }" aria-label="主导航">
      <button
        v-for="t in tabs"
        :key="t.name"
        class="tabbar__item"
        :class="{ 'is-active': active === t.name }"
        :aria-current="active === t.name ? 'page' : undefined"
        @click="onSelect(t.name)"
      >
        <el-icon><component :is="t.icon" /></el-icon>
        <span>{{ t.label }}</span>
        <span class="tabbar__dot" />
      </button>
    </nav>

    <el-drawer v-model="showLogs" title="系统日志" :size="isMobile ? '86%' : '55%'" direction="rtl">
      <LogViewer />
    </el-drawer>
  </el-container>
</template>
