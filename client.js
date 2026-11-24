/**
 * dsh-media-skin —— 客户端那一半（背景层 + 右下角调节面板）。
 *
 * 为什么背景层要自己动 DOM：它必须画在 `#root`（整个应用）**后面**。插槽里的组件
 * 都在应用渲染树内部，`shell.overlay` 更是"在所有列之上"的一层 —— 放进去只能挡住内容，
 * 挡不到内容的后面。所以这里走"组件 + effect 拥有一个 body 级节点"的路子：
 * 节点由 React 生命周期创建，卸载时也就是插件被停用/热替换时由 cleanup 摘掉，
 * 不会在 DOM 里留下孤儿（这是和"直接 appendChild 完不管"的关键区别）。
 *
 * 设置的真值在宿主：`/dsh-media-skin/api/state`。界面只做三件事 —— 读一份快照、
 * 把改动防抖写回去、把快照翻译成 CSS 变量。滑块因此是"本地立即生效 + 300ms 后落盘"，
 * 拖起来跟手，刷新页面也还在。
 */
window.__ModuleLoader__.load({
  id: 'dsh-media-skin',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const STATE_URL = '/dsh-media-skin/api/state'
    const UPLOAD_URL = '/dsh-media-skin/api/upload'
    const NS = 'media-skin'

    /** 影响背景层的 CSS 变量名：卸载时要一个一个摘掉，所以集中登记。 */
    const CSS_VARS = [
      '--dms-blur',
      '--dms-bleed',
      '--dms-opacity',
      '--dms-brightness',
      '--dms-saturate',
      '--dms-contrast',
      '--dms-scale',
      '--dms-scrim',
      '--dms-sidebar-extra',
      '--dms-fit',
      '--dms-position',
    ]

    // ─────────────────────────── 文案 ───────────────────────────

    const ZH = {
      title: '本地媒体皮肤',
      open: '打开媒体皮肤设置',
      close: '收起',
      enable: '启用皮肤',
      mediaSection: '素材',
      tuningSection: '画面',
      layoutSection: '排布',
      videoSection: '视频',
      current: '当前',
      none: '还没选素材',
      unavailable: '文件读不到了（可能被移动或删除）',
      pick: '选择文件…',
      pickHint: '图片或视频，最大 512 MB；会复制一份到 DSH 目录',
      clear: '清除',
      pathPlaceholder: '或粘贴本地绝对路径，例如 D:\\图片\\bg.jpg',
      apply: '应用路径',
      reset: '恢复默认',
      hint: '改完自动保存，刷新页面也还在',
      blur: '模糊',
      mediaOpacity: '画面不透明度',
      brightness: '亮度',
      saturate: '饱和度',
      contrast: '对比度',
      scale: '缩放',
      surface: '界面不透明度',
      fit: '填充方式',
      position: '取景位置',
      fitCover: '铺满',
      fitContain: '完整',
      fitFill: '拉伸',
      rate: '播放速度',
      pause: '暂停',
      play: '播放',
      loading: '读取中…',
      uploading: '正在复制文件…',
      px: 'px',
      percent: '%',
      image: '图片',
      video: '视频',
      posCenter: '居中',
      posTop: '顶部',
      posBottom: '底部',
      posLeft: '左侧',
      posRight: '右侧',
      posTopLeft: '左上',
      posTopRight: '右上',
      posBottomLeft: '左下',
      posBottomRight: '右下',
    }

    const EN = {
      title: 'Media skin',
      open: 'Open media skin settings',
      close: 'Collapse',
      enable: 'Enable skin',
      mediaSection: 'Media',
      tuningSection: 'Look',
      layoutSection: 'Layout',
      videoSection: 'Video',
      current: 'Current',
      none: 'No media yet',
      unavailable: 'File is no longer readable (moved or deleted)',
      pick: 'Choose file…',
      pickHint: 'Image or video, up to 512 MB; a copy is stored in the DSH folder',
      clear: 'Clear',
      pathPlaceholder: 'Or paste an absolute local path, e.g. D:\\pics\\bg.jpg',
      apply: 'Use path',
      reset: 'Reset to defaults',
      hint: 'Saved automatically; survives a page reload',
      blur: 'Blur',
      mediaOpacity: 'Media opacity',
      brightness: 'Brightness',
      saturate: 'Saturation',
      contrast: 'Contrast',
      scale: 'Zoom',
      surface: 'UI opacity',
      fit: 'Fit',
      position: 'Position',
      fitCover: 'Cover',
      fitContain: 'Contain',
      fitFill: 'Stretch',
      rate: 'Playback speed',
      pause: 'Pause',
      play: 'Play',
      loading: 'Loading…',
      uploading: 'Copying file…',
      px: 'px',
      percent: '%',
      image: 'Image',
      video: 'Video',
      posCenter: 'Center',
      posTop: 'Top',
      posBottom: 'Bottom',
      posLeft: 'Left',
      posRight: 'Right',
      posTopLeft: 'Top left',
      posTopRight: 'Top right',
      posBottomLeft: 'Bottom left',
      posBottomRight: 'Bottom right',
    }

    /** 滑块的区间与步长（键名与宿主 lib/defaults.js 的 RANGES 一致）。 */
    const SLIDERS = [
      { key: 'blur', label: 'blur', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'mediaOpacity', label: 'mediaOpacity', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'surface', label: 'surface', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'brightness', label: 'brightness', min: 40, max: 160, step: 1, unit: '%' },
      { key: 'saturate', label: 'saturate', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'contrast', label: 'contrast', min: 50, max: 150, step: 1, unit: '%' },
      { key: 'scale', label: 'scale', min: 100, max: 170, step: 1, unit: '%' },
    ]

    const FITS = [
      { value: 'cover', label: 'fitCover' },
      { value: 'contain', label: 'fitContain' },
      { value: 'fill', label: 'fitFill' },
    ]

    const POSITIONS = [
      { value: 'center', label: 'posCenter' },
      { value: 'top', label: 'posTop' },
      { value: 'bottom', label: 'posBottom' },
      { value: 'left', label: 'posLeft' },
      { value: 'right', label: 'posRight' },
      { value: 'top left', label: 'posTopLeft' },
      { value: 'top right', label: 'posTopRight' },
      { value: 'bottom left', label: 'posBottomLeft' },
      { value: 'bottom right', label: 'posBottomRight' },
    ]

    const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

    // ─────────────────────────── 样式 ───────────────────────────

    /**
     * 全部样式。前缀统一 `dms-`，颜色只用 DSH 的 `--dsw-alias-*` 主题 token，
     * 这样亮/暗主题、改主题色都自动跟随，不需要自己判断主题。
     */
    const CSS = `
/* ── 背景层：z-index:-1 落在所有在流内容之下，pointer-events:none 不挡交互 ── */
#dms-backdrop{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:#eef1f5}
html[data-dms="on"]:has(body[data-ds-dark-theme]) #dms-backdrop{background:#0e1116}
#dms-backdrop .dms-holder{position:absolute;inset:calc(-1 * var(--dms-bleed,0px))}
#dms-backdrop .dms-media{position:absolute;inset:0;width:100%;height:100%;display:block;
  object-fit:var(--dms-fit,cover);object-position:var(--dms-position,center);
  opacity:var(--dms-opacity,1);transform:scale(var(--dms-scale,1));transform-origin:center center;
  filter:blur(var(--dms-blur,0px)) brightness(var(--dms-brightness,1)) saturate(var(--dms-saturate,1)) contrast(var(--dms-contrast,1));
  transition:opacity 240ms ease}
/* 底色层：**唯一**的一层压色。它压在素材上、界面下，所以"界面不透明度"就是
   这一层的 alpha，调到 0 时画面是原始素材，不会再有任何"灰蒙"。 */
#dms-backdrop .dms-scrim{position:absolute;inset:0;background:rgba(255,255,255,var(--dms-scrim,0.4))}
html[data-dms="on"]:has(body[data-ds-dark-theme]) #dms-backdrop .dms-scrim{background:rgba(0,0,0,var(--dms-scrim,0.4))}

/* ── 画布透明化：不透明的话素材永远被盖住。
      这里刻意写成 transparent 而不是"半透明白色"：同一个 token 会被多个嵌套容器各画一遍，
      每叠一层就等于又加了一层白膜 —— 那是"调到底还是灰"的根。压色统一交给上面那层 scrim。
      只动"画布 + 侧栏"，弹层/卡片/设置页（bg-layer-*）保持原生不透明。 ── */
html[data-dms="on"],html[data-dms="on"] body{background-color:transparent !important}
html[data-dms="on"]:has(body[data-ds-dark-theme]){background-color:#0e1116 !important}
html[data-dms="on"]:not(:has(body[data-ds-dark-theme])){background-color:#eef1f5 !important}
html[data-dms="on"] body{
  --dsw-alias-bg-base:transparent !important;
  --dsw-specific-sidebar-fill:rgba(255,255,255,var(--dms-sidebar-extra,.05)) !important;
}
html[data-dms="on"] body[data-ds-dark-theme]{
  --dsw-alias-bg-base:transparent !important;
  --dsw-specific-sidebar-fill:rgba(0,0,0,var(--dms-sidebar-extra,.05)) !important;
}

/* ── 右下角面板 ── */
.dms-root{position:fixed;right:18px;bottom:72px;z-index:2;display:flex;flex-direction:column;
  align-items:flex-end;gap:10px;pointer-events:none;font-size:12.5px;
  color:var(--dsw-alias-label-primary);line-height:1.45}
.dms-root>*{pointer-events:auto}
.dms-fab{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.22);padding:0}
.dms-fab:hover{border-color:var(--dsw-alias-brand-primary)}
.dms-fab svg{width:18px;height:18px;display:block}
.dms-panel{width:318px;max-height:min(72vh,660px);overflow:auto;box-sizing:border-box;padding:14px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 14px 44px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}
.dms-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dms-head-title{font-size:13px;font-weight:600}
.dms-icon-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;
  border-radius:6px;padding:2px 6px;font-size:14px;line-height:1}
.dms-icon-btn:hover{color:var(--dsw-alias-label-primary)}
.dms-section{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dms-section:first-of-type{padding-top:0;border-top:none}
.dms-section-title{font-size:11.5px;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.dms-row{display:flex;align-items:center;gap:8px}
.dms-row-between{justify-content:space-between}
.dms-label{font-size:12px;color:var(--dsw-alias-label-primary);flex:0 0 auto}
.dms-value{font-size:11.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dms-hint{font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dms-warn{font-size:11.5px;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere}
.dms-err{font-size:11.5px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dms-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dms-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.dms-btn:disabled{opacity:.45;cursor:default}
.dms-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}
.dms-input{flex:1 1 auto;min-width:0;font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dms-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dms-range{-webkit-appearance:none;appearance:none;width:100%;height:16px;background:transparent;cursor:pointer;margin:0}
.dms-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2)}
.dms-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin-top:-4.5px;
  border-radius:50%;border:none;background:var(--dsw-alias-brand-primary)}
.dms-range::-moz-range-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2)}
.dms-range::-moz-range-thumb{width:13px;height:13px;border:none;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.dms-field{display:flex;flex-direction:column;gap:3px}
.dms-file{display:none}
.dms-chips{display:flex;flex-wrap:wrap;gap:4px}
.dms-chip{font:inherit;font-size:11.5px;padding:3px 9px;border-radius:999px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary)}
.dms-chip[data-active="1"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dms-badge{font-size:10.5px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);
  color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.dms-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
`

    // ─────────────────────────── 背景层引擎 ───────────────────────────

    /**
     * 创建/更新/拆除背景层。一个组件实例对应一个引擎，`destroy()` 会把它碰过的东西
     * （节点、`data-dms` 属性、CSS 变量）全部还原 —— 停用插件后界面必须回到原生外观。
     */
    function createEngine() {
      let layer = null
      let holder = null
      let mediaEl = null
      let scrim = null
      let mediaKey = ''
      const root = document.documentElement

      function ensureLayer() {
        if (layer !== null) return
        layer = document.createElement('div')
        layer.id = 'dms-backdrop'
        layer.setAttribute('aria-hidden', 'true')
        holder = document.createElement('div')
        holder.className = 'dms-holder'
        scrim = document.createElement('div')
        scrim.className = 'dms-scrim'
        layer.appendChild(holder)
        layer.appendChild(scrim)
        document.body.insertBefore(layer, document.body.firstChild)
      }

      /** 换素材时才重建 media 元素；滑块只改 CSS 变量，所以拖动不会重新解码视频。 */
      function ensureMedia(media) {
        const key = `${media.kind}|${media.url}`
        if (key === mediaKey && mediaEl !== null) return
        mediaKey = key
        if (mediaEl !== null && mediaEl.parentNode !== null) mediaEl.parentNode.removeChild(mediaEl)
        mediaEl = document.createElement(media.kind === 'video' ? 'video' : 'img')
        mediaEl.className = 'dms-media'
        mediaEl.setAttribute('aria-hidden', 'true')
        if (media.kind === 'video') {
          mediaEl.autoplay = true
          mediaEl.loop = true
          mediaEl.muted = true
          mediaEl.defaultMuted = true
          mediaEl.playsInline = true
          mediaEl.setAttribute('playsinline', '')
          mediaEl.preload = 'auto'
        } else {
          mediaEl.decoding = 'async'
        }
        mediaEl.src = media.url
        holder.appendChild(mediaEl)
      }

      function clear() {
        if (layer !== null && layer.parentNode !== null) layer.parentNode.removeChild(layer)
        if (mediaEl !== null) {
          if (mediaEl.tagName === 'VIDEO') {
            try {
              mediaEl.pause()
            } catch {
              /* 已经停了 */
            }
            mediaEl.removeAttribute('src')
          }
          mediaEl = null
        }
        layer = null
        holder = null
        scrim = null
        mediaKey = ''
        for (const name of CSS_VARS) root.style.removeProperty(name)
        root.removeAttribute('data-dms')
      }

      /** 应用一份快照。设置不可用（关掉了 / 没素材 / 文件没了）时直接拆层。 */
      function apply(payload) {
        const settings = payload && payload.settings ? payload.settings : null
        const media = payload && payload.media ? payload.media : null
        const usable =
          settings !== null &&
          settings.enabled === true &&
          media !== null &&
          media.available === true &&
          media.kind !== 'none' &&
          typeof media.url === 'string'
        if (!usable) {
          clear()
          return
        }
        if (document.body === null) return
        ensureLayer()
        ensureMedia(media)
        root.setAttribute('data-dms', 'on')

        const percent = (value) => (Math.max(0, Math.min(200, value)) / 100).toFixed(3)
        root.style.setProperty('--dms-blur', `${settings.blur}px`)
        // 模糊会把边缘吃掉一圈，所以容器反向放大一点把边缘推到视口外。
        root.style.setProperty('--dms-bleed', `${Math.ceil(settings.blur * 2.2)}px`)
        root.style.setProperty('--dms-opacity', percent(settings.mediaOpacity))
        root.style.setProperty('--dms-brightness', percent(settings.brightness))
        root.style.setProperty('--dms-saturate', percent(settings.saturate))
        root.style.setProperty('--dms-contrast', percent(settings.contrast))
        root.style.setProperty('--dms-scale', percent(settings.scale))
        // 界面不透明度 = 压在素材上的那一层底色（亮主题白、暗主题黑）的 alpha。
        // 只有这一层，所以 0% 就是原始素材，不会被"叠了几层半透明画布"垫灰。
        root.style.setProperty('--dms-scrim', Math.max(0, Math.min(1, settings.surface / 100)).toFixed(3))
        root.style.setProperty('--dms-sidebar-extra', (0.03 + Math.max(0, Math.min(1, (settings.sidebar ?? 50) / 100)) * 0.05).toFixed(3))
        root.style.setProperty('--dms-fit', settings.fit)
        root.style.setProperty('--dms-position', settings.position)

        if (mediaEl !== null && mediaEl.tagName === 'VIDEO') {
          const rate = Number(settings.video && settings.video.rate)
          mediaEl.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1
          if (settings.video && settings.video.paused === true) {
            try {
              mediaEl.pause()
            } catch {
              /* 忽略 */
            }
          } else if (mediaEl.paused) {
            const playing = mediaEl.play()
            if (playing && typeof playing.catch === 'function') playing.catch(() => {})
          }
        }
      }

      return { apply, clear }
    }

    // ─────────────────────────── 小工具 ───────────────────────────

    /** 深合并两层（只对对象字段有特殊处理，其余直接覆盖）。 */
    function mergeSettings(base, patch) {
      const out = { ...(base || {}) }
      for (const [key, value] of Object.entries(patch || {})) {
        const previous = out[key]
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          previous !== null &&
          typeof previous === 'object' &&
          !Array.isArray(previous)
        ) {
          out[key] = { ...previous, ...value }
        } else {
          out[key] = value
        }
      }
      return out
    }

    /** 字节数 → 人类可读。 */
    function formatSize(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return ''
      const units = ['B', 'KB', 'MB', 'GB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
    }

    /** 读 JSON，失败返回 `{ error }` 而不是抛。 */
    async function readJson(url, init) {
      try {
        const response = await fetch(url, init || { cache: 'no-store' })
        const payload = await response.json().catch(() => null)
        if (!response.ok) return { error: (payload && payload.error) || `HTTP ${response.status}` }
        return payload || { error: '空响应' }
      } catch (error) {
        return { error: (error && error.message) || String(error) }
      }
    }

    // ─────────────────────────── 界面 ───────────────────────────

    /**
     * 调节面板。`t` 由 `apply` 闭包带进来（命名空间已注册），所以语言切换时
     * 只要重渲染就能换文案。
     */
    function MediaSkinPanel(props) {
      const t = props.t
      const engineRef = React.useRef(null)
      const pendingRef = React.useRef({})
      const timerRef = React.useRef(null)
      const latestRef = React.useRef(null)
      /** 用户是否已经手动开合过面板：首屏响应晚到时不能把它关回去。 */
      const touchedRef = React.useRef(false)
      const [view, setView] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [pathDraft, setPathDraft] = React.useState('')

      /** 把一份快照同时写进 React 状态、引擎和 ref（事件回调里读最新值用）。 */
      const publish = React.useCallback((payload) => {
        latestRef.current = payload
        if (engineRef.current !== null) engineRef.current.apply(payload)
        setView(payload)
      }, [])

      React.useEffect(() => {
        const engine = createEngine()
        engineRef.current = engine
        return () => {
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = null
          engineRef.current = null
          engine.clear()
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        readJson(STATE_URL).then((payload) => {
          if (!alive) return
          if (payload && payload.error) {
            setError(String(payload.error))
            return
          }
          publish(payload)
          const settings = payload && payload.settings ? payload.settings : null
          if (settings === null) return
          // 面板的展开状态只在首次加载时从宿主恢复一次；之后由用户点击决定，
          // 否则"首屏还没读完就点了圆钮"会被随后到达的响应立刻关回去。
          if (!touchedRef.current && settings.panel) setOpen(settings.panel.open === true)
          const media = settings.media
          if (media && media.source === 'path') setPathDraft(media.path)
        })
        return () => {
          alive = false
        }
      }, [publish])

      /** 把积攒的补丁写回宿主；失败时把错误摊在面板里，绝不静默。 */
      const flush = React.useCallback(() => {
        const patch = pendingRef.current
        pendingRef.current = {}
        if (!patch || Object.keys(patch).length === 0) return
        readJson(STATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }).then((payload) => {
          if (payload && payload.error) {
            setError(String(payload.error))
            return
          }
          setError('')
          const current = latestRef.current
          if (!current) {
            publish(payload)
            return
          }
          // 只采纳宿主算出来的素材信息（url/version），其余以后续拖动为准。
          publish({ settings: current.settings, media: payload.media })
        })
      }, [publish])

      const queue = React.useCallback(
        (patch) => {
          pendingRef.current = mergeSettings(pendingRef.current, patch)
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            flush()
          }, 320)
        },
        [flush],
      )

      /** 本地立即生效 + 防抖落盘。 */
      const patch = React.useCallback(
        (partial) => {
          const current = latestRef.current
          if (!current || !current.settings) return
          const next = { settings: mergeSettings(current.settings, partial), media: current.media }
          latestRef.current = next
          if (engineRef.current !== null) engineRef.current.apply(next)
          setView(next)
          queue(partial)
        },
        [queue],
      )

      const toggleOpen = React.useCallback(
        (next) => {
          touchedRef.current = true
          const current = latestRef.current
          setOpen(next)
          if (!current || !current.settings) return
          const settings = { ...current.settings, panel: { ...(current.settings.panel || {}), open: next } }
          latestRef.current = { settings, media: current.media }
          queue({ panel: { open: next } })
        },
        [queue],
      )

      const upload = React.useCallback(
        (file) => {
          if (!file) return
          setError('')
          setBusy(true)
          fetch(UPLOAD_URL, {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-dms-name': encodeURIComponent(file.name || 'media'),
            },
            body: file,
          })
            .then(async (response) => {
              const payload = await response.json().catch(() => null)
              if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
              pendingRef.current = {}
              publish(payload)
            })
            .catch((error) => setError((error && error.message) || String(error)))
            .finally(() => setBusy(false))
        },
        [publish],
      )

      const usePath = React.useCallback(() => {
        const value = pathDraft.trim()
        if (value === '') return
        setError('')
        const done = readJson(STATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ media: { source: 'path', path: value, name: '' } }),
        })
        done.then((payload) => {
          if (payload && payload.error) {
            setError(String(payload.error))
            return
          }
          pendingRef.current = {}
          publish(payload)
        })
      }, [pathDraft, publish, t])

      const clearMedia = React.useCallback(() => {
        setError('')
        readJson(STATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ media: { source: 'none', path: '', name: '' } }),
        }).then((payload) => {
          if (payload && payload.error) {
            setError(String(payload.error))
            return
          }
          pendingRef.current = {}
          publish(payload)
        })
      }, [publish])

      const resetAll = React.useCallback(() => {
        setError('')
        readJson(STATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
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
          }),
        }).then((payload) => {
          if (payload && payload.error) {
            setError(String(payload.error))
            return
          }
          pendingRef.current = {}
          publish(payload)
        })
      }, [publish])

      const settings = view && view.settings ? view.settings : null
      const media = view && view.media ? view.media : null
      const value = (key) => (settings ? settings[key] : 0)

      const sliderRow = (item) =>
        h(
          'div',
          { className: 'dms-field', key: item.key },
          h(
            'div',
            { className: 'dms-row dms-row-between' },
            h('span', { className: 'dms-label' }, t(item.label)),
            h('span', { className: 'dms-value' }, `${value(item.key)}${item.unit === 'px' ? t('px') : t('percent')}`),
          ),
          h('input', {
            className: 'dms-range',
            type: 'range',
            min: item.min,
            max: item.max,
            step: item.step,
            value: value(item.key),
            disabled: settings === null,
            'aria-label': t(item.label),
            onChange: (event) => {
              const number = Number(event.target.value)
              patch({ [item.key]: number })
            },
          }),
        )

      const chipRow = (options, current, onPick) =>
        h(
          'div',
          { className: 'dms-chips' },
          options.map((option) =>
            h(
              'button',
              {
                key: option.value,
                type: 'button',
                className: 'dms-chip',
                'data-active': current === option.value ? '1' : '0',
                onClick: () => onPick(option.value),
              },
              t(option.label),
            ),
          ),
        )

      const mediaName =
        media && media.available && media.name ? media.name : settings && settings.media && settings.media.name ? settings.media.name : ''
      // 路径素材读不到时 name 可能是空的，退回显示路径的文件名 —— 让人知道是哪一条配置坏了。
      const configuredPath = settings && settings.media && typeof settings.media.path === 'string' ? settings.media.path : ''
      const displayName = mediaName !== '' ? mediaName : configuredPath.split(/[\\/]/).pop() || ''
      const mediaBadge = media && media.kind === 'video' ? t('video') : media && media.kind === 'image' ? t('image') : ''

      return h(
        'div',
        { className: 'dms-root' },
        h('style', null, CSS),
        open
          ? h(
              'div',
              { className: 'dms-panel', role: 'dialog', 'aria-label': t('title') },
              h(
                'div',
                { className: 'dms-head' },
                h('span', { className: 'dms-head-title' }, t('title')),
                h(
                  'button',
                  { type: 'button', className: 'dms-icon-btn', title: t('close'), onClick: () => toggleOpen(false) },
                  '✕',
                ),
              ),
              settings === null
                ? h('div', { className: 'dms-hint' }, t('loading'))
                : h(
                    'label',
                    { className: 'dms-row' },
                    h('input', {
                      type: 'checkbox',
                      checked: settings.enabled === true,
                      onChange: (event) => patch({ enabled: event.target.checked }),
                    }),
                    h('span', { className: 'dms-label' }, t('enable')),
                  ),

              // ── 素材 ──
              h(
                'div',
                { className: 'dms-section' },
                h('div', { className: 'dms-section-title' }, t('mediaSection')),
                h(
                  'div',
                  { className: 'dms-row' },
                  h('span', { className: 'dms-name' }, displayName === '' ? t('none') : displayName),
                  mediaBadge === '' ? null : h('span', { className: 'dms-badge' }, mediaBadge),
                  media && media.size > 0 ? h('span', { className: 'dms-value' }, formatSize(media.size)) : null,
                ),
                media && media.available === false && settings && settings.media && settings.media.source !== 'none'
                  ? h('div', { className: 'dms-warn' }, t('unavailable'))
                  : null,
                h(
                  'div',
                  { className: 'dms-row' },
                  h(
                    'label',
                    { className: 'dms-btn' },
                    busy ? t('uploading') : t('pick'),
                    h('input', {
                      className: 'dms-file',
                      type: 'file',
                      accept: 'image/*,video/*',
                      disabled: busy,
                      onChange: (event) => {
                        const file = event.target.files && event.target.files[0]
                        event.target.value = ''
                        upload(file)
                      },
                    }),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dms-btn', onClick: clearMedia, disabled: busy },
                    t('clear'),
                  ),
                ),
                h('div', { className: 'dms-hint' }, t('pickHint')),
                h(
                  'div',
                  { className: 'dms-row' },
                  h('input', {
                    className: 'dms-input',
                    type: 'text',
                    value: pathDraft,
                    placeholder: t('pathPlaceholder'),
                    'aria-label': t('pathPlaceholder'),
                    onChange: (event) => setPathDraft(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') usePath()
                    },
                  }),
                  h('button', { type: 'button', className: 'dms-btn', onClick: usePath, disabled: busy }, t('apply')),
                ),
              ),

              // ── 画面 ──
              settings === null
                ? null
                : h('div', { className: 'dms-section' }, h('div', { className: 'dms-section-title' }, t('tuningSection')), SLIDERS.map(sliderRow)),

              // ── 排布 ──
              settings === null
                ? null
                : h(
                    'div',
                    { className: 'dms-section' },
                    h('div', { className: 'dms-section-title' }, t('layoutSection')),
                    h('div', { className: 'dms-label' }, t('fit')),
                    chipRow(FITS, settings.fit, (next) => patch({ fit: next })),
                    h('div', { className: 'dms-label' }, t('position')),
                    chipRow(POSITIONS, settings.position, (next) => patch({ position: next })),
                  ),

              // ── 视频 ──
              media && media.kind === 'video' && settings !== null
                ? h(
                    'div',
                    { className: 'dms-section' },
                    h('div', { className: 'dms-section-title' }, t('videoSection')),
                    h(
                      'div',
                      { className: 'dms-row' },
                      h('span', { className: 'dms-label' }, t('rate')),
                      h(
                        'select',
                        {
                          className: 'dms-input',
                          value: String(settings.video ? settings.video.rate : 1),
                          onChange: (event) => patch({ video: { rate: Number(event.target.value) } }),
                          'aria-label': t('rate'),
                        },
                        RATES.map((rate) => h('option', { key: rate, value: String(rate) }, `${rate}×`)),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dms-btn',
                          onClick: () => patch({ video: { paused: !(settings.video && settings.video.paused) } }),
                        },
                        settings.video && settings.video.paused ? t('play') : t('pause'),
                      ),
                    ),
                  )
                : null,

              error === '' ? null : h('div', { className: 'dms-err' }, error),

              h(
                'div',
                { className: 'dms-row dms-row-between' },
                h('button', { type: 'button', className: 'dms-btn', onClick: resetAll }, t('reset')),
                h('span', { className: 'dms-hint' }, t('hint')),
              ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dms-fab',
            title: open ? t('close') : t('open'),
            'aria-label': open ? t('close') : t('open'),
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => toggleOpen(!open),
          },
          // 一枚"相框 + 播放三角"的图形：既不像纯图片，也不像纯视频。
          h(
            'svg',
            { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true' },
            h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2.5 }),
            h('circle', { cx: 8.5, cy: 10, r: 1.4, fill: 'currentColor', stroke: 'none' }),
            h('path', { d: 'M4 17l4.5-4.5L12 16l3-3 5 5', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          ),
        ),
      )
    }

    // ─────────────────────────── 注册 ───────────────────────────

    /**
     * 注册到 `shell.overlay`：整窗浮层，正好放这个"右下角小圆钮 + 展开面板"。
     * @param {object} ctx 客户端插件上下文。
     */
    function apply(ctx) {
      const locale = ctx.get('locale')
      let t = (key) => ZH[key] || key
      if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        try {
          ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'media-skin: dictionaries')
          t = locale.bind(NS)
        } catch {
          /* 语言服务不配合就退回中文，界面不能因为文案注册失败而空掉 */
        }
      }
      const Panel = (slotProps) => {
        // 语言切换时重渲染一次：`bind` 的 t 在调用时才读当前语言。
        const [, force] = React.useReducer((n) => n + 1, 0)
        React.useEffect(() => {
          if (locale === undefined || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => force())
        }, [])
        return h(MediaSkinPanel, { ...(slotProps || {}), t })
      }
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'media-skin-controls', order: 40, label: () => t('title') },
          Panel,
        ),
      )
    }

    return {
      name: NS,
      inject: ['slots'],
      apply,
    }
  },
})
