"""从一张「DS 蓝鲸厨娘」同人图裁出三件图标产物。

    python scripts/make-avatar.py 原图.png [--box x0,y0,x1,y1] [--card x,y,w,h]

产物（都会覆盖写）：
    assets/avatar.png    256px 方形头像，宿主 `/dsh-media-skin/avatar` 下发（圆钮 + 面板标题用）
    assets/icon-180.png  180px 方形位图，目录站卡片用（目录站只收位图）
    icon.svg             插件图标：圆角底板 + 内嵌的 160px PNG（data URI）

为什么 icon.svg 里嵌位图而不是换成 icon.png：DSH 按包导出 `./icon` 取图标并按
`image/svg+xml` 下发，换成位图有可能被当成脚本资源处理；SVG 包一张内嵌图最稳。

默认裁切框是按常见「五格拼图」截图量出来的（第二格人像），换图时用 --box / --card 覆盖。
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 默认：拼图里第二格（人像那张）的边框 → 再从中取方形
DEFAULT_CARD = (160, 140, 299, 355)
DEFAULT_BOX = (0, 18, 139, 157)

AVATAR_SIZE = 256
MARKET_SIZE = 180
ICON_SIZE = 160
ICON_COLORS = 192


def sharpen(img: Image.Image) -> Image.Image:
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=65, threshold=2))


def crop_square(src: Image.Image, card, box) -> Image.Image:
    width = box[2] - box[0]
    height = box[3] - box[1]
    if width != height:
        raise SystemExit(f"裁切框必须是正方形：{width}x{height}")
    return src.crop((card[0] + box[0], card[1] + box[1], card[0] + box[2], card[1] + box[3]))


def save_png(img: Image.Image, path: str, **kw) -> int:
    img.save(path, optimize=True, **kw)
    return os.path.getsize(path)


def build(src: Image.Image) -> None:
    assets = os.path.join(ROOT, 'assets')
    os.makedirs(assets, exist_ok=True)

    avatar = sharpen(src.resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS))
    avatar_path = os.path.join(assets, 'avatar.png')
    print(f'assets/avatar.png      {AVATAR_SIZE}px  {save_png(avatar, avatar_path) // 1024} KB')

    market = sharpen(src.resize((MARKET_SIZE, MARKET_SIZE), Image.LANCZOS))
    market_path = os.path.join(assets, 'icon-180.png')
    print(f'assets/icon-180.png    {MARKET_SIZE}px  {save_png(market, market_path) // 1024} KB')

    # icon.svg：160px、192 色调色板（照片压到 20KB 上下，视觉上看不出损失）
    small = sharpen(src.resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS))
    quantized = small.quantize(colors=ICON_COLORS, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    buffer = io.BytesIO()
    quantized.save(buffer, format='PNG', optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    # 圆角交给 SVG 的 clipPath 做：位图这儿只存 RGB，省掉一整条 alpha 通道的体积

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="DS 蓝鲸厨娘 · 本地媒体皮肤">
  <title>DS 蓝鲸厨娘</title>
  <defs>
    <clipPath id="dms-plate"><rect x="0" y="0" width="64" height="64" rx="15"/></clipPath>
  </defs>
  <image href="data:image/png;base64,{encoded}" x="0" y="0" width="64" height="64"
         clip-path="url(#dms-plate)" preserveAspectRatio="xMidYMid slice"/>
  <rect x="0.5" y="0.5" width="63" height="63" rx="14.5" fill="none" stroke="#ffffff" stroke-opacity="0.35"/>
</svg>
'''
    icon_path = os.path.join(ROOT, 'icon.svg')
    with open(icon_path, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write(svg)
    print(f'icon.svg               {ICON_SIZE}px 内嵌  {os.path.getsize(icon_path) // 1024} KB')


def main() -> None:
    parser = argparse.ArgumentParser(description='裁出 avatar.png / icon-180.png / icon.svg')
    parser.add_argument('source', help='同人拼图截图路径')
    parser.add_argument('--card', default=None, help='人像那一格的边框：x,y,w,h（左上角 + 宽高）')
    parser.add_argument('--box', default=None, help='格内的正方形裁切框：x0,y0,x1,y1')
    args = parser.parse_args()

    def parse(text: str) -> tuple[int, ...]:
        return tuple(int(part) for part in text.split(','))

    if args.card:
        x, y, w, h = parse(args.card)
        card = (x, y, x + w, y + h)
    else:
        card = DEFAULT_CARD
    box = parse(args.box) if args.box else DEFAULT_BOX

    source = Image.open(args.source).convert('RGB')
    build(crop_square(source, card, box))
    print('done')


if __name__ == '__main__':
    sys.exit(main())
