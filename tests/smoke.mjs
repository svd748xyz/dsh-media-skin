import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULTS, sanitize, merge } from '../lib/defaults.js'
import { parseRange, serveFile } from '../lib/http.js'
import { refusalFor, refusalMessage } from '../lib/gate.js'
import { kindOf, contentTypeFor, safeFileName } from '../lib/media.js'

// ── sanitize ────────────────────────────────────────────────────────────────
const junk = sanitize({ blur: 999, surface: -5, fit: 'wat', media: { source: 'upload', path: '..\\..\\evil.jpg', name: 'x' } })
assert.equal(junk.blur, 60, 'blur 夹到上限')
assert.equal(junk.surface, 0, 'surface 夹到下限（0 = 原始素材）')
assert.equal(junk.fit, 'cover', '非法 fit 回默认')
assert.equal(junk.media.path, 'evil.jpg', '上传项去掉路径分隔符')
assert.equal(sanitize(null).blur, DEFAULTS.blur, 'null 输入回默认')
assert.equal(sanitize({ blur: 'abc' }).blur, 0, 'NaN 回默认')
assert.equal(sanitize({ video: { rate: 3 } }).video.rate, 1, '非法倍速回 1')
assert.equal(sanitize({ video: { rate: 1.5 } }).video.rate, 1.5)
// 旧版本有 veil（文字保护蒙版），现在合并进 surface，读取时直接丢弃
assert.equal('veil' in sanitize({ veil: 90 }), false, '旧 veil 字段被丢弃')

// 空 path 但 source=upload：退回 none，避免"有来源没文件"
assert.equal(sanitize({ media: { source: 'upload', path: '', name: '' } }).media.source, 'none')

// ── merge ───────────────────────────────────────────────────────────────────
const merged = merge({ media: { source: 'path', path: 'a.jpg', name: 'a' }, blur: 1 }, { media: { path: 'b.jpg' }, blur: 9 })
assert.equal(merged.media.path, 'b.jpg', '深合并覆盖')
assert.equal(merged.media.source, 'path', '深合并保留兄弟字段')
assert.equal(merged.blur, 9)

// ── kindOf / contentTypeFor / safeFileName ─────────────────────────────────
assert.equal(kindOf('a.MP4'), 'video')
assert.equal(kindOf('a.webp'), 'image')
assert.equal(kindOf('a.txt'), 'none')
assert.equal(contentTypeFor('a.jpeg'), 'image/jpeg')
assert.equal(contentTypeFor('a.unknown'), 'application/octet-stream')
assert.equal(safeFileName('..\\..\\a b.mp4'), 'a b.mp4')
assert.equal(safeFileName('../../etc/passwd'), 'passwd')
assert.ok(safeFileName('').startsWith('media-'), '空名有兜底')

// ── parseRange ──────────────────────────────────────────────────────────────
assert.equal(parseRange(null, 100), null)
assert.equal(parseRange('bytes=0-9', 100).end, 9)
assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 })
assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 })
assert.equal(parseRange('bytes=0-0,5-6', 100), null, '多段退回整份')
assert.equal(parseRange('bytes=100-200', 100), 'invalid', '越界非法')
assert.equal(parseRange('bytes=5-2', 100), 'invalid', '倒序非法')
assert.deepEqual(parseRange('bytes=0-999', 100), { start: 0, end: 99 }, '尾端夹住')

// ── serveFile ───────────────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-test-'))
const file = path.join(dir, 'sample.mp4')
fs.writeFileSync(file, Buffer.from('0123456789'))

const full = await serveFile(new Request('http://x/dsh-media-skin/media'), file, 'video/mp4')
assert.equal(full.status, 200)
assert.equal(full.headers.get('content-type'), 'video/mp4')
assert.equal(full.headers.get('accept-ranges'), 'bytes')
assert.equal(full.headers.get('content-length'), '10')
assert.equal(await full.text(), '0123456789')

const partial = await serveFile(new Request('http://x/m', { headers: { range: 'bytes=2-5' } }), file, 'video/mp4')
assert.equal(partial.status, 206)
assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
assert.equal(await partial.text(), '2345')

const bad = await serveFile(new Request('http://x/m', { headers: { range: 'bytes=50-60' } }), file, 'video/mp4')
assert.equal(bad.status, 416)
assert.equal(bad.headers.get('content-range'), 'bytes */10')

const head = await serveFile(new Request('http://x/m', { method: 'HEAD' }), file, 'video/mp4')
assert.equal(head.status, 200)
assert.equal(head.body, null, 'HEAD 不带体')
assert.equal(head.headers.get('content-length'), '10')

fs.rmSync(dir, { recursive: true, force: true })

// ── refusalFor ──────────────────────────────────────────────────────────────
const fakeCtx = (connection) => ({ get: (key) => (key === 'connection' ? connection : undefined) })
const nodeReq = { headers: { host: '127.0.0.1:3697', origin: 'https://evil.example' }, method: 'GET', url: '/dsh-media-skin/api/state' }

assert.equal(refusalFor(fakeCtx(undefined), nodeReq), undefined, '宿主无 connection 时放行')
assert.equal(refusalFor(fakeCtx({}), nodeReq), undefined, 'connection 无闸门方法时放行')
assert.equal(refusalFor(fakeCtx({ requestRejection: () => 403 }), nodeReq), 403, 'requestRejection 的 403 透传')
assert.equal(refusalFor(fakeCtx({ requestRejection: () => undefined }), nodeReq), undefined, 'requestRejection 放行')
assert.equal(refusalFor(fakeCtx({ requestRejection: () => { throw new Error('boom') } }), nodeReq), 403, 'requestRejection 抛错按拒绝')
assert.equal(refusalFor(fakeCtx({ admit: () => ({ rejection: 401 }) }), nodeReq), 401, 'admit 的 rejection 透传')
assert.equal(refusalFor(fakeCtx({ admit: () => ({ peer: {} }) }), nodeReq), undefined, 'admit 放行')
assert.deepEqual(
  (() => {
    let seen
    refusalFor(fakeCtx({ admit: (facts) => { seen = facts; return { peer: {} } } }), nodeReq)
    return seen.url
  })(),
  'http://127.0.0.1:3697/dsh-media-skin/api/state',
  'admit 收到绝对 url',
)
assert.equal(refusalFor(fakeCtx({ requestRejection: () => 403, admit: () => ({ peer: {} }) }), nodeReq), 403, '优先 requestRejection')
assert.equal(refusalMessage(401).includes('登录'), true, '401 有文案')
assert.equal(refusalMessage(999), '请求被拒绝', '未登记状态码有兜底')

console.log('all assertions passed')
