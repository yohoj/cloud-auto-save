// 容量/字节格式化（与旧版 accounts.js 的 formatBytes/formatCapacityInfo 行为一致）

export function formatBytes(bytes?: number | string | null): string {
  const n = Number(bytes)
  if (!n || !Number.isFinite(n)) return '0B'
  if (n < 0) return '-' + formatBytes(-n)
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const base = 1024
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(base)), units.length - 1)
  const value = n / Math.pow(base, exp)
  return value.toFixed(exp > 0 ? 2 : 0) + units[exp]
}

export function formatCapacity(
  info?: { usedSize?: number | string; totalSize?: number | string } | null
): string {
  if (!info) return ''
  const { usedSize, totalSize } = info
  if (usedSize == null || totalSize == null || usedSize === '' || totalSize === '') return ''
  const used = Number(usedSize)
  const total = Number(totalSize)
  if (!Number.isFinite(used) || !Number.isFinite(total)) return ''
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

// 日期时间格式化（与旧版 tasks.js 的 formatDateTime 行为一致：空值显示「未更新」）
export function formatDateTime(value?: string | null): string {
  if (!value) return '未更新'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '未更新'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
