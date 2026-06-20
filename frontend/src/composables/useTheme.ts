import { ref } from 'vue'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
const theme = ref<Theme>('light')

function apply(t: Theme) {
  // Element Plus 深色模式依赖 <html class="dark">
  document.documentElement.classList.toggle('dark', t === 'dark')
  document.documentElement.setAttribute('data-theme', t)
  // 沉浸式状态栏：theme-color 跟随当前主题，取背景渐变顶部的近似色，
  // 让浏览器/状态栏底色与 App 融为一体。
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0b1020' : '#e7ecf9')
}

export function useTheme() {
  function init() {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    theme.value = saved ?? (prefersDark ? 'dark' : 'light')
    apply(theme.value)
  }

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(STORAGE_KEY, theme.value)
    apply(theme.value)
  }

  return { theme, init, toggle }
}
