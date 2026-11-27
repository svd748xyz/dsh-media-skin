/**
 * dsh-media-skin —— 客户端那一半（背景层引擎 + 交互式裁切 + 右下角调节面板）。
 *
 * 为什么背景层要自己动 DOM：它必须画在 `#root`（整个应用）**后面**。插槽里的组件
 * 都在应用渲染树内部，`shell.overlay` 更是"在所有列之上"的一层 —— 放进去只能挡住内容，
 * 挡不到内容的后面。所以这里走"组件 + effect 拥有一个 body 级节点"的路子：
 * 节点由 React 生命周期创建，卸载时也就是插件被停用/热替换时由 cleanup 摘掉，
 * 不会在 DOM 里留下孤儿（这是和"直接 appendChild 完不管"的关键区别）。
 *
 * ── v2：分区背景 + 手动裁切 ──
 * 背景层从"一个 img 铺满"变成"最多三个图层"：
 *   full     整窗模式下的唯一背景
 *   main     分栏模式下的内容区
 *   sidebar  分栏模式下的左侧栏
 * 每个图层有自己的素材和自己的裁切参数 `{x, y, zoom}`，由面板里的裁切器手动拖出来。
 * 裁切器与真实背景层用**同一套渲染公式**（object-fit:cover + object-position + scale），
 * 所以预览框里看到的构图就是最终效果，不存在"预览和落地不一致"。
 *
 * 设置的真值在宿主：`/dsh-media-skin/api/state`。界面只做三件事 —— 读一份快照、
 * 把改动防抖写回去、把快照翻译成 CSS 变量。
 */
