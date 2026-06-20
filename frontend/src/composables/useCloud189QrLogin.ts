import { onUnmounted, ref } from 'vue'
import { getQrcode, pollQrcode } from '@/api/accounts'

// 天翼云盘 TV/PC 扫码登录轮询（对应旧版 accounts.js 的 startCloud189QrLogin/pollCloud189QrLogin）。
// 流程：POST 取二维码 → 每 3s 轮询状态 → success 时回调 (username, qrLoginId)。
export function useCloud189QrLogin() {
  const qrImage = ref('')
  const qrStatus = ref('')
  const active = ref(false)
  const loading = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let activeId = ''
  let onSuccess: ((username: string, qrLoginId: string) => void) | null = null

  function reset() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    activeId = ''
    qrImage.value = ''
    qrStatus.value = ''
    active.value = false
    loading.value = false
  }

  async function start(successCb: (username: string, qrLoginId: string) => void) {
    reset()
    onSuccess = successCb
    loading.value = true
    active.value = true
    qrStatus.value = '正在生成二维码'
    try {
      const res = await getQrcode()
      if (!res.success || !res.data) throw new Error(res.error || '二维码生成失败')
      activeId = res.data.qrId
      qrImage.value = res.data.imageUrl
      qrStatus.value = '请使用天翼云盘 App 或微信扫码'
      poll(res.data.qrId)
    } catch (e) {
      reset()
      qrStatus.value = '二维码登录失败：' + (e instanceof Error ? e.message : '')
    } finally {
      loading.value = false
    }
  }

  async function poll(qrId: string) {
    if (!qrId || qrId !== activeId) return
    try {
      const res = await pollQrcode(qrId)
      if (!res.success || !res.data) throw new Error(res.error || '查询扫码状态失败')
      const status = res.data.status
      if (status === 'success') {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        active.value = false
        qrStatus.value = '扫码成功'
        onSuccess?.(res.data.username || '', res.data.qrLoginId || '')
        return
      }
      if (status === 'expired') {
        reset()
        qrStatus.value = '二维码已失效，请重新获取'
        return
      }
      qrStatus.value = status === 'scanned' ? '已扫码，请在手机端确认' : '等待扫码'
      timer = setTimeout(() => poll(qrId), 3000)
    } catch (e) {
      reset()
      qrStatus.value = '二维码登录失败：' + (e instanceof Error ? e.message : '')
    }
  }

  onUnmounted(reset)

  return { qrImage, qrStatus, active, loading, start, reset }
}
