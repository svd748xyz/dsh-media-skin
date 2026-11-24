/**
 * 素材的识别、定位、保存。
 *
 * 两种来源：
 *   `path`   用户给的一条本地绝对路径（不复制文件，直接读）
 *   `upload` 界面上"选择文件"传上来的副本，落在 $DSH_HOME/dsh-media-skin/media/
 *
 * 两边都要过同一道白名单（扩展名）。这不是为了安全表演：浏览器只认这几类容器，
 * 放进一个 `.txt` 只会得到一张碎图，不如早点报错。
 */
import fs from 'node:fs'
import path from 'node:path'

import { mediaDir } from './store.js'

/** 能当背景的图片扩展名。 */
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp', '.svg'])
/** 能当背景的视频扩展名。 */
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov', '.m4v'])

/** 上传体积上限（字节）。超过这个数就别往浏览器里塞了。 */
export const UPLOAD_LIMIT_BYTES = 512 * 1024 * 1024

/** 扩展名 → MIME。 */
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
}

/**
 * 按扩展名判断素材类型。
 * @param {string} filePath 文件路径（或文件名）。
 * @returns {'image' | 'video' | 'none'}
 */
export function kindOf(filePath) {
  const extension = path.extname(String(filePath ?? '')).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return 'none'
}

/**
 * 按扩展名给出 Content-Type。
 * @param {string} filePath 文件路径。
 * @returns {string} MIME，未知时 `application/octet-stream`。
 */
export function contentTypeFor(filePath) {
  return MIME[path.extname(String(filePath ?? '')).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 清洗上传文件名：只留 basename，去掉 Windows/POSIX 的非法字符与点开头的隐藏名。
 * @param {string} raw 浏览器给的文件名。
 * @returns {string} 可以安全落盘的文件名。
 */
export function safeFileName(raw) {
  const base = path.basename(String(raw ?? '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/^[.\s]+/, '')
  const trimmed = base.slice(0, 120)
  return trimmed === '' ? `media-${Date.now()}` : trimmed
}

/**
 * 保存一份上传素材，重名时自动加序号，绝不覆盖已有文件。
 * @param {Buffer} buffer 文件内容。
 * @param {string} rawName 浏览器给的文件名。
 * @returns {{ path: string, name: string, kind: string, size: number }}
 */
export function saveUpload(buffer, rawName) {
  const directory = mediaDir()
  fs.mkdirSync(directory, { recursive: true })
  const name = safeFileName(rawName)
  const extension = path.extname(name).toLowerCase()
  const stem = path.basename(name, path.extname(name))
  let candidate = name
  let index = 2
  while (fs.existsSync(path.join(directory, candidate))) {
    candidate = `${stem}-${index}${extension}`
    index += 1
  }
  const target = path.join(directory, candidate)
  fs.writeFileSync(target, buffer)
  return { path: candidate, name, kind: kindOf(candidate), size: buffer.byteLength }
}

/**
 * 把设置里的 `media` 解析成一个真实可读的文件。
 * @param {{ source: string, path: string, name: string }} media 设置里的 media 段。
 * @returns {{ kind: 'image' | 'video', absPath: string, contentType: string, size: number, version: string, name: string } | null}
 *   解析失败返回 `null`（调用方负责告诉用户"素材不可用"）。
 */
export function resolveMedia(media) {
  const source = media?.source
  const value = typeof media?.path === 'string' ? media.path.trim() : ''
  if (value === '' || (source !== 'upload' && source !== 'path')) return null

  const absPath = source === 'upload' ? path.join(mediaDir(), value) : path.resolve(value)
  const kind = kindOf(absPath)
  if (kind === 'none') return null
  try {
    const stat = fs.statSync(absPath)
    if (!stat.isFile()) return null
    return {
      kind,
      absPath,
      contentType: contentTypeFor(absPath),
      size: stat.size,
      // 版本号让浏览器在换素材/改文件后重新拉取，而不是吃缓存。
      version: `${stat.size}-${Math.round(stat.mtimeMs)}`,
      name: typeof media?.name === 'string' && media.name !== '' ? media.name : path.basename(absPath),
    }
  } catch {
    return null
  }
}
