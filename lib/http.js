/**
 * HTTP 小工具：JSON 响应、请求体读取、带 Range 的文件下发。
 *
 * 为什么不用现成框架：宿主半边只允许 `node:` 内建，而且"装插件不该改变 DSH 的
 * 依赖面"。所以这里只有几十行 Fetch/Node 之间的搬砖代码。
 *
 * 一个关键约束：`webServer` 的 **resource 路由只接 GET/HEAD**（其它方法直接 405，
 * 而且请求体根本不会传进来）。所以：
 *   GET  → resource（返回标准 Response，能用 ReadableStream）
 *   POST → handler（Node 的 IncomingMessage，能读请求体）
 * 混用不是随意为之，是被这条约束逼出来的。
 */
import fs from 'node:fs'
import { Readable } from 'node:stream'

/** 读取 JSON 请求体的上限，防止一个坏客户端把内存塞满。 */
const JSON_LIMIT_BYTES = 1024 * 1024

/** 构造 JSON 响应。 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** 构造文本响应。 */
export function text(message, status = 400) {
  return new Response(String(message), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 用 Node 的 res 写一段 JSON（handler 路由用）。 */
export function sendJson(res, data, status = 200) {
  if (res.writableEnded) return
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * 读完整个请求体。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {number} limit 字节上限。
 * @returns {Promise<Buffer>} 请求体。
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(new Error(`请求体超过上限 ${Math.round(limit / 1024 / 1024)} MB`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * 读一个 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {Promise<unknown>} 解析后的值。
 */
export async function readJsonBody(req) {
  const buffer = await readBody(req, JSON_LIMIT_BYTES)
  if (buffer.byteLength === 0) return {}
  return JSON.parse(buffer.toString('utf8'))
}

/**
 * 解析 `Range` 头（只认单段）。
 * @param {string | null} header 原始头。
 * @param {number} size 文件总字节数。
 * @returns {{ start: number, end: number } | 'invalid' | null} 区间、非法、或"整份返回"。
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || header === '') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null // 多段或语法奇怪的：退回整份，最稳。
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'
  let start
  let end
  if (rawStart === '') {
    // 后缀区间：最后 N 个字节。
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return 'invalid'
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

/**
 * 把一个本地文件作为 Response 发出去，支持 Range（视频拖动进度条要用）。
 * @param {Request} request Fetch 请求（只用它的 method / headers）。
 * @param {string} absPath 文件绝对路径。
 * @param {string} contentType MIME。
 * @returns {Promise<Response>} 响应。
 */
export async function serveFile(request, absPath, contentType) {
  const stat = await fs.promises.stat(absPath)
  const size = stat.size
  const range = parseRange(request.headers.get('range'), size)
  const baseHeaders = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }

  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'content-range': `bytes */${size}` },
    })
  }

  const head = request.method === 'HEAD'
  const start = range === null ? 0 : range.start
  const end = range === null ? size - 1 : range.end
  const length = size === 0 ? 0 : end - start + 1

  const headers = {
    ...baseHeaders,
    'content-length': String(length),
    ...(range === null ? {} : { 'content-range': `bytes ${start}-${end}/${size}` }),
  }

  if (head || length === 0) return new Response(null, { status: range === null ? 200 : 206, headers })

  const stream = fs.createReadStream(absPath, { start, end })
  return new Response(Readable.toWeb(stream), { status: range === null ? 200 : 206, headers })
}
