/**
 * dsh-media-skin —— 宿主半边。
 *
 * 只做四件事，全部是"把本机素材交给页面"这条路：
 *   ① GET  /dsh-media-skin/api/state   当前设置 + 当前素材（类型/大小/URL）
 *   ② POST /dsh-media-skin/api/state   把界面上的补丁合并进设置文件（滑块、开关、路径）
 *   ③ POST /dsh-media-skin/api/upload  接收一份本地文件副本，存进 $DSH_HOME/dsh-media-skin/media/
 *   ④ GET  /dsh-media-skin/media       把当前素材发出去（带 Range，视频才能拖进度条）
 *
 * 为什么背景层不由宿主注入 index.html 来做：页面侧是 React 渲染树，背景层需要跟着
 * 设置实时变（模糊滑块要跟手），交给客户端的 ctx.effect 管生命周期更干净 —— 插件卸载
 * 或热替换时背景层自己就没了，不会在 DOM 里留一个孤儿节点。
 *
 * 失败策略：这个插件里任何一步出错都只影响皮肤本身（接口返回 4xx/5xx、页面显示"素材不可用"），
 * 绝不向上抛 —— 一个壁纸插件不该有能力让 DSH 起不来。
 */
import { resolveMedia, kindOf, saveUpload, safeFileName, UPLOAD_LIMIT_BYTES, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './lib/media.js'
import { readBody, readJsonBody, sendJson, serveFile, text } from './lib/http.js'
import { patchSettings, readSettings } from './lib/store.js'

/** Cordis 诊断用的插件名。 */
export const name = 'media-skin'

/**
 * 没有必需服务：`webServer` 用 `ctx.inject` 迟到接入。
 * 这样在非 Web 的 profile 里插件也能正常加载（只是没有页面可用），不会变成 FAILED fiber。
 */
export const inject = []

/** 所有路由共享的前缀。 */
export const ROUTE_PREFIX = '/dsh-media-skin'

/** 接口：设置读写。 */
const STATE_ROUTE = `${ROUTE_PREFIX}/api/state`
/** 接口：上传素材。 */
const UPLOAD_ROUTE = `${ROUTE_PREFIX}/api/upload`
/** 素材本体。 */
const MEDIA_ROUTE = `${ROUTE_PREFIX}/media`

/** 支持格式的提示文本（报错时告诉用户到底能放什么）。 */
const FORMAT_HINT = `支持的图片：${[...IMAGE_EXTENSIONS].join(' ')}；支持的视频：${[...VIDEO_EXTENSIONS].join(' ')}`

/** 把任意异常变成一句能展示的话。 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 组装一份给客户端的完整快照。
 * @param {object} settings 当前设置。
 */
export function describe(settings) {
  let media = null
  try {
    media = resolveMedia(settings.media)
  } catch {
    media = null
  }
  return {
    settings,
    media: {
      kind: media?.kind ?? 'none',
      name: media?.name ?? settings.media.name ?? '',
      size: media?.size ?? 0,
      source: settings.media.source,
      available: media !== null,
      url: media === null ? null : `${MEDIA_ROUTE}?v=${encodeURIComponent(media.version)}`,
    },
  }
}

/**
 * `GET /api/state` 读、`POST /api/state` 写。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 */
async function handleState(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    sendJson(res, describe(readSettings()))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, HEAD, POST' })
    res.end()
    return
  }
  try {
    const patch = await readJsonBody(req)
    const next = patchSettings(patch)
    sendJson(res, describe(next))
  } catch (error) {
    if (res.writableEnded || res.destroyed) return
    sendJson(res, { error: `保存失败：${describeError(error)}` }, 400)
  }
}

/**
 * `POST /api/upload` 收一份文件副本。
 * 文件名走 `x-dms-name` 头（客户端先 encodeURIComponent 一次，因为 HTTP 头只安全地承载 ASCII）。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 */
async function handleUpload(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end()
    return
  }
  try {
    const rawHeader = req.headers['x-dms-name']
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader
    let rawName = 'media'
    if (typeof headerValue === 'string' && headerValue !== '') {
      try {
        rawName = decodeURIComponent(headerValue)
      } catch {
        rawName = headerValue
      }
    }
    const name = safeFileName(rawName)
    if (kindOf(name) === 'none') throw new Error(`不支持的格式：${name}。${FORMAT_HINT}`)

    const buffer = await readBody(req, UPLOAD_LIMIT_BYTES)
    if (buffer.byteLength === 0) throw new Error('收到的文件是空的')

    const saved = saveUpload(buffer, name)
    const next = patchSettings({ media: { source: 'upload', path: saved.path, name: saved.name } })
    sendJson(res, describe(next))
  } catch (error) {
    if (res.writableEnded || res.destroyed) return
    sendJson(res, { error: `上传失败：${describeError(error)}` }, 400)
  }
}

/**
 * `GET /media` 下发当前素材。
 * @param {Request} request Fetch 请求（host 只在 GET/HEAD 时调用 resource）。
 * @returns {Promise<Response>} 响应。
 */
async function handleMedia(request) {
  let settings
  try {
    settings = readSettings()
  } catch {
    return text('读取设置失败', 500)
  }
  const media = resolveMedia(settings.media)
  if (media === null) return text('还没有可用的素材', 404)
  try {
    return await serveFile(request, media.absPath, media.contentType)
  } catch {
    return text('素材文件读不到了（可能被移动或删除）', 404)
  }
}

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (child) => {
    const web = child.webServer
    child.effect(
      () => web.register({ kind: 'exact', path: STATE_ROUTE, handler: handleState }),
      'media-skin: state route',
    )
    child.effect(
      () => web.register({ kind: 'exact', path: UPLOAD_ROUTE, handler: handleUpload }),
      'media-skin: upload route',
    )
    child.effect(
      () => web.register({ kind: 'exact', path: MEDIA_ROUTE, resource: handleMedia }),
      'media-skin: media route',
    )
  })
}
