/**
 * 设置的默认值与清洗。
 *
 * 所有"用户可调"的项都在这里定义一次：宿主用它读文件、校验 POST 上来的补丁，
 * 客户端用同名的键写 CSS 变量。两侧的键名必须一致，所以不要在别处另起一套。
 *
 * 数值一律走 `clamp()`：界面滑块坏了、用户手改了 JSON、或者别的插件写了个奇怪的值，
 * 都只会在区间内被夹住，不会让背景层变成 NaN 或 100000px 的模糊。
 *
 * ── v3：每层一套画面参数 ──
 * v2 把整窗 / 内容区 / 左侧栏拆开了，但"画面"那组滑块还是全局共用的 ——
 * 两张图性格不一样（侧栏那张要更暗、主图要更亮）时就没法分别调。
 * 现在 `blur / mediaOpacity / brightness / saturate / contrast` 收进每个图层的 `look`，
 * 面板里用"当前调节对象"切换，滑块永远只有一组，不臃肿。
 * 仍然全局的只剩压色：`surface`（界面不透明度）与 `sidebar`（侧栏压色）。
 */

/** 背景模式：整窗一张图，还是主区 + 侧栏分区。 */
export const MODES = ['full', 'split']

/** 三个可独立配置的图层。 */
export const LAYER_KEYS = ['full', 'main', 'sidebar']

/** 每个图层自己的画面参数。 */
export const LOOK_KEYS = ['blur', 'mediaOpacity', 'brightness', 'saturate', 'contrast']

/** 媒体来源。 */
export const SOURCES = ['none', 'upload', 'path']

/** 默认裁切：正中间、不放大（等价于自动 cover 居中）。 */
export const DEFAULT_CROP = Object.freeze({ x: 0.5, y: 0.5, zoom: 1 })

/** 默认画面：不模糊、不压暗、原色。 */
export const DEFAULT_LOOK = Object.freeze({
  blur: 0,
  mediaOpacity: 100,
  brightness: 100,
  saturate: 100,
  contrast: 100,
})

/** 空素材：没有选任何文件。 */
function emptyMedia() {
  return { source: 'none', path: '', name: '' }
}

/** 一个图层的默认值。 */
function emptyLayer() {
  return { media: emptyMedia(), crop: { ...DEFAULT_CROP }, look: { ...DEFAULT_LOOK } }
}

/** 设置文件的默认值。 */
export const DEFAULTS = Object.freeze({
  version: 3,
  enabled: true,
  mode: 'full',
  layers: {
    full: emptyLayer(),
    main: emptyLayer(),
    sidebar: emptyLayer(),
  },
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
  surface: [0, 100],
  sidebar: [10, 100],
})

/** 裁切参数区间：x/y 是 0–1 的取景中心，zoom 是相对 cover 的放大倍数。 */
export const CROP_RANGES = Object.freeze({
  x: [0, 1],
  y: [0, 1],
  zoom: [1, 4],
})

/** 视频播放速度的可选值。 */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clamp(value, key) {
  const range = RANGES[key]
  const fallback = DEFAULTS[key] ?? DEFAULT_LOOK[key]
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  if (!range) return fallback
  const rounded = Math.round(number * 10) / 10
  return Math.min(range[1], Math.max(range[0], rounded))
}

function clampCropValue(value, key) {
  const range = CROP_RANGES[key]
  const fallback = DEFAULT_CROP[key]
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(number)) return fallback
  const rounded = Math.round(number * 1000) / 1000
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
 * 旧版（v1/v2）放在顶层的画面参数 —— 迁移时当成每个图层的起点。
 * @param {object} raw 旧设置。
 */
function legacyLook(raw) {
  const look = {}
  for (const key of LOOK_KEYS) {
    if (raw[key] !== undefined) look[key] = raw[key]
  }
  return look
}

/**
 * 清洗一段素材配置。
 * @param {unknown} raw 原始 media 段。
 * @returns {{ source: string, path: string, name: string }}
 */
function cleanMedia(raw) {
  const media = isObject(raw) ? raw : {}
  const source = pick(media.source, SOURCES, 'none')
  let mediaPath = source === 'none' ? '' : text(media.path, 4096)
  if (source === 'upload') {
    // 上传项一律只存文件名：带分隔符的路径会把读取范围带出媒体目录。
    const segments = mediaPath.split(/[\\/]+/).filter((segment) => segment !== '')
    mediaPath = (segments.pop() ?? '').replace(/^[.\s]+/, '').slice(0, 260)
  }
  return {
    source: mediaPath === '' && source !== 'none' ? 'none' : source,
    path: mediaPath,
    name: source === 'none' ? '' : text(media.name, 200),
  }
}

/**
 * 清洗一个图层的裁切参数。
 * @param {unknown} raw 原始 crop 段。
 */
