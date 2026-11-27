/**
 * 宿主半边：设置读写、素材上传、素材下发三条路由。
 *
 *   GET|POST /dsh-media-skin/api/state   读 / 合并写设置
 *   POST      /dsh-media-skin/api/upload 存一份素材副本到 $DSH_HOME/dsh-media-skin/media/
 *   GET|HEAD  /dsh-media-skin/media      下发当前素材（带 Range）
 *
 * `webServer` 用 `ctx.inject` 迟到接入，非 Web 的 profile 里没有页面可用但插件正常加载。
 */
import { resolveMedia, kindOf, saveUpload, safeFileName, UPLOAD_LIMIT_BYTES, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './lib/media.js'
import { readBody, readJsonBody, sendJson, serveFile, text } from './lib/http.js'
import { refusalFor, refusalMessage } from './lib/gate.js'
import { patchSettings, readSettings } from './lib/store.js'

/** Cordis 诊断用的插件名。 */
export const name = 'media-skin'

/** 无必需服务。 */
export const inject = []

/** 所有路由共享的前缀。 */
export const ROUTE_PREFIX = '/dsh-media-skin'

/** 接口：设置读写。 */
const STATE_ROUTE = `${ROUTE_PREFIX}/api/state`
/** 接口：上传素材。 */
const UPLOAD_ROUTE = `${ROUTE_PREFIX}/api/upload`
/** 素材本体。 */
const MEDIA_ROUTE = `${ROUTE_PREFIX}/media`

/** 支持格式的提示文本。 */
const FORMAT_HINT = `支持的图片：${[...IMAGE_EXTENSIONS].join(' ')}；支持的视频：${[...VIDEO_EXTENSIONS].join(' ')}`

/** 异常转文案。 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 组装给客户端的快照。
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
 * `GET|HEAD /api/state` 读、`POST /api/state` 写。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 */
async function handleState(req, res, ctx) {
  const refusal = refusalFor(ctx, req)
  if (refusal !== undefined) {
    sendJson(res, { error: refusalMessage(refusal) }, refusal)
    return
  }
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
 * `POST /api/upload` 收一份文件副本，文件名走 `x-dms-name` 头（encodeURIComponent 一次）。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 */
async function handleUpload(req, res, ctx) {
  const refusal = refusalFor(ctx, req)
  if (refusal !== undefined) {
    sendJson(res, { error: refusalMessage(refusal) }, refusal)
    return
  }
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
 * `GET|HEAD /media` 下发当前素材。
 * @param {Request} request Fetch 请求（resource 路由只收 GET/HEAD）。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @returns {Promise<Response>} 响应。
 */
async function handleMedia(request, ctx) {
  const refusal = refusalFor(ctx, request)
  if (refusal !== undefined) return text(refusalMessage(refusal), refusal)

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
      () => web.register({ kind: 'exact', path: STATE_ROUTE, handler: (req, res) => handleState(req, res, child) }),
      'media-skin: state route',
    )
    child.effect(
      () => web.register({ kind: 'exact', path: UPLOAD_ROUTE, handler: (req, res) => handleUpload(req, res, child) }),
      'media-skin: upload route',
    )
    child.effect(
      () => web.register({ kind: 'exact', path: MEDIA_ROUTE, resource: (request) => handleMedia(request, child) }),
      'media-skin: media route',
    )
  })
}
