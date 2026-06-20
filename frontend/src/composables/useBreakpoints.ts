import { onUnmounted, ref } from 'vue'

/**
 * 响应式断点。移动端阈值与样式里的 @media (max-width: 768px) 保持一致，
 * 用于在「宽表格 ↔ 卡片列表」「顶栏菜单 ↔ 底部 Tab」之间切换渲染。
 *
 * 采用模块级单例 ref + 一个共享的 matchMedia 监听，避免每个组件各自建监听。
 */
const MOBILE_QUERY = '(max-width: 768px)'

const mql = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null
const isMobile = ref(mql ? mql.matches : false)

if (mql) {
  mql.addEventListener('change', (e) => {
    isMobile.value = e.matches
  })
}

export function useBreakpoints() {
  // 预留：组件卸载时无需移除共享监听（单例长存），此处仅占位以统一用法。
  onUnmounted(() => {})
  return { isMobile }
}
