/**
 * 设置的默认值与清洗。
 *
 * 所有"用户可调"的项都在这里定义一次：宿主用它读文件、校验 POST 上来的补丁，
 * 客户端用同名的键写 CSS 变量。两侧的键名必须一致，所以不要在别处另起一套。
 *
 * 数值一律走 `clamp()`：界面滑块坏了、用户手改了 JSON、或者别的插件写了个奇怪的值，
 * 都只会在区间内被夹住，不会让背景层变成 NaN 或 100000px 的模糊。
 */

/** 支持的填充方式（对应 CSS `object-fit`）。 */
export const FITS = ['cover', 'contain', 'fill']
/** 支持的取景位置（对应 CSS `object-position`）。 */
export const POSITIONS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
]
/** 媒体来源。 */
export const SOURCES = ['none', 'upload', 'path']

/** 设置文件的默认值。 */
export const DEFAULTS = Object.freeze({
  version: 1,
  enabled: true,
  media: { source: 'none', path: '', name: '' },
  fit: 'cover',
  position: 'center',
  blur: 0,
  mediaOpacity: 100,
  brightness: 100,
  saturate: 100,
  contrast: 100,
  scale: 100,
  surface: 40,
  sidebar: 48,
  video: { rate: 1, paused: false },
  panel: { open: false },
})

/** 每一项的取值区间，界面滑块和宿主校验共用。 */
export const RANGES = Object.freeze({
  blur: [0, 60],
  mediaOpacity: [0, 100],
  brightness: [40, 160],
  saturate: [0, 200],
  contrast: [50, 150],
  scale: [100, 170],
  surface: [0, 100],
  sidebar: [10, 100],
})

/** 视频播放速度的可选值。 */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value, key) {
  const range = RANGES[key]
  const fallback = DEFAULTS[key]
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  if (!range) return fallback
  const rounded = Math.round(number * 10) / 10
  return Math.min(range[1], Math.max(range[0], rounded))
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function text(value, maxLength) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 把任意输入清洗成一份完整、合法的设置。
 * @param {unknown} input 来自设置文件或 POST 补丁的对象（可以是残缺的）。
 * @returns {import('./types.js').Settings}
 */
export function sanitize(input) {
  const raw = isObject(input) ? input : {}
  const media = isObject(raw.media) ? raw.media : {}
  const video = isObject(raw.video) ? raw.video : {}
  const panel = isObject(raw.panel) ? raw.panel : {}

  const source = pick(media.source, SOURCES, DEFAULTS.media.source)
  let mediaPath = source === 'none' ? '' : text(media.path, 4096)
  if (source === 'upload') {
    // 上传项一律只存文件名：带分隔符的路径会把读取范围带出媒体目录。
    const segments = mediaPath.split(/[\\/]+/).filter((segment) => segment !== '')
    mediaPath = (segments.pop() ?? '').replace(/^[.\s]+/, '').slice(0, 260)
  }
  const rate = typeof video.rate === 'number' && RATES.includes(video.rate) ? video.rate : 1

  return {
    version: 1,
    enabled: bool(raw.enabled, DEFAULTS.enabled),
    media: {
      source: mediaPath === '' && source !== 'none' ? 'none' : source,
      path: mediaPath,
      name: source === 'none' ? '' : text(media.name, 200),
    },
    fit: pick(raw.fit, FITS, DEFAULTS.fit),
    position: pick(raw.position, POSITIONS, DEFAULTS.position),
    blur: clamp(raw.blur, 'blur'),
    mediaOpacity: clamp(raw.mediaOpacity, 'mediaOpacity'),
    brightness: clamp(raw.brightness, 'brightness'),
    saturate: clamp(raw.saturate, 'saturate'),
    contrast: clamp(raw.contrast, 'contrast'),
    scale: clamp(raw.scale, 'scale'),
    surface: clamp(raw.surface, 'surface'),
    sidebar: clamp(raw.sidebar, 'sidebar'),
    video: { rate, paused: bool(video.paused, false) },
    panel: { open: bool(panel.open, false) },
  }
}

/**
 * 把补丁深合并进当前设置（只认识两层：`media` / `video` / `panel` 是对象，其余是标量）。
 * 合并结果仍然要过一遍 {@link sanitize}。
 * @param {unknown} current 当前设置。
 * @param {unknown} patch 补丁。
 */
export function merge(current, patch) {
  const base = isObject(current) ? current : {}
  const next = isObject(patch) ? patch : {}
  const merged = { ...base }
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue
    const previous = base[key]
    if (isObject(value) && isObject(previous)) merged[key] = { ...previous, ...value }
    else merged[key] = value
  }
  return merged
}