function cleanCrop(raw) {
  const crop = isObject(raw) ? raw : {}
  return {
    x: clampCropValue(crop.x, 'x'),
    y: clampCropValue(crop.y, 'y'),
    zoom: clampCropValue(crop.zoom, 'zoom'),
  }
}

/**
 * 清洗一个图层的画面参数。`raw` 里没有的项回落到 `fallback`（旧版顶层值或默认值）。
 * @param {unknown} raw 原始 look 段。
 * @param {object} fallback 回落值。
 */
function cleanLook(raw, fallback) {
  const look = isObject(raw) ? raw : {}
  const base = isObject(fallback) ? fallback : {}
  const out = {}
  for (const key of LOOK_KEYS) {
    const value = look[key] !== undefined ? look[key] : base[key]
    out[key] = clamp(value, key)
  }
  return out
}

/**
 * 清洗一个图层。
 * @param {unknown} raw 原始图层段。
 * @param {object} fallbackLook 旧版顶层画面参数。
 */
function cleanLayer(raw, fallbackLook) {
  const layer = isObject(raw) ? raw : {}
  return {
    media: cleanMedia(layer.media),
    crop: cleanCrop(layer.crop),
    look: cleanLook(layer.look, fallbackLook),
  }
}

/**
 * v1 → v2 迁移：旧配置只有顶层 `media` + `fit` / `position` / `scale`。
 * 把素材搬进 `layers.full`，把 position/scale 翻译成裁切中心与倍数。
 * `fit`（cover/contain/fill）没有对应的裁切语义，直接落到 cover —— 裁切器本来就按 cover 设计。
 * @param {object} raw 旧设置。
 */
function migrateLegacyMedia(raw) {
  const media = isObject(raw.media) ? raw.media : null
  if (media === null) return null
  const position =
    raw.position === 'top'
      ? { x: 0.5, y: 0 }
      : raw.position === 'bottom'
        ? { x: 0.5, y: 1 }
        : raw.position === 'left'
          ? { x: 0, y: 0.5 }
          : raw.position === 'right'
            ? { x: 1, y: 0.5 }
            : raw.position === 'top left'
              ? { x: 0, y: 0 }
              : raw.position === 'top right'
                ? { x: 1, y: 0 }
                : raw.position === 'bottom left'
                  ? { x: 0, y: 1 }
                  : raw.position === 'bottom right'
                    ? { x: 1, y: 1 }
                    : { x: 0.5, y: 0.5 }
  const scale = Number.parseFloat(raw.scale)
  const zoom = Number.isFinite(scale) ? Math.min(4, Math.max(1, scale / 100)) : 1
  return {
    media: cleanMedia(media),
    crop: { x: position.x, y: position.y, zoom },
  }
}

/**
 * 把任意输入清洗成一份完整、合法的设置。
 * @param {unknown} input 来自设置文件或 POST 补丁的对象（可以是残缺的）。
 * @returns {object} 归一化后的设置。
 */
export function sanitize(input) {
  const raw = isObject(input) ? input : {}
  const video = isObject(raw.video) ? raw.video : {}
  const panel = isObject(raw.panel) ? raw.panel : {}
  const rawLayers = isObject(raw.layers) ? raw.layers : null
  // v1/v2 的画面参数在顶层；v3 起每个图层自带。迁移时统一当作所有图层的初值。
  const fallbackLook = legacyLook(raw)

  const layers = {}
  if (rawLayers !== null) {
    for (const key of LAYER_KEYS) layers[key] = cleanLayer(rawLayers[key], fallbackLook)
  } else {
    // 没有 layers：这是 v1 的旧文件，或者一次只写顶层字段的极简补丁。
    const legacy = migrateLegacyMedia(raw)
    layers.full = legacy === null ? emptyLayer() : { ...legacy, look: cleanLook({}, fallbackLook) }
    layers.main = { ...emptyLayer(), look: cleanLook({}, fallbackLook) }
    layers.sidebar = { ...emptyLayer(), look: cleanLook({}, fallbackLook) }
  }

  const rate = typeof video.rate === 'number' && RATES.includes(video.rate) ? video.rate : 1

  return {
    version: 3,
    enabled: bool(raw.enabled, DEFAULTS.enabled),
    mode: pick(raw.mode, MODES, DEFAULTS.mode),
    layers,
    surface: clamp(raw.surface, 'surface'),
    sidebar: clamp(raw.sidebar, 'sidebar'),
    video: { rate, paused: bool(video.paused, false) },
    panel: { open: bool(panel.open, false) },
  }
}

/**
 * 把补丁深合并进当前设置。
 *
 * 递归合并对象（`layers.main.crop` 这种三层结构必须递归，否则一次只改 crop
 * 就会把同层的 media 冲掉）。数组按值覆盖，不做拼接。
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
    if (isObject(value) && isObject(previous)) merged[key] = merge(previous, value)
    else merged[key] = value
  }
  return merged
}
