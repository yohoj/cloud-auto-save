// 分享链接解析（移植自旧版 tasks.js 的 parseCloudShare / getShareLinkCloudType）

export function parseCloudShare(shareText: string): { url: string; accessCode: string } {
  let text = (shareText || '').replace(/\s/g, '')
  let url = ''
  let accessCode = ''

  const accessCodePatterns = [
    /[（(]访问码[：:]\s*([a-zA-Z0-9]{4})[)）]/,
    /[（(]提取码[：:]\s*([a-zA-Z0-9]{4})[)）]/,
    /访问码[：:]\s*([a-zA-Z0-9]{4})/,
    /提取码[：:]\s*([a-zA-Z0-9]{4})/,
    /[（(]([a-zA-Z0-9]{4})[)）]/
  ]
  for (const p of accessCodePatterns) {
    const m = text.match(p)
    if (m) {
      accessCode = m[1]
      text = text.replace(m[0], '')
      break
    }
  }

  const urlPatterns = [
    /(https?:\/\/cloud\.189\.cn\/web\/share\?[^\s]+)/,
    /(https?:\/\/cloud\.189\.cn\/t\/[a-zA-Z0-9]+)/,
    /(https?:\/\/h5\.cloud\.189\.cn\/share\.html#\/t\/[a-zA-Z0-9]+)/,
    /(https?:\/\/[^/]+\/web\/share\?[^\s]+)/,
    /(https?:\/\/[^/]+\/t\/[a-zA-Z0-9]+)/,
    /(https?:\/\/[^/]+\/share\.html[^\s]*)/,
    /(https?:\/\/content\.21cn\.com[^\s]+)/,
    /(https?:\/\/(?:pan|drive)\.quark\.cn\/s\/[a-zA-Z0-9_-]+)/,
    /(https?:\/\/[^/]*quark\.cn\/s\/[a-zA-Z0-9_-]+)/
  ]
  for (const p of urlPatterns) {
    const m = text.match(p)
    if (m) {
      url = m[1]
      break
    }
  }
  return { url, accessCode }
}

export type ShareCloudType = '' | 'cloud189' | 'quark'

export function getShareCloudType(shareLink: string): ShareCloudType {
  let text = (shareLink || '').trim()
  try {
    text = decodeURIComponent(text)
  } catch {
    /* 非法编码则用原文判断 */
  }
  if (/pan\.quark\.cn|drive\.quark\.cn|quark\.cn\/s\//i.test(text)) return 'quark'
  if (/cloud\.189\.cn|h5\.cloud\.189\.cn|content\.21cn\.com/i.test(text)) return 'cloud189'
  return ''
}
