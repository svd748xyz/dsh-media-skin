import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { sanitize, merge } from '../lib/defaults.js'
import { parseRange, serveFile } from '../lib/http.js'
import { refusalFor, refusalMessage } from '../lib/gate.js'
import { kindOf, contentTypeFor, safeFileName } from '../lib/media.js'
import { describe } from '../index.js'

// ── sanitize ────────────────────────────────────────────────────────────────
const junk = sanitize({
  blur: 999,
  surface: -5,
  mode: 'wat',
  layers: {
    full: {
      crop: { x: 9, y: -2, zoom: 99 },
      look: { blur: 999, mediaOpacity: 50 },
      media: { source: 'upload', path: '..\\..\\evil.jpg', name: 'x' },
    },
  },
})
assert.equal(junk.version, 4, '设置版本升到 4')
assert.equal('surface' in junk, false, 'v4 不再有全局压色键')
assert.equal('sidebar' in junk, false, 'v4 不再有侧栏压色键')
assert.equal(junk.mode, 'full', '非法 mode 回默认')
assert.equal(junk.layers.full.crop.x, 1, '裁切 x 夹到 1')
assert.equal(junk.layers.full.crop.y, 0, '裁切 y 夹到 0')
assert.equal(junk.layers.full.crop.zoom, 4, 'zoom 夹到 4')
// ── 取景锚点 / 基准框字段 ────────────────────────────────────────────────
assert.equal(junk.layers.full.crop.fit, 'auto', '没写取景方式回 auto')
assert.equal(junk.layers.full.crop.ax, 0.5, '没写锚点回正中间')
assert.equal(junk.layers.full.crop.ay, 0.5, '没写锚点回正中间')
assert.equal(junk.layers.full.crop.fw, 0, '没写基准框回 0')
assert.equal(junk.layers.sidebar.crop.fit, 'auto', '侧栏默认也是 auto（客户端按图层解析成 lock）')
const fitted = sanitize({
  layers: { sidebar: { crop: { x: 0.3, y: 0.7, zoom: 1.2, fit: 'lock', ax: 1.4, ay: -0.2, fw: 3000.4, fh: 1200.6 } } },
}).layers.sidebar.crop
assert.equal(fitted.fit, 'lock', '显式 lock 保留')
assert.equal(fitted.ax, 1, '锚点 ax 夹到 1')
assert.equal(fitted.ay, 0, '锚点 ay 夹到 0')
assert.equal(fitted.fw, 3000.4, '基准框宽保留')
assert.equal(fitted.fh, 1200.6, '基准框高保留')
assert.equal(sanitize({ layers: { full: { crop: { fit: 'wat', fw: 999999, fh: -5 } } } }).layers.full.crop.fit, 'auto', '非法取景方式回 auto')
assert.equal(sanitize({ layers: { full: { crop: { fw: 999999 } } } }).layers.full.crop.fw, 20000, '基准框宽夹到上限')
assert.equal(sanitize({ layers: { full: { crop: { fh: -5 } } } }).layers.full.crop.fh, 0, '基准框高夹到 0')
assert.equal(junk.layers.full.look.blur, 60, '每层 blur 夹到上限')
assert.equal(junk.layers.full.look.mediaOpacity, 50, '层内指定值保留')
assert.equal(junk.layers.main.look.blur, 60, '旧顶层 blur 迁移到没写 look 的层')
assert.equal(junk.layers.full.media.path, 'evil.jpg', '上传项去掉路径分隔符')
assert.equal('blur' in junk, false, '画面参数不再留在顶层')
assert.equal(sanitize(null).version, 4, 'null 输入回默认版本')
assert.equal(sanitize(null).layers.full.look.mediaOpacity, 100, '新装默认不压淡')
assert.equal(sanitize({ video: { rate: 3 } }).video.rate, 1, '非法倍速回 1')
assert.equal(sanitize({ video: { rate: 1.5 } }).video.rate, 1.5)
// 旧版本有 veil（文字保护蒙版），早就并入压色、现在连压色也折进每层的画面不透明度
assert.equal('veil' in sanitize({ veil: 90 }), false, '旧 veil 字段被丢弃')

// v3 → v4：全局压色折进每层画面不透明度，且只折一次
const folded = sanitize({ version: 3, surface: 34, sidebar: 48, layers: { full: { look: { mediaOpacity: 80 } } } })
assert.equal(folded.version, 4, 'v3 文件升到 4')
assert.equal(folded.layers.full.look.mediaOpacity, 52.8, '80% × (1 − 34%) 折进层内不透明度')
assert.equal(folded.layers.main.look.mediaOpacity, 66, '没写过的层按默认 100% × 66% 折')
assert.equal('surface' in folded, false, '折完丢掉 surface')
assert.equal(sanitize(folded).layers.full.look.mediaOpacity, 52.8, '再洗一次不会二次折')
// v2 的 fit / position / scale 三件套不再输出
assert.equal('fit' in sanitize({ fit: 'contain' }), false, '旧 fit 不再出现在设置里')
assert.equal('position' in sanitize({ position: 'top' }), false, '旧 position 不再出现在设置里')
assert.equal('scale' in sanitize({ scale: 150 }), false, '旧 scale 不再出现在设置里')