window.__ModuleLoader__.load({
  id: 'dsh-media-skin',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const STATE_URL = '/dsh-media-skin/api/state'
    const UPLOAD_URL = '/dsh-media-skin/api/upload'
    /**
     * 头像位图：宿主 `/dsh-media-skin/avatar` 下发。
     * `window.__DMS_AVATAR__` 是验收页的钩子（file:// 下没有宿主路由）。
     */
    const AVATAR_URL =
      typeof window !== 'undefined' && typeof window.__DMS_AVATAR__ === 'string' && window.__DMS_AVATAR__ !== ''
        ? window.__DMS_AVATAR__
        : '/dsh-media-skin/avatar'
    const NS = 'media-skin'

    /** 落到 root 上的 CSS 变量：卸载时要一个一个摘掉，所以集中登记。 */
    const CSS_VARS = [
      '--dms-blur',
      '--dms-bleed',
      '--dms-opacity',
      '--dms-brightness',
      '--dms-saturate',
      '--dms-contrast',
      '--dms-scrim',
      '--dms-sidebar-extra',
      '--dms-sidebar-w',
    ]

    /** 三个图层。 */
    const LAYERS = ['full', 'main', 'sidebar']

    // ─────────────────────────── 文案 ───────────────────────────

    const ZH = {
      title: '本地媒体皮肤',
      open: '打开媒体皮肤设置',
      close: '收起',
      enable: '启用皮肤',
      modeSection: '背景布局',
      mediaSection: '素材',
      tuningSection: '画面',
      videoSection: '视频',
      modeFull: '整窗一张',
      modeSplit: '分栏两张',
      layerFull: '整窗背景',
      layerMain: '内容区',
      layerSidebar: '左侧栏',
      syncLook: '复制调色到',
      syncTip: '把这层的模糊、不透明度、亮度、饱和度、对比度整组复制到另一层（不动素材和裁切）',
      synced: '已同步',
      current: '当前',
      none: '还没选素材',
      empty: '未设置',
      unavailable: '文件读不到了（可能被移动或删除）',
      pick: '选择文件…',
      pickHint: '图片或视频，最大 512 MB；副本存进 DSH 目录',
      clear: '清除',
      crop: '裁切',
      cropTitle: '拖动图片选位置，滚轮缩放',
      cropApply: '应用',
      cropCancel: '取消',
      cropReset: '复位',
      cropHint: '拖动 = 平移，滚轮 = 缩放；框内就是最终效果',
      cropAspect: '目标区域',
      zoomOut: '缩小',
      zoomIn: '放大',
      reset: '恢复默认',
      hint: '自动保存',
      blur: '模糊',
      mediaOpacity: '画面不透明度',
      brightness: '亮度',
      saturate: '饱和度',
      contrast: '对比度',
      surface: '界面不透明度',
      sidebarExtra: '侧栏压色',
      rate: '播放速度',
      pause: '暂停',
      play: '播放',
      loading: '读取中…',
      uploading: '正在复制…',
      px: 'px',
      percent: '%',
      image: '图片',
      video: '视频',
    }

    const EN = {
      title: 'Media skin',
      open: 'Open media skin settings',
      close: 'Collapse',
      enable: 'Enable skin',
      modeSection: 'Background layout',
      mediaSection: 'Media',
      tuningSection: 'Look',
      videoSection: 'Video',
      modeFull: 'One image',
      modeSplit: 'Two layers',
      layerFull: 'Whole window',
      layerMain: 'Content',
      layerSidebar: 'Sidebar',
      syncLook: 'Copy look to',
      syncTip: 'Copy this layer blur, opacity, brightness, saturation and contrast to the other layer (media and crop stay)',
      synced: 'Copied',
      current: 'Current',
      none: 'No media yet',
      empty: 'Not set',
      unavailable: 'File is no longer readable (moved or deleted)',
      pick: 'Choose file…',
      pickHint: 'Image or video, up to 512 MB; a copy goes into the DSH folder',
      clear: 'Clear',
      crop: 'Crop',
      cropTitle: 'Drag to choose the area, scroll to zoom',
      cropApply: 'Apply',
      cropCancel: 'Cancel',
      cropReset: 'Reset',
      cropHint: 'Drag to pan, scroll to zoom; the frame is the final result',
      cropAspect: 'Target area',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      reset: 'Reset to defaults',
      hint: 'Saved automatically',
      blur: 'Blur',
      mediaOpacity: 'Media opacity',
      brightness: 'Brightness',
      saturate: 'Saturation',
      contrast: 'Contrast',
      surface: 'UI opacity',
      sidebarExtra: 'Sidebar tone',
      rate: 'Playback speed',
      pause: 'Pause',
      play: 'Play',
      loading: 'Loading…',
      uploading: 'Copying…',
      px: 'px',
      percent: '%',
      image: 'Image',
      video: 'Video',
    }

    /** 每个图层自己的画面项（键名与宿主 lib/defaults.js 的 LOOK_KEYS / RANGES 一致）。 */
    const SLIDERS = [
      { key: 'blur', label: 'blur', min: 0, max: 60, step: 1, unit: 'px' },
      { key: 'mediaOpacity', label: 'mediaOpacity', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'brightness', label: 'brightness', min: 40, max: 160, step: 1, unit: '%' },
      { key: 'saturate', label: 'saturate', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'contrast', label: 'contrast', min: 50, max: 150, step: 1, unit: '%' },
    ]

    const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

    /** 画面参数的默认值（与宿主 lib/defaults.js 的 DEFAULT_LOOK 一致）。 */
    const DEFAULT_LOOK = { blur: 0, mediaOpacity: 100, brightness: 100, saturate: 100, contrast: 100 }

    /** 裁切缩放区间（与宿主 CROP_RANGES 一致）。 */
    const ZOOM_MIN = 1
    const ZOOM_MAX = 4

    /** 探测不到侧栏宽度时的兜底（DSH 侧栏的常见宽度）。 */
    const DEFAULT_SIDEBAR_WIDTH = 264

    // ─────────────────────────── 样式 ───────────────────────────

    /**
     * 全部样式。前缀统一 `dms-`，颜色只用 DSH 的 `--dsw-alias-*` 主题 token，
     * 这样亮/暗主题、改主题色都自动跟随。**唯一要手动照顾的**：深色主题里
     * `brand-primary` 会变成近白，所以"主色底 + 白字/白点"的写法要换成 bg-layer-1
     * 当"主色上的前景色"（见文件下方"深色壳补偿"）。
     */
    const CSS = `
/* ── 背景层：z-index:-1 落在所有在流内容之下，pointer-events:none 不挡交互 ── */
#dms-backdrop{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;background:#eef1f5}
html[data-dms="on"]:has(body[data-ds-dark-theme]) #dms-backdrop{background:#0e1116}

/* 每个图层自己一块区域：整窗 / 内容区（从侧栏右缘开始）/ 左侧栏 */
#dms-backdrop .dms-layer{position:absolute;inset:0;overflow:hidden}
#dms-backdrop .dms-layer[data-layer="main"]{left:var(--dms-sidebar-w,264px)}
#dms-backdrop .dms-layer[data-layer="sidebar"]{right:auto;width:var(--dms-sidebar-w,264px)}
#dms-backdrop .dms-layer[data-hidden="1"]{display:none}
#dms-backdrop .dms-holder{position:absolute;inset:calc(-1 * var(--dms-bleed,0px))}
#dms-backdrop .dms-media{position:absolute;inset:0;width:100%;height:100%;display:block;
  object-fit:cover;object-position:var(--dms-px,50%) var(--dms-py,50%);
  transform:scale(var(--dms-zoom,1));transform-origin:center center;
  opacity:var(--dms-opacity,1);
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

/* ── 深色壳补偿 ──
   深色主题把 brand-primary 换成了**近白**（#f9fafb），凡是"主色当底 + 白字/白点"的组合
   都会变成白对白。上面已经让开关圆点、滑块拇指、主按钮文字改用 bg-layer-1（亮色下等价于
   白，深色下是 #232324），这里补三处只有深色才需要翻转的观感。 */
html[data-dms="on"]:has(body[data-ds-dark-theme]) .dms-chip[data-active="1"]{
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#f9fafb) 13%,transparent);
  box-shadow:0 1px 4px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08)}
html[data-dms="on"]:has(body[data-ds-dark-theme]) .dms-card[data-active="1"]{
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#f9fafb) 34%,transparent)}
html[data-dms="on"]:has(body[data-ds-dark-theme]) .dms-thumb{box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}

/* ══════════════════════ 浮层外壳 ══════════════════════ */
.dms-root{position:fixed;right:18px;bottom:72px;z-index:2;display:flex;flex-direction:column;
  align-items:flex-end;gap:12px;pointer-events:none;font-size:12.5px;line-height:1.45;
  color:var(--dsw-alias-label-primary,#1b2434);font-family:var(--dsw-font-family,inherit)}
/* 面板展开时圆钮已收起，就把面板往下放到 20px —— 多赚 52px 高度，又不会压住窗口底边控件。 */
.dms-root[data-open="1"]{bottom:20px}
.dms-root>*{pointer-events:auto}

/* ── 头像圆钮：平时它就是一枚"蓝鲸厨娘"的圆形头像 ── */
.dms-fab{position:relative;width:42px;height:42px;padding:0;border:none;border-radius:50%;
  display:block;overflow:hidden;cursor:pointer;background:#e9f2ff;
  box-shadow:0 0 0 1px rgba(16,26,48,.14),0 10px 24px -8px rgba(8,12,22,.55);
  transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s ease}
.dms-fab .dms-fab-img{width:100%;height:100%;display:block;object-fit:cover}
.dms-fab:hover{transform:translateY(-2px) scale(1.05);
  box-shadow:0 0 0 1.5px var(--dsw-alias-brand-primary,#4d6bfe),0 16px 32px -10px rgba(8,12,22,.6)}
.dms-fab:active{transform:translateY(0) scale(.97)}
.dms-fab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}

/* ── 面板：磨砂玻璃 + 双层阴影 + 顶部内高光 ── */
.dms-panel{position:relative;width:348px;min-width:0;box-sizing:border-box;padding:12px 12px 10px;
  display:flex;flex-direction:column;gap:9px;
  max-height:min(calc(100vh - 38px),800px);overflow:auto;overscroll-behavior:contain;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#0f1a32) 60%,transparent);
  border-radius:18px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#ffffff) 84%,transparent);
  -webkit-backdrop-filter:blur(26px) saturate(1.6);backdrop-filter:blur(26px) saturate(1.6);
  box-shadow:0 26px 64px -22px rgba(7,11,20,.62),0 6px 16px -8px rgba(7,11,20,.3),
    inset 0 1px 0 rgba(255,255,255,.42);
  animation:dms-rise .24s cubic-bezier(.2,.8,.2,1)}
.dms-panel::-webkit-scrollbar{width:9px}
.dms-panel::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,rgba(15,26,50,.18));
  border-radius:99px;border:3px solid transparent;background-clip:padding-box}
.dms-panel::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2,rgba(15,26,50,.34));
  background-clip:padding-box}
@keyframes dms-rise{from{opacity:0;transform:translateY(10px) scale(.982)}to{opacity:1;transform:none}}

/* ── 标题栏 ── */
.dms-head{display:flex;align-items:center;gap:9px;min-width:0}
.dms-avatar{width:30px;height:30px;flex:0 0 auto;border-radius:50%;display:block;object-fit:cover;
  background:#dfeafc;box-shadow:0 0 0 1px rgba(16,26,48,.14),0 4px 10px -4px rgba(8,12,22,.4)}
.dms-head-text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.dms-head-title{font-size:13px;font-weight:650;letter-spacing:.01em;white-space:nowrap}
.dms-head-sub{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8892a6);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}

/* 开关：一条胶囊 + 会走动的圆点，比复选框干净 */
.dms-switch{position:relative;flex:0 0 auto;width:34px;height:19px;border-radius:99px;cursor:pointer;
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 20%,transparent);
  transition:background .2s ease}
.dms-switch input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
.dms-switch::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;
  background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 3px rgba(0,0,0,.35);
  transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.dms-switch[data-on="1"]{background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-switch[data-on="1"]::after{transform:translateX(15px)}
.dms-switch:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent)}
.dms-icon-btn{flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
  padding:0;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:12px;line-height:1;
  color:var(--dsw-alias-label-tertiary,#8892a6);transition:background .16s ease,color .16s ease}
.dms-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(15,26,50,.07));
  color:var(--dsw-alias-label-primary,#1b2434)}
.dms-icon-btn svg{width:12px;height:12px;display:block}

/* ── 分区：小号字距标题 + 一枚主色光点 ── */
.dms-section{display:flex;flex-direction:column;gap:6px;padding-top:8px;
  border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#0f1a32) 46%,transparent)}
.dms-section:first-of-type{padding-top:0;border-top:none}
.dms-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:19px}
.dms-section-title{display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;
  letter-spacing:.08em;color:var(--dsw-alias-label-secondary,#5c6577);text-transform:uppercase;white-space:nowrap}
.dms-section-title::before{content:'';width:2px;height:9px;border-radius:2px;
  background:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.7}

/* ── 分段控件（模式 / 调节对象共用）── */
.dms-chips{display:flex;gap:2px;padding:2px;border-radius:9px;
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 7%,transparent)}
.dms-chips[data-fill="1"]{display:flex;width:100%;box-sizing:border-box}
.dms-chips[data-fill="1"]>.dms-chip{flex:1 1 0}
.dms-chip{font:inherit;font-size:11.5px;padding:3px 10px;border:none;border-radius:7px;text-align:center;
  background:transparent;cursor:pointer;white-space:nowrap;
  color:var(--dsw-alias-label-secondary,#5c6577);
  transition:background .18s ease,color .18s ease,box-shadow .18s ease}
.dms-chip:hover{color:var(--dsw-alias-label-primary,#1b2434)}
.dms-chip[data-active="1"]{background:var(--dsw-alias-bg-layer-1,#fff);
  color:var(--dsw-alias-label-primary,#1b2434);font-weight:650;
  box-shadow:0 1px 4px rgba(8,12,22,.16),0 0 0 1px color-mix(in srgb,var(--dsw-alias-border-l1,#0f1a32) 40%,transparent)}

/* ── 素材卡 ── */
.dms-cards{display:flex;flex-direction:column;gap:7px}
.dms-card{position:relative;display:flex;gap:9px;align-items:center;padding:8px;border-radius:12px;cursor:pointer;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d0d5dd) 78%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f2f4f8) 58%,transparent);
  transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}
.dms-card:hover{transform:translateY(-1px);
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent)}
.dms-card[data-active="1"]{
  border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 75%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 9%,transparent);
  box-shadow:0 8px 20px -14px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 95%,transparent)}
.dms-card[data-active="1"]::before{content:'';position:absolute;left:0;top:12px;bottom:12px;width:2.5px;
  border-radius:99px;background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-thumb{position:relative;width:80px;aspect-ratio:3 / 2;flex:0 0 auto;padding:0;border:none;
  border-radius:10px;overflow:hidden;cursor:pointer;
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 10%,transparent);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.24)}
.dms-thumb:disabled{cursor:default}
.dms-thumb-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;
  transform-origin:center center}
.dms-thumb-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:15px;color:var(--dsw-alias-label-tertiary,#8892a6)}
.dms-thumb-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:10px;color:#fff;background:rgba(8,12,22,.52);opacity:0;transition:opacity .16s ease}
.dms-thumb:hover .dms-thumb-hint{opacity:1}
.dms-card-body{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
.dms-card-head{display:flex;align-items:center;gap:6px;min-width:0}
.dms-card-title{font-size:12px;font-weight:650;white-space:nowrap;flex:0 0 auto}
.dms-badge{font-size:10px;padding:0 5px;border-radius:5px;flex:0 0 auto;font-weight:600;letter-spacing:.02em;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d3d8e2) 90%,transparent);
  color:var(--dsw-alias-label-secondary,#5c6577)}
.dms-name{font-size:11px;color:var(--dsw-alias-label-tertiary,#8892a6);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dms-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}

/* ── 滑块：轨道左半用主色填满，拖动时看得见"用了多少" ── */
.dms-fields{display:flex;flex-direction:column;gap:4px}
.dms-field{display:flex;flex-direction:column;gap:2px}
.dms-row{display:flex;align-items:center;gap:8px;min-width:0}
.dms-row-between{justify-content:space-between}
.dms-label{font-size:12px;color:var(--dsw-alias-label-primary,#1b2434)}
.dms-value{font-size:10.5px;font-variant-numeric:tabular-nums;text-align:right;min-width:36px;
  padding:1px 6px;border-radius:6px;
  color:var(--dsw-alias-label-secondary,#5c6577);
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 7%,transparent)}
.dms-range{-webkit-appearance:none;appearance:none;width:100%;height:13px;margin:0;padding:0;
  background:transparent;cursor:pointer;border-radius:99px}
.dms-range::-webkit-slider-runnable-track{height:5px;border-radius:99px;
  background:linear-gradient(90deg,var(--dsw-alias-brand-primary,#4d6bfe) var(--dms-fill,50%),
    color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 14%,transparent) var(--dms-fill,50%))}
.dms-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-4.5px;
  border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);border:2px solid var(--dsw-alias-brand-primary,#4d6bfe);
  box-shadow:0 1px 4px rgba(8,12,22,.3);transition:transform .12s ease,box-shadow .12s ease}
.dms-range:hover::-webkit-slider-thumb{transform:scale(1.12)}
.dms-range:focus-visible::-webkit-slider-thumb{
  box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 26%,transparent)}
.dms-range::-moz-range-track{height:5px;border-radius:99px;
  background:color-mix(in srgb,var(--dsw-alias-label-primary,#1b2434) 14%,transparent)}
.dms-range::-moz-range-progress{height:5px;border-radius:99px;background:var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-bg-layer-1,#fff);
  border:2px solid var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-range:disabled{opacity:.45;cursor:default}
.dms-divider{height:1px;margin:0;
  background:color-mix(in srgb,var(--dsw-alias-border-l1,#0f1a32) 46%,transparent)}

/* ── 复制调色：虚线胶囊，点完短暂变成实心"已同步" ── */
.dms-sync{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;box-sizing:border-box;
  padding:5px 9px;border-radius:9px;cursor:pointer;font:inherit;font-size:11.5px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 48%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 6%,transparent);
  color:var(--dsw-alias-label-secondary,#5c6577);
  transition:color .16s ease,background .16s ease,border-color .16s ease}
.dms-sync svg{width:12px;height:12px;flex:0 0 auto}
.dms-sync:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);
  border-color:var(--dsw-alias-brand-primary,#4d6bfe);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 12%,transparent)}
.dms-sync[data-done="1"]{border-style:solid;color:var(--dsw-alias-bg-layer-1,#fff);border-color:transparent;
  background:var(--dsw-alias-brand-primary,#4d6bfe)}

/* ── 按钮 / 输入 ── */
.dms-btn{font:inherit;font-size:11.5px;padding:4px 10px;border-radius:8px;cursor:pointer;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d3d8e2) 92%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 72%,transparent);
  color:var(--dsw-alias-label-primary,#1b2434);
  transition:border-color .16s ease,color .16s ease,background .16s ease}
.dms-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#4d6bfe);
  color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-btn:disabled{opacity:.45;cursor:default}
.dms-btn-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;
  color:var(--dsw-alias-bg-layer-1,#fff)}
.dms-btn-primary:hover:not(:disabled){color:var(--dsw-alias-bg-layer-1,#fff);filter:brightness(1.08)}
.dms-input{flex:1 1 auto;min-width:0;font:inherit;font-size:12px;padding:4px 8px;border-radius:8px;
  border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2,#d3d8e2) 92%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#fff) 72%,transparent);
  color:var(--dsw-alias-label-primary,#1b2434)}
.dms-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dms-file{display:none}
.dms-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8892a6);overflow-wrap:anywhere}
.dms-err{font-size:11.5px;color:var(--dsw-alias-state-error-primary,#d33);overflow-wrap:anywhere}
.dms-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;
  border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#0f1a32) 46%,transparent)}

/* ══════════════════════ 裁切器 ══════════════════════ */
.dms-crop-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
  padding:22px;background:rgba(6,9,15,.62);
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);animation:dms-fade .18s ease}
@keyframes dms-fade{from{opacity:0}to{opacity:1}}
.dms-crop-card{display:flex;flex-direction:column;align-items:center;gap:12px;padding:15px;
  border-radius:18px;background:rgba(17,21,29,.94);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:0 34px 84px -26px rgba(0,0,0,.9)}
.dms-crop-head{display:flex;align-items:baseline;gap:9px;color:#f2f5f9;font-size:13px}
.dms-crop-head strong{font-weight:650;letter-spacing:.01em}
.dms-crop-note{color:rgba(238,243,250,.6);font-size:11px;font-variant-numeric:tabular-nums}
.dms-crop-box{position:relative;overflow:hidden;border-radius:12px;background:#0d1017;cursor:grab;
  touch-action:none;user-select:none;max-width:82vw;max-height:64vh;
  box-shadow:0 22px 60px -18px rgba(0,0,0,.85),inset 0 0 0 1px rgba(255,255,255,.1)}
.dms-crop-box:active{cursor:grabbing}
.dms-crop-box .dms-crop-media{position:absolute;inset:0;width:100%;height:100%;display:block;
  object-fit:cover;pointer-events:none}
/* 三分线用四条 1px 线画，不会被拉伸变形 */
.dms-crop-grid{position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(to right,rgba(255,255,255,.2) 1px,transparent 1px),
                   linear-gradient(to bottom,rgba(255,255,255,.2) 1px,transparent 1px);
  background-size:33.333% 33.333%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.42)}
.dms-crop-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}
.dms-zoom{display:flex;align-items:center;gap:5px;padding:2px;border-radius:9px;
  background:rgba(255,255,255,.07)}
.dms-crop-foot .dms-btn{color:#e9eef7;border-color:rgba(255,255,255,.2);background:rgba(255,255,255,.06)}
.dms-crop-foot .dms-btn:hover:not(:disabled){border-color:rgba(255,255,255,.75);color:#fff;
  background:rgba(255,255,255,.13)}
/* 深色卡片里主按钮不能用主题主色：有的主题（比如浅色主题）主色本身就接近黑，
   压在黑底上会"消失"。这里固定成白底深字，任何主题都读得出来。 */
.dms-crop-foot .dms-btn-primary{background:#ffffff;border-color:transparent;color:#141821;font-weight:600}
.dms-crop-foot .dms-btn-primary:hover:not(:disabled){background:#f1f4f9;color:#141821}

@media (prefers-reduced-motion:reduce){
  .dms-panel,.dms-crop-overlay{animation:none}
  .dms-fab,.dms-card,.dms-chip,.dms-btn,.dms-sync,.dms-thumb-hint,.dms-switch::after,.dms-panel{transition:none}
}
`

    // ─────────────────────────── 侧栏宽度探测 ───────────────────────────

    /** 侧栏宽度缓存：面板拖动滑块时每帧都会 render，不能每次都遍历 DOM。 */
    let sidebarWidthCache = 0

    /**
     * 量出 DSH 左侧栏的宽度。
     *
     * 三个来源，按可靠性排：
     *   1. DSH 自己算好的 `--dsh-windows-sidebar-width`（它本来就被用来做侧栏避让）；
     *   2. 内容区容器（CSS Modules 的 `*_centerCol`）的左边缘 —— 它紧贴侧栏右边，
     *      量它的 left 比猜侧栏类名靠谱，侧栏折叠时也会自动跟着变；
     *   3. 最后按"贴着左边缘、接近视口高、窄条"的特征兜底探测，再不行退回固定宽度。
     *
     * @param {boolean} force 为 true 时跳过缓存重测（窗口尺寸变化后必须重测）。
     */
    function measureSidebarWidth(force) {
      if (!force && sidebarWidthCache > 0) return sidebarWidthCache
      let width = 0
      try {
        const fromRoot = getComputedStyle(document.documentElement).getPropertyValue('--dsh-windows-sidebar-width')
        const direct = Number.parseFloat(fromRoot)
        if (Number.isFinite(direct) && direct >= 80) width = Math.round(direct)
      } catch {
        /* 读不到就继续探测 */
      }
      if (width === 0) {
        try {
          const center = document.querySelector('[class*="centerCol"], [class*="mainPanel"]')
          if (center !== null) {
            const left = center.getBoundingClientRect().left
            if (Number.isFinite(left) && left >= 80 && left <= 520) width = Math.round(left)
          }
        } catch {
          /* 探测失败继续 */
        }
      }
      if (width === 0) {
        const viewportHeight = window.innerHeight || 0
        try {
          const nodes = document.querySelectorAll('body [class*="sidebar" i], body [class*="leftcol" i], body aside, body nav')
          let best = 0
          for (let index = 0; index < nodes.length && index < 80; index += 1) {
            const element = nodes[index]
            const rect = element.getBoundingClientRect()
            if (rect.left > 2 || rect.width < 150 || rect.width > 460 || rect.height < viewportHeight * 0.6) continue
            best = Math.max(best, rect.width)
          }
          if (best > 0) width = Math.round(best)
        } catch {
          /* 探测失败用兜底 */
        }
      }
      if (width === 0) width = DEFAULT_SIDEBAR_WIDTH
      sidebarWidthCache = width
      return width
    }

    // ─────────────────────────── 背景层引擎 ───────────────────────────

    /**
     * 创建/更新/拆除背景层。一个组件实例对应一个引擎，`destroy()` 会把它碰过的东西
     * （节点、`data-dms` 属性、CSS 变量）全部还原 —— 停用插件后界面必须回到原生外观。
     */
    function createEngine() {
      const root = document.documentElement
      let layer = null
      let scrim = null
      const nodes = { full: null, main: null, sidebar: null }
      const keyOf = { full: '', main: '', sidebar: '' }

      function syncSidebarWidth() {
        root.style.setProperty('--dms-sidebar-w', `${measureSidebarWidth(true)}px`)
      }

      function ensureLayer() {
        if (layer !== null) return
        layer = document.createElement('div')
        layer.id = 'dms-backdrop'
        layer.setAttribute('aria-hidden', 'true')
        for (const key of LAYERS) {
          const el = document.createElement('div')
          el.className = 'dms-layer'
          el.dataset.layer = key
          el.dataset.hidden = '1'
          const holder = document.createElement('div')
          holder.className = 'dms-holder'
          el.appendChild(holder)
          layer.appendChild(el)
          nodes[key] = { layer: el, holder, media: null }
        }
        scrim = document.createElement('div')
        scrim.className = 'dms-scrim'
        layer.appendChild(scrim)
        document.body.insertBefore(layer, document.body.firstChild)
        window.addEventListener('resize', syncSidebarWidth)
      }

      /** 换素材时才重建 media 元素；滑块只改 CSS 变量，所以拖动不会重新解码视频。 */
      function ensureMedia(key, info) {
        const slot = nodes[key]
        if (slot === null) return
        const nextKey = `${info.kind}|${info.url}`
        if (keyOf[key] === nextKey && slot.media !== null) return
        keyOf[key] = nextKey
        if (slot.media !== null && slot.media.parentNode !== null) slot.media.parentNode.removeChild(slot.media)
        const el = document.createElement(info.kind === 'video' ? 'video' : 'img')
        el.className = 'dms-media'
        el.setAttribute('aria-hidden', 'true')
        if (info.kind === 'video') {
          el.autoplay = true
          el.loop = true
          el.muted = true
          el.defaultMuted = true
          el.playsInline = true
          el.setAttribute('playsinline', '')
          el.preload = 'auto'
        } else {
          el.decoding = 'async'
        }
        el.src = info.url
        slot.holder.appendChild(el)
        slot.media = el
      }

      function dropMedia(key) {
        const slot = nodes[key]
        if (slot === null || slot.media === null) return
        const el = slot.media
        if (el.tagName === 'VIDEO') {
          try {
            el.pause()
          } catch {
            /* 已经停了 */
          }
          el.removeAttribute('src')
        }
        if (el.parentNode !== null) el.parentNode.removeChild(el)
        slot.media = null
        keyOf[key] = ''
      }

      function clear() {
        window.removeEventListener('resize', syncSidebarWidth)
        for (const key of LAYERS) dropMedia(key)
        if (layer !== null && layer.parentNode !== null) layer.parentNode.removeChild(layer)
        layer = null
        scrim = null
        for (const key of LAYERS) {
          nodes[key] = null
          keyOf[key] = ''
        }
        for (const name of CSS_VARS) root.style.removeProperty(name)
        root.removeAttribute('data-dms')
      }

      /** 应用一份快照。设置不可用（关掉了 / 没素材 / 文件没了）时直接拆层。 */
      function apply(payload) {
        const settings = payload && payload.settings ? payload.settings : null
        const layers = payload && payload.layers ? payload.layers : null
        const mode = settings !== null && settings.mode === 'split' ? 'split' : 'full'
        const visibleKeys = mode === 'split' ? ['main', 'sidebar'] : ['full']
        let anyUsable = false
        if (settings !== null && layers !== null && settings.enabled === true) {
          for (const key of visibleKeys) {
            const info = layers[key]
            if (info && info.available === true && info.kind !== 'none' && typeof info.url === 'string') anyUsable = true
          }
        }
        if (!anyUsable) {
          clear()
          return
        }
        if (document.body === null) return
        ensureLayer()
        syncSidebarWidth()

        const percent = (value) => (Math.max(0, Math.min(200, value)) / 100).toFixed(3)
        root.setAttribute('data-dms', 'on')
        // 界面不透明度 = 压在素材上的那一层底色（亮主题白、暗主题黑）的 alpha。
        root.style.setProperty('--dms-scrim', Math.max(0, Math.min(1, settings.surface / 100)).toFixed(3))
        root.style.setProperty(
          '--dms-sidebar-extra',
          (0.03 + Math.max(0, Math.min(1, (settings.sidebar ?? 50) / 100)) * 0.05).toFixed(3),
        )

        const videoSettings = settings.video || {}
        for (const key of LAYERS) {
          const slot = nodes[key]
          if (slot === null) continue
          const info = layers[key]
          const enabledLayer = visibleKeys.includes(key)
          const usable = enabledLayer && info && info.available === true && info.kind !== 'none' && typeof info.url === 'string'
          if (!usable) {
            dropMedia(key)
            slot.layer.dataset.hidden = '1'
            continue
          }
          ensureMedia(key, info)
          slot.layer.dataset.hidden = '0'
          const crop = settings.layers && settings.layers[key] && settings.layers[key].crop ? settings.layers[key].crop : {}
          const cropX = typeof crop.x === 'number' ? crop.x : 0.5
          const cropY = typeof crop.y === 'number' ? crop.y : 0.5
          const cropZoom = typeof crop.zoom === 'number' ? crop.zoom : 1
          slot.layer.style.setProperty('--dms-px', `${(cropX * 100).toFixed(2)}%`)
          slot.layer.style.setProperty('--dms-py', `${(cropY * 100).toFixed(2)}%`)
          slot.layer.style.setProperty('--dms-zoom', String(cropZoom))

          // 画面参数按图层各写一份：两张图可以调出完全不同的性格。
          const look = settings.layers && settings.layers[key] && settings.layers[key].look ? settings.layers[key].look : {}
          const blur = typeof look.blur === 'number' ? look.blur : 0
          slot.layer.style.setProperty('--dms-blur', `${blur}px`)
          // 模糊会把边缘吃掉一圈，所以容器反向放大一点把边缘推到视口外。
          slot.layer.style.setProperty('--dms-bleed', `${Math.ceil(blur * 2.2)}px`)
          slot.layer.style.setProperty('--dms-opacity', percent(typeof look.mediaOpacity === 'number' ? look.mediaOpacity : 100))
          slot.layer.style.setProperty('--dms-brightness', percent(typeof look.brightness === 'number' ? look.brightness : 100))
          slot.layer.style.setProperty('--dms-saturate', percent(typeof look.saturate === 'number' ? look.saturate : 100))
          slot.layer.style.setProperty('--dms-contrast', percent(typeof look.contrast === 'number' ? look.contrast : 100))
        }

        for (const key of LAYERS) {
          const slot = nodes[key]
          if (slot === null || slot.media === null || slot.media.tagName !== 'VIDEO') continue
          const rate = Number(videoSettings.rate)
          slot.media.playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1
          if (videoSettings.paused === true) {
            try {
              slot.media.pause()
            } catch {
              /* 忽略 */
            }
          } else if (slot.media.paused) {
            const playing = slot.media.play()
            if (playing && typeof playing.catch === 'function') playing.catch(() => {})
          }
        }
      }

      return { apply, clear }
    }

    // ─────────────────────────── 小工具 ───────────────────────────

    /** 深合并两层（对象递归，其余覆盖）。 */
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
          out[key] = mergeSettings(previous, value)
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

    function clampNumber(value, min, max) {
      if (!Number.isFinite(value)) return min
      return Math.min(max, Math.max(min, value))
    }

    /** 目标区域在视口里的宽高比：裁切框按它画，构图才和落地一致。 */
    function aspectForLayer(layerKey, sidebarWidth) {
      const width = Math.max(1, window.innerWidth || 1)
      const height = Math.max(1, window.innerHeight || 1)
      if (layerKey === 'sidebar') return Math.max(0.2, sidebarWidth / height)
      if (layerKey === 'main') return Math.max(0.2, (width - sidebarWidth) / height)
      return width / height
    }

    // ─────────────────────────── 裁切器 ───────────────────────────

    /**
     * 交互式裁切器。
     *
     * 预览框里的图片与真实背景层用同一套渲染：
     *   `object-fit: cover; object-position: x% y%; transform: scale(zoom)`
     * 拖动时把像素位移换算成 `object-position` 的百分比 —— 换算的分母是"图像溢出容器的那部分"
     * （cover 基础尺寸 × zoom − 框尺寸），所以放大后拖同样的距离，画面移动量不变，手感一致。
     *
     * @param {object} props 组件参数。
     */
    function CropEditor(props) {
      const t = props.t
      const media = props.media
      const [draft, setDraft] = React.useState(props.crop)
      const boxRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const natRef = React.useRef([0, 0])
      const aspect = props.aspect

      const rememberNatural = (width, height) => {
        if (!(width > 0 && height > 0)) return
        natRef.current = [width, height]
      }

      /** 指针位移 → object-position 百分比。 */
      const panBy = (dx, dy, baseCrop, box) => {
        const [naturalWidth, naturalHeight] = natRef.current
        const boxWidth = box.width
        const boxHeight = box.height
        let overflowX = 0
        let overflowY = 0
        if (naturalWidth > 0 && naturalHeight > 0) {
          const coverScale = Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight)
          overflowX = Math.max(0, naturalWidth * coverScale * baseCrop.zoom - boxWidth)
          overflowY = Math.max(0, naturalHeight * coverScale * baseCrop.zoom - boxHeight)
        }
        const nextX = clampNumber(baseCrop.x - dx / Math.max(1, overflowX), 0, 1)
        const nextY = clampNumber(baseCrop.y - dy / Math.max(1, overflowY), 0, 1)
        return { x: nextX, y: nextY, zoom: baseCrop.zoom }
      }

      const onPointerDown = (event) => {
        if (boxRef.current === null) return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          crop: { ...draft },
          box: boxRef.current.getBoundingClientRect(),
        }
      }

      const onPointerMove = (event) => {
        const drag = dragRef.current
        if (drag === null || event.pointerId !== drag.id) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        setDraft(panBy(dx, dy, drag.crop, drag.box))
      }

      const endDrag = (event) => {
        if (dragRef.current !== null && dragRef.current.id === event.pointerId) dragRef.current = null
      }

      // 用非 passive 的 wheel 监听：React 的 onWheel 在某些浏览器里拦不住页面滚动。
      React.useEffect(() => {
        const box = boxRef.current
        if (box === null) return undefined
        const listener = (event) => {
          event.preventDefault()
          const factor = Math.exp(-event.deltaY * 0.0015)
          setDraft((current) => ({ ...current, zoom: clampNumber(current.zoom * factor, ZOOM_MIN, ZOOM_MAX) }))
        }
        box.addEventListener('wheel', listener, { passive: false })
        return () => box.removeEventListener('wheel', listener)
      }, [])

      const zoomBy = (factor) => {
        setDraft((current) => ({ ...current, zoom: clampNumber(current.zoom * factor, ZOOM_MIN, ZOOM_MAX) }))
      }

      // Esc 直接退出裁切：遮罩是全屏的，手上得有个不用找按钮的退路。
      const cancelRef = React.useRef(props.onCancel)
      cancelRef.current = props.onCancel
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') cancelRef.current()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [])

      const tag = media.kind === 'video' ? 'video' : 'img'
      const mediaProps =
        tag === 'video'
          ? {
              src: media.url,
              muted: true,
              autoPlay: true,
              loop: true,
              playsInline: true,
              onLoadedMetadata: (event) => rememberNatural(event.currentTarget.videoWidth, event.currentTarget.videoHeight),
            }
          : {
              src: media.url,
              draggable: false,
              onLoad: (event) => rememberNatural(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight),
            }

      const boxWidth = `min(78vw, ${Math.round(62 * aspect)}vh)`

      return h(
        'div',
        { className: 'dms-crop-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('cropTitle') },
        h(
          'div',
          { className: 'dms-crop-card' },
          h(
            'div',
            { className: 'dms-crop-head' },
            h('strong', null, t(props.layerLabel)),
            h(
              'span',
              { className: 'dms-crop-note' },
              `${t('cropAspect')} ${aspect >= 1 ? `${aspect.toFixed(2)}:1` : `1:${(1 / aspect).toFixed(2)}`}`,
            ),
          ),
          h(
            'div',
            {
              className: 'dms-crop-box',
              ref: boxRef,
              style: { width: boxWidth, aspectRatio: String(aspect) },
              onPointerDown,
              onPointerMove,
              onPointerUp: endDrag,
              onPointerCancel: endDrag,
            },
            h(tag, {
              ...mediaProps,
              className: 'dms-crop-media',
              style: {
                objectFit: 'cover',
                objectPosition: `${(draft.x * 100).toFixed(2)}% ${(draft.y * 100).toFixed(2)}%`,
                transform: `scale(${draft.zoom})`,
              },
            }),
            h('div', { className: 'dms-crop-grid' }),
          ),
          h(
            'div',
            { className: 'dms-crop-foot' },
            h(
              'div',
              { className: 'dms-zoom' },
              h(
                'button',
                { type: 'button', className: 'dms-btn', title: t('zoomOut'), 'aria-label': t('zoomOut'), onClick: () => zoomBy(1 / 1.25) },
                '−',
              ),
              h('span', { className: 'dms-crop-note' }, `${Math.round(draft.zoom * 100)}%`),
              h(
                'button',
                { type: 'button', className: 'dms-btn', title: t('zoomIn'), 'aria-label': t('zoomIn'), onClick: () => zoomBy(1.25) },
                '+',
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dms-btn',
                onClick: () => setDraft({ x: 0.5, y: 0.5, zoom: 1 }),
              },
              t('cropReset'),
            ),
            h('button', { type: 'button', className: 'dms-btn', onClick: props.onCancel }, t('cropCancel')),
            h(
              'button',
              { type: 'button', className: 'dms-btn dms-btn-primary', onClick: () => props.onApply(draft) },
              t('cropApply'),
            ),
          ),
          h('div', { className: 'dms-crop-note' }, t('cropHint')),
        ),
      )
    }

    // ─────────────────────────── 素材卡 ───────────────────────────

    /**
     * 头像：DS 蓝鲸厨娘。位图来自 `assets/avatar.png`，由 `scripts/make-avatar.py`
     * 从同人图裁成正方形；圆角由 CSS 的 `border-radius:50%` 负责。
     *
     * @param {object} props `className` 挂到 img 上。
     */
    function Avatar(props) {
      return h('img', {
        className: props && props.className ? props.className : 'dms-avatar',
        src: AVATAR_URL,
        alt: '',
        draggable: false,
      })
    }

    /**
     * 一个图层一张卡：小预览 + 文件名 + 换图/清除。
     *
     * - 点缩略图直接进裁切器（缩略图本身就是按当前裁切渲染的，所见即所得）；
     * - 点卡片任意位置把"画面"滑块切到这一层，选中态用主色描边标出来。
     */
    function MediaCard(props) {
      const { t, info, crop, layerLabel, busy, active, onPick, onClear, onCrop, onSelect } = props
      const hasMedia = info && info.available === true && info.kind !== 'none' && typeof info.url === 'string'
      const name = hasMedia ? info.name : ''
      const kindLabel = hasMedia ? (info.kind === 'video' ? t('video') : t('image')) : ''
      const tag = hasMedia && info.kind === 'video' ? 'video' : 'img'

      return h(
        'div',
        {
          className: 'dms-card',
          'data-active': active ? '1' : '0',
          onClick: onSelect,
        },
        h(
          'button',
          {
            type: 'button',
            className: 'dms-thumb',
            disabled: !hasMedia,
            title: hasMedia ? t('cropTitle') : t('empty'),
            'aria-label': hasMedia ? `${t('crop')} · ${t(layerLabel)}` : t('empty'),
            onClick: (event) => {
              event.stopPropagation()
              if (hasMedia) onCrop()
            },
          },
          hasMedia
            ? h(tag, {
                className: 'dms-thumb-media',
                src: info.url,
                muted: true,
                autoPlay: tag === 'video',
                loop: true,
                playsInline: true,
                style: {
                  objectFit: 'cover',
                  objectPosition: `${(crop.x * 100).toFixed(2)}% ${(crop.y * 100).toFixed(2)}%`,
                  transform: `scale(${crop.zoom})`,
                },
              })
            : h('div', { className: 'dms-thumb-empty' }, '∅'),
          hasMedia ? h('span', { className: 'dms-thumb-hint' }, t('crop')) : null,
        ),
        h(
          'div',
          { className: 'dms-card-body' },
          h(
            'div',
            { className: 'dms-card-head' },
            h('span', { className: 'dms-card-title' }, t(layerLabel)),
            kindLabel === '' ? null : h('span', { className: 'dms-badge' }, kindLabel),
            hasMedia && info.size > 0 ? h('span', { className: 'dms-hint' }, formatSize(info.size)) : null,
          ),
          h('span', { className: 'dms-name', title: name }, hasMedia ? name : t('empty')),
          h(
            'div',
            { className: 'dms-actions' },
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
                  onPick(file)
                },
              }),
            ),
            hasMedia
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dms-btn',
                    disabled: busy,
                    onClick: (event) => {
                      event.stopPropagation()
                      onClear()
                    },
                  },
                  t('clear'),
                )
              : null,
          ),
        ),
      )
    }

    // ─────────────────────────── 面板 ───────────────────────────

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
      const [busy, setBusy] = React.useState({})
      /** 画面滑块当前作用在哪个图层（整窗模式只有 full，分栏模式 main/sidebar 可切）。 */
      const [activeLayer, setActiveLayer] = React.useState('full')
      const [cropping, setCropping] = React.useState(null)
      /** "复制调色"刚点完的那 1.5 秒内把按钮显示成"已同步"。 */
      const [syncDone, setSyncDone] = React.useState(false)
      const syncTimerRef = React.useRef(null)

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
          if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
          syncTimerRef.current = null
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
          // 面板的展开状态只在首次加载时从宿主恢复一次；之后由用户点击决定。
          if (!touchedRef.current && settings.panel) setOpen(settings.panel.open === true)
        })
        return () => {
          alive = false
        }
      }, [publish])

      /** 把积攒的补丁写回宿主；失败时把错误摊在面板里，绝不静默。 */
      const flush = React.useCallback(() => {
        const patch = pendingRef.current
        pendingRef.current = {}
        if (!patch || Object.keys(patch).length === 0) return Promise.resolve()
        return readJson(STATE_URL, {
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
          // 只采纳宿主算出来的图层信息（url/version），其余以后续拖动为准。
          publish({ settings: current.settings, layers: payload.layers })
        })
      }, [publish])

      /**
       * 立刻把待写补丁发出去（不等防抖）。
       *
       * 上传 / 清除都会拿到宿主返回的完整快照并覆盖本地状态，
       * 如果此时队列里还压着"刚切的模式""刚拖的裁切"，那次覆盖就会把它们悄悄回滚。
       * 所以这些操作开头先等一次 flush。
       */
      const flushNow = React.useCallback(() => {
        if (timerRef.current !== null) {
          window.clearTimeout(timerRef.current)
          timerRef.current = null
        }
        return flush()
      }, [flush])

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
          const next = { settings: mergeSettings(current.settings, partial), layers: current.layers }
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
          latestRef.current = { settings, layers: current.layers }
          queue({ panel: { open: next } })
        },
        [queue],
      )

      // 模式切换时把"画面作用层"收回主层，避免滑块指向一个当前根本不显示的图层。
      const viewMode = view && view.settings && view.settings.mode === 'split' ? 'split' : 'full'
      React.useEffect(() => {
        setActiveLayer(viewMode === 'split' ? 'main' : 'full')
      }, [viewMode])

      const upload = React.useCallback(
        async (layerKey, file) => {
          if (!file) return
          setError('')
          setBusy((current) => ({ ...current, [layerKey]: true }))
          try {
            await flushNow()
            const response = await fetch(UPLOAD_URL, {
              method: 'POST',
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-dms-name': encodeURIComponent(file.name || 'media'),
                'x-dms-layer': layerKey,
              },
              body: file,
            })
            const payload = await response.json().catch(() => null)
            if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
            pendingRef.current = {}
            publish(payload)
          } catch (error) {
            setError((error && error.message) || String(error))
          } finally {
            setBusy((current) => ({ ...current, [layerKey]: false }))
          }
        },
        [flushNow, publish],
      )

      const clearLayer = React.useCallback(
        (layerKey) => {
          setError('')
          flushNow()
            .then(() =>
              readJson(STATE_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ layers: { [layerKey]: { media: { source: 'none', path: '', name: '' } } } }),
              }),
            )
            .then((payload) => {
              if (payload && payload.error) {
                setError(String(payload.error))
                return
              }
              pendingRef.current = {}
              publish(payload)
            })
        },
        [flushNow, publish],
      )

      const resetAll = React.useCallback(() => {
        setError('')
        flushNow()
          .then(() =>
            readJson(STATE_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                enabled: true,
                mode: 'full',
                surface: 40,
                sidebar: 48,
                video: { rate: 1, paused: false },
                layers: {
                  full: { crop: { x: 0.5, y: 0.5, zoom: 1 }, look: { ...DEFAULT_LOOK } },
                  main: { crop: { x: 0.5, y: 0.5, zoom: 1 }, look: { ...DEFAULT_LOOK } },
                  sidebar: { crop: { x: 0.5, y: 0.5, zoom: 1 }, look: { ...DEFAULT_LOOK } },
                },
              }),
            }),
          )
          .then((payload) => {
            if (payload && payload.error) {
              setError(String(payload.error))
              return
            }
            pendingRef.current = {}
            publish(payload)
          })
      }, [flushNow, publish])

      const settings = view && view.settings ? view.settings : null
      const layers = view && view.layers ? view.layers : null
      const mode = settings ? (settings.mode === 'split' ? 'split' : 'full') : 'full'
      const activeLayers = mode === 'split' ? ['main', 'sidebar'] : ['full']
      /** 当前画面滑块作用的那一层（越界时退回主层）。 */
      const lookLayer = activeLayers.includes(activeLayer) ? activeLayer : activeLayers[0]

      /** 图层 → 文案 key。 */
      const layerLabelOf = (key) => (key === 'full' ? 'layerFull' : key === 'sidebar' ? 'layerSidebar' : 'layerMain')

      /** 读某一层的画面参数，缺项回落到默认值。 */
      const layerLook = (key) => {
        const layer = settings && settings.layers && settings.layers[key] ? settings.layers[key] : null
        const look = layer && layer.look ? layer.look : {}
        const out = {}
        for (const item of SLIDERS) {
          out[item.key] = typeof look[item.key] === 'number' ? look[item.key] : DEFAULT_LOOK[item.key]
        }
        return out
      }

      /** 切到分栏时，内容区还没素材就继承整窗那张 —— 不能让用户一进来就看见空白。 */
      const changeMode = (nextMode) => {
        if (!settings) return
        if (nextMode === 'split') {
          const fullLayer = settings.layers && settings.layers.full ? settings.layers.full : null
          const mainLayer = settings.layers && settings.layers.main ? settings.layers.main : null
          const fullSource = fullLayer && fullLayer.media ? fullLayer.media.source : 'none'
          const mainSource = mainLayer && mainLayer.media ? mainLayer.media.source : 'none'
          if (mainSource === 'none' && fullSource !== 'none') {
            // 先把本地图层信息补上：patch 之后、宿主回包之前，引擎按本地 layers 渲染，
            // 少了这一步会有一瞬"内容区没素材 → 整层拆掉"的闪空。
            const current = latestRef.current
            if (current && current.layers && current.layers.full && current.layers.full.available && current.layers.main) {
              latestRef.current = {
                settings: current.settings,
                layers: { ...current.layers, main: { ...current.layers.full, key: 'main' } },
              }
            }
            patch({ mode: nextMode, layers: { main: { media: { ...fullLayer.media }, crop: { ...fullLayer.crop } } } })
            return
          }
        }
        patch({ mode: nextMode })
      }

      /** 滑块轨道填充比例（0~100%），驱动 CSS 里的 `--dms-fill`。 */
      const fillOf = (value, min, max) => {
        const span = max - min
        if (!(span > 0)) return '0%'
        const ratio = Math.min(1, Math.max(0, (value - min) / span))
        return `${(ratio * 100).toFixed(1)}%`
      }

      const sliderRow = (item) => {
        const look = layerLook(lookLayer)
        return h(
          'div',
          { className: 'dms-field', key: item.key },
          h(
            'div',
            { className: 'dms-row dms-row-between' },
            h('span', { className: 'dms-label' }, t(item.label)),
            h('span', { className: 'dms-value' }, `${look[item.key]}${item.unit === 'px' ? t('px') : t('percent')}`),
          ),
          h('input', {
            className: 'dms-range',
            type: 'range',
            min: item.min,
            max: item.max,
            step: item.step,
            value: look[item.key],
            style: { '--dms-fill': fillOf(look[item.key], item.min, item.max) },
            disabled: settings === null,
            'aria-label': `${t(item.label)} · ${t(layerLabelOf(lookLayer))}`,
            onChange: (event) => {
              const number = Number(event.target.value)
              patch({ layers: { [lookLayer]: { look: { [item.key]: number } } } })
            },
          }),
        )
      }

      const card = (layerKey, labelKey) => {
        const layerSettings = settings && settings.layers && settings.layers[layerKey] ? settings.layers[layerKey] : null
        const crop = layerSettings && layerSettings.crop ? layerSettings.crop : { x: 0.5, y: 0.5, zoom: 1 }
        return h(MediaCard, {
          key: layerKey,
          t,
          info: layers ? layers[layerKey] : null,
          crop,
          layerLabel: labelKey,
          busy: busy[layerKey] === true,
          active: lookLayer === layerKey,
          onSelect: () => setActiveLayer(layerKey),
          onPick: (file) => upload(layerKey, file),
          onClear: () => clearLayer(layerKey),
          onCrop: () => {
            const info = layers ? layers[layerKey] : null
            if (!info || info.available !== true) return
            setCropping({ layerKey, labelKey, info, crop })
          },
        })
      }

      /** 全局压色滑块（界面不透明度 / 侧栏压色）。 */
      const globalSlider = (key, labelKey, min, max) => {
        const current = settings ? settings[key] : min
        return h(
          'div',
          { className: 'dms-field', key },
          h(
            'div',
            { className: 'dms-row dms-row-between' },
            h('span', { className: 'dms-label' }, t(labelKey)),
            h('span', { className: 'dms-value' }, `${current}${t('percent')}`),
          ),
          h('input', {
            className: 'dms-range',
            type: 'range',
            min,
            max,
            step: 1,
            value: current,
            style: { '--dms-fill': fillOf(current, min, max) },
            disabled: settings === null,
            'aria-label': t(labelKey),
            onChange: (event) => patch({ [key]: Number(event.target.value) }),
          }),
        )
      }

      const mediaOfCropping = cropping ? cropping.info : null
      const sidebarWidth = typeof window !== 'undefined' ? measureSidebarWidth() : DEFAULT_SIDEBAR_WIDTH

      const anyVideo =
        layers !== null &&
        activeLayers.some((key) => layers[key] && layers[key].kind === 'video' && layers[key].available === true)

      const splitMode = mode === 'split'
      /** 分栏时"另一层"是哪一层；整窗模式没有这一项。 */
      const otherLayerKey = splitMode ? activeLayers.filter((key) => key !== lookLayer)[0] || null : null

      /**
       * 把当前这层的五个画面参数整组复制到另一层。
       *
       * 分栏常用的就是"两边调成一个调子"，一张张拖十条滑块很烦；
       * 复制只是把 look 搬过去，裁切、素材、压色都不动。
       */
      const copyLookTo = (targetKey) => {
        if (targetKey === null) return
        patch({ layers: { [targetKey]: { look: { ...layerLook(lookLayer) } } } })
        if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current)
        setSyncDone(true)
        syncTimerRef.current = window.setTimeout(() => {
          syncTimerRef.current = null
          setSyncDone(false)
        }, 1500)
      }

      return h(
        'div',
        { className: 'dms-root', 'data-open': open ? '1' : '0' },
        h('style', null, CSS),
        open
          ? h(
              'div',
              { className: 'dms-panel', role: 'dialog', 'aria-label': t('title') },

              // ── 标题栏：头像 + 标题 + 当前布局 + 总开关 ──
              h(
                'div',
                { className: 'dms-head' },
                h(Avatar, { className: 'dms-avatar' }),
                h(
                  'div',
                  { className: 'dms-head-text' },
                  h('span', { className: 'dms-head-title' }, t('title')),
                  h('span', { className: 'dms-head-sub' }, settings === null ? t('loading') : t(splitMode ? 'modeSplit' : 'modeFull')),
                ),
                settings === null
                  ? null
                  : h(
                      'label',
                      {
                        className: 'dms-switch',
                        'data-on': settings.enabled === true ? '1' : '0',
                        title: t('enable'),
                      },
                      h('input', {
                        type: 'checkbox',
                        checked: settings.enabled === true,
                        'aria-label': t('enable'),
                        onChange: (event) => patch({ enabled: event.target.checked }),
                      }),
                    ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dms-icon-btn',
                    title: t('close'),
                    'aria-label': t('close'),
                    onClick: () => toggleOpen(false),
                  },
                  '✕',
                ),
              ),

              // ── 背景布局 ──
              settings === null
                ? null
                : h(
                    'div',
                    { className: 'dms-section' },
                    h(
                      'div',
                      { className: 'dms-section-head' },
                      h('div', { className: 'dms-section-title' }, t('modeSection')),
                    ),
                    h(
                      'div',
                      { className: 'dms-chips', 'data-fill': '1' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dms-chip',
                          'data-active': splitMode ? '0' : '1',
                          onClick: () => changeMode('full'),
                        },
                        t('modeFull'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dms-chip',
                          'data-active': splitMode ? '1' : '0',
                          onClick: () => changeMode('split'),
                        },
                        t('modeSplit'),
                      ),
                    ),
                  ),

              // ── 素材（按当前模式列图层）──
              settings === null
                ? null
                : h(
                    'div',
                    { className: 'dms-section' },
                    h(
                      'div',
                      { className: 'dms-section-head' },
                      h('div', { className: 'dms-section-title' }, t('mediaSection')),
                    ),
                    h(
                      'div',
                      { className: 'dms-cards' },
                      activeLayers.map((key) => card(key, layerLabelOf(key))),
                    ),
                    // 两张都配好了就不再占两行提示；只在"还有槽位空着"时给一句引导。
                    activeLayers.some((key) => !(layers !== null && layers[key] && layers[key].available === true))
                      ? h('div', { className: 'dms-hint' }, t('pickHint'))
                      : null,
                  ),

              // ── 画面（每个图层一套；底部两条是全局压色）──
              settings === null
                ? null
                : h(
                    'div',
                    { className: 'dms-section' },
                    h(
                      'div',
                      { className: 'dms-section-head' },
                      h('div', { className: 'dms-section-title' }, t('tuningSection')),
                      splitMode
                        ? h(
                            'div',
                            { className: 'dms-chips' },
                            activeLayers.map((key) =>
                              h(
                                'button',
                                {
                                  key,
                                  type: 'button',
                                  className: 'dms-chip',
                                  'data-active': lookLayer === key ? '1' : '0',
                                  onClick: () => setActiveLayer(key),
                                },
                                t(layerLabelOf(key)),
                              ),
                            ),
                          )
                        : null,
                    ),
                    h('div', { className: 'dms-fields' }, SLIDERS.map(sliderRow)),
                    otherLayerKey === null
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'dms-sync',
                            'data-done': syncDone ? '1' : '0',
                            title: t('syncTip'),
                            onClick: () => copyLookTo(otherLayerKey),
                          },
                          h(
                            'svg',
                            {
                              viewBox: '0 0 16 16',
                              fill: 'none',
                              stroke: 'currentColor',
                              strokeWidth: 1.6,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                              'aria-hidden': 'true',
                            },
                            syncDone
                              ? h('path', { d: 'M3.2 8.6l3.1 3.1 6.5-6.6' })
                              : [
                                  h('path', { key: 'top', d: 'M2.4 6.1h9.2' }),
                                  h('path', { key: 'top-arrow', d: 'M9.2 3.6l2.5 2.5-2.5 2.5' }),
                                  h('path', { key: 'bottom', d: 'M13.6 9.9H4.4' }),
                                  h('path', { key: 'bottom-arrow', d: 'M6.8 7.4L4.3 9.9l2.5 2.5' }),
                                ],
                          ),
                          syncDone ? t('synced') : `${t('syncLook')} ${t(layerLabelOf(otherLayerKey))}`,
                        ),
                    h('div', { className: 'dms-divider' }),
                    globalSlider('surface', 'surface', 0, 100),
                    globalSlider('sidebar', 'sidebarExtra', 10, 100),
                  ),

              // ── 视频 ──
              anyVideo
                ? h(
                    'div',
                    { className: 'dms-section' },
                    h(
                      'div',
                      { className: 'dms-section-head' },
                      h('div', { className: 'dms-section-title' }, t('videoSection')),
                    ),
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
                { className: 'dms-foot' },
                h('button', { type: 'button', className: 'dms-btn', onClick: resetAll, disabled: settings === null }, t('reset')),
                h('span', { className: 'dms-hint' }, t('hint')),
              ),
            )
          : null,

        // 裁切器（全屏遮罩，不在面板内部，避免被面板的滚动容器裁掉）
        cropping !== null && mediaOfCropping !== null
          ? h(CropEditor, {
              t,
              media: mediaOfCropping,
              crop: cropping.crop,
              layerLabel: cropping.labelKey,
              aspect: aspectForLayer(cropping.layerKey, sidebarWidth),
              onCancel: () => setCropping(null),
              onApply: (nextCrop) => {
                const layerKey = cropping.layerKey
                setCropping(null)
                patch({ layers: { [layerKey]: { crop: nextCrop } } })
              },
            })
          : null,

        // 面板打开时收起圆钮（面板内已有 ✕），把整块高度让给内容；关掉后再露出来。
        open
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'dms-fab',
                title: t('open'),
                'aria-label': t('open'),
                'aria-expanded': 'false',
                onClick: () => toggleOpen(true),
              },
              h(Avatar, { className: 'dms-fab-img' }),
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
