/**
 * 宿主 `connection` 服务的请求闸门：Host/Origin 校验 + 浏览器登录凭据。
 *
 * 精确路由的匹配顺序在宿主 `/api` 前缀检查之前，所以宿主的检查看不到它们，
 * 这里复用同一套判断。
 */

/** 拒绝时回给调用方的文案。 */
export const REFUSAL_TEXT = {
  401: '需要先登录 DSH：请用 dsh 启动时打印的网址重新打开界面。',
  403: '这个请求来自不受信任的来源，已拒绝。',
}

/** 拒绝文案，未登记的码兜底。 */
export function refusalMessage(status) {
  return REFUSAL_TEXT[status] ?? '请求被拒绝'
}

/** `admit()` 的入参：headers、socket、绝对 url。 */
function admissionFacts(request) {
  const host = request.headers.host ?? 'localhost'
  const scheme = request.socket?.encrypted === true ? 'https' : 'http'
  let url
  try {
    url = new URL(request.url ?? '/', `${scheme}://${host}`).href
  } catch {
    url = `${scheme}://localhost/`
  }
  return { method: request.method ?? 'GET', headers: request.headers, socket: request.socket, url }
}

/**
 * 判断一个请求能否进入路由。
 *
 * 每请求解析一次 `connection`：它可能晚于 `apply` 就位，不能提前缓存。
 * `requestRejection` 是 0.2.2 及更早的形态，`admit` 是 0.2.3 起的形态。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {{ headers: any, method?: string, url?: string, socket?: any }} request
 * @returns {401|403|undefined} 拒绝时的状态码；放行时 undefined。
 */
export function refusalFor(ctx, request) {
  const connection = ctx.get('connection')
  if (connection === undefined || connection === null) return undefined

  const reject = connection.requestRejection
  if (typeof reject === 'function') {
    try {
      return reject.call(connection, { headers: request.headers })
    } catch {
      return 403
    }
  }

  const admit = connection.admit
  if (typeof admit === 'function') {
    try {
      const result = admit.call(connection, admissionFacts(request))
      return result !== null && typeof result === 'object' ? result.rejection : 403
    } catch {
      return 403
    }
  }

  return undefined
}
