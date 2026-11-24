/**
 * 生成一张示例壁纸 PNG（纯 node，无依赖）：天空渐变 + 太阳 + 两层山。
 * 只用于本地验收，不属于插件产物。
 *
 * 用法：node scripts/make-sample-png.mjs <输出路径>
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'

const WIDTH = 1280
const HEIGHT = 720

/** CRC32（PNG 每个 chunk 都要）。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT)
let offset = 0
for (let y = 0; y < HEIGHT; y += 1) {
  raw[offset] = 0
  offset += 1
  const t = y / HEIGHT
  // 天空：紫蓝 → 暖橙
  let color = mix([38, 52, 108], [246, 158, 106], Math.min(1, t * 1.35))
  for (let x = 0; x < WIDTH; x += 1) {
    const px = x / WIDTH
    let r = color[0]
    let g = color[1]
    let b = color[2]
    // 太阳光晕
    const dx = (px - 0.72) * WIDTH
    const dy = (y - HEIGHT * 0.34) * 1.0
    const dist = Math.hypot(dx, dy)
    const glow = Math.max(0, 1 - dist / 320) ** 2
    r += glow * 120
    g += glow * 96
    b += glow * 40
    // 远山
    const far = HEIGHT * 0.62 + Math.sin(px * 7.2) * 34 + Math.sin(px * 2.1) * 46
    // 近山
    const near = HEIGHT * 0.78 + Math.sin(px * 4.4 + 1.2) * 44 + Math.sin(px * 9.7) * 18
    if (y > far) {
      const k = mix([52, 44, 82], [36, 30, 62], (y - far) / 260)
      r = k[0]
      g = k[1]
      b = k[2]
    }
    if (y > near) {
      const k = mix([28, 24, 48], [18, 16, 34], (y - near) / 220)
      r = k[0]
      g = k[1]
      b = k[2]
    }
    raw[offset] = Math.max(0, Math.min(255, Math.round(r)))
    raw[offset + 1] = Math.max(0, Math.min(255, Math.round(g)))
    raw[offset + 2] = Math.max(0, Math.min(255, Math.round(b)))
    offset += 3
  }
}

const header = Buffer.alloc(13)
header.writeUInt32BE(WIDTH, 0)
header.writeUInt32BE(HEIGHT, 4)
header[8] = 8 // bit depth
header[9] = 2 // RGB
header[10] = 0
header[11] = 0
header[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const target = process.argv[2] ?? path.join(process.cwd(), 'sample-wallpaper.png')
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true })
fs.writeFileSync(target, png)
console.log(JSON.stringify({ target: path.resolve(target), bytes: png.length }))
