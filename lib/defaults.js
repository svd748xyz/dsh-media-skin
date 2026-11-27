/**
 * 设置的默认值与清洗。
 *
 * 所有"用户可调"的项都在这里定义一次：宿主用它读文件、校验 POST 上来的补丁，
 * 客户端用同名的键写 CSS 变量。两侧的键名必须一致，所以不要在别处另起一套。
 *
 * 数值一律走 `clamp()`：界面滑块坏了、用户手改了 JSON、或者别的插件写了个奇怪的值，
 * 都只会在区间内被夹住，不会让背景层变成 NaN 或 100000px 的模糊。
 *
 * ── v4：只留一个"淡"的旋钮 ──
 * v3 起每层有自己的 `look`，但压色那两条（`surface` 界面不透明度 / `sidebar` 侧栏压色）
 * 还是全局的，跟每层的 `mediaOpacity` 体感几乎一样 —— 三个滑块做一件事，用户只会困惑。
 * v4 把它们收成一个：**每层的 `mediaOpacity`**。按层的淡出比全局压色更细，
 * 而且分栏时正好能单独把某一层压下去（原本"侧栏压色"想干的事）。
 * 迁移时把 `mediaOpacity × (1 − surface/100)` 折进每一层，观感不变，然后丢掉 v3 的两个老键。
 */

/** 背景模式：整窗一张图，还是主区 + 侧栏分区。 */
export const MODES = ['full', 'split']

/** 三个可独立配置的图层。 */
export const LAYER_KEYS = ['full', 'main', 'sidebar']

/** 每个图层自己的画面参数。 */
export const LOOK_KEYS = ['blur', 'mediaOpacity', 'brightness', 'saturate', 'contrast']

/** 媒体来源。 */
export const SOURCES = ['none', 'upload', 'path']

/** 取景方式：auto（侧栏锁住取景、其余铺满）/ cover（永远铺满）/ lock（定格在裁剪那一刻）。 */
export const FIT_MODES = ['auto', 'cover', 'lock']

/** 默认裁切：正中间、不放大。
 *  `ax/ay`：图像坐标下的取景锚点（容器中心对应的图像位置，0–1）。
 *  `fw/fh`：基准框像素尺寸，`lock` 取景按它缩放；0 表示未记录。
 */
export const DEFAULT_CROP = Object.freeze({
  x: 0.5,
  y: 0.5,
  zoom: 1,
  fit: 'auto',
  ax: 0.5,
  ay: 0.5,
  fw: 0,
  fh: 0,
})

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
  version: 4,
  enabled: true,
  mode: 'full',
  layers: {
    full: emptyLayer(),
    main: emptyLayer(),
    sidebar: emptyLayer(),
  },
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
})

/** 裁切参数区间：x/y 是 0–1 的取景中心，zoom 是相对 cover 的放大倍数，
 *  ax/ay 是图像坐标下的取景锚点，fw/fh 是基准框像素尺寸（0 = 未记录）。 */
export const CROP_RANGES = Object.freeze({
  x: [0, 1],
  y: [0, 1],
  zoom: [1, 4],
  ax: [0, 1],
  ay: [0, 1],
  fw: [0, 20000],
  fh: [0, 20000],
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

/** 读旧版的 0–100 百分比键（v3 的 `surface`），没有或坏掉时返回 null。 */
function legacyPercent(value) {
  const number = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(number)) return null
  return Math.min(100, Math.max(0, Math.round(number * 10) / 10))
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
    fit: pick(crop.fit, FIT_MODES, 'auto'),
    ax: clampCropValue(crop.ax, 'ax'),
    ay: clampCropValue(crop.ay, 'ay'),
    fw: clampCropValue(crop.fw, 'fw'),
    fh: clampCropValue(crop.fh, 'fh'),
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

  // v3 → v4：把全局压色折进每层的画面不透明度（素材权重 × 剩余透明度 = 原来的叠加结果），
  // 观感基本不变；之后 `surface` / `sidebar` 两个键就彻底丢掉。
  // 只在文件还是老版本时折一次 —— 否则每次 sanitize 都会再压一层。
  const version = typeof raw.version === 'number' ? raw.version : 0
  if (version < DEFAULTS.version) {
    const surface = legacyPercent(raw.surface)
    const fold = surface === null ? 1 : (100 - surface) / 100
    if (fold !== 1) {
      for (const key of LAYER_KEYS) {
        layers[key].look.mediaOpacity = clamp(layers[key].look.mediaOpacity * fold, 'mediaOpacity')
      }
    }
  }

  return {
    version: DEFAULTS.version,
    enabled: bool(raw.enabled, DEFAULTS.enabled),
    mode: pick(raw.mode, MODES, DEFAULTS.mode),
    layers,
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