// v1 → v3 迁移：顶层 media 搬进 layers.full，取景位置与缩放翻译成裁切中心与倍数
const migrated = sanitize({ media: { source: 'path', path: 'a.jpg', name: 'a' }, position: 'top left', scale: 150, blur: 12 })
assert.equal(migrated.mode, 'full')
assert.equal(migrated.layers.full.media.path, 'a.jpg', '旧素材迁进 full 层')
assert.equal(migrated.layers.full.crop.x, 0, '左上 → 取景中心 x=0')
assert.equal(migrated.layers.full.crop.y, 0, '左上 → 取景中心 y=0')
assert.equal(migrated.layers.full.crop.zoom, 1.5, 'scale 150% → zoom 1.5')
assert.equal(migrated.layers.full.look.blur, 12, '旧顶层 blur 迁进 full 层')
assert.equal(migrated.layers.sidebar.look.blur, 12, '迁移覆盖三个图层')
assert.equal(sanitize({ media: { source: 'upload', path: '', name: '' } }).layers.full.media.source, 'none', '空 path 退回 none')

// ── merge ───────────────────────────────────────────────────────────────────
const merged = merge(
  {
    mode: 'full',
    layers: {
      main: {
        media: { source: 'path', path: 'a.jpg', name: 'a' },
        crop: { x: 0.5, y: 0.5, zoom: 1 },
        look: { blur: 0, mediaOpacity: 100, brightness: 100, saturate: 100, contrast: 100 },
      },
    },
  },
  { layers: { main: { crop: { x: 0.2 }, look: { blur: 8 } } } },
)
assert.equal(merged.layers.main.crop.x, 0.2, '深合并覆盖 crop.x')
assert.equal(merged.layers.main.crop.y, 0.5, '深合并保留兄弟字段 crop.y')
assert.equal(merged.layers.main.look.blur, 8, '深合并覆盖 look.blur')
assert.equal(merged.layers.main.look.brightness, 100, '深合并保留兄弟字段 look.brightness')
assert.equal(merged.layers.main.media.path, 'a.jpg', '深合并保留同层 media')

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

// ── describe（宿主快照：每层一份素材信息）──────────────────────────────────
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-home-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
fs.mkdirSync(path.join(home, 'dsh-media-skin', 'media'), { recursive: true })
fs.writeFileSync(path.join(home, 'dsh-media-skin', 'media', 'bg.png'), Buffer.from('png'))

const snapshot = describe(
  sanitize({
    mode: 'split',
    layers: {
      full: { media: { source: 'upload', path: 'bg.png', name: 'bg.png' }, crop: { x: 0.2, y: 0.8, zoom: 2 } },
      sidebar: { media: { source: 'upload', path: 'bg.png', name: 'bg.png' } },
    },
  }),
)
assert.equal(snapshot.settings.mode, 'split')
assert.equal(snapshot.layers.full.available, true, 'full 层素材可用')
assert.ok(snapshot.layers.full.url.includes('layer=full'), 'full 层 url 带 layer')
assert.ok(snapshot.layers.full.url.includes('v='), 'url 带版本号')
assert.equal(snapshot.layers.main.available, false, '没配的 main 层不可用')
assert.equal(snapshot.layers.sidebar.available, true, 'sidebar 层素材可用')
assert.ok(snapshot.layers.sidebar.url.includes('layer=sidebar'), 'sidebar 层 url 带 layer')
assert.equal(snapshot.layers.full.size, 3, 'size 来自真实文件')

if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome
fs.rmSync(home, { recursive: true, force: true })

// ── 头像资产（宿主 /avatar 路由读的就是这个文件）─────────────────────────────
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const avatarBytes = fs.readFileSync(path.join(rootDir, 'assets', 'avatar.png'))
assert.equal(avatarBytes.subarray(1, 4).toString('latin1'), 'PNG', 'avatar.png 是 PNG')
assert.ok(avatarBytes.byteLength > 8 * 1024, 'avatar.png 不是空占位')
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
assert.ok(pkg.files.includes('assets'), 'npm 包会带上 assets/')
assert.equal(pkg.exports['./icon'], './icon.svg', '插件图标仍是 SVG 导出')
const iconText = fs.readFileSync(path.join(rootDir, 'icon.svg'), 'utf8')
assert.ok(iconText.includes('data:image/png;base64,'), 'icon.svg 内嵌了位图')
assert.ok(!iconText.includes('<script'), 'icon.svg 不含脚本')

console.log('all assertions passed')
