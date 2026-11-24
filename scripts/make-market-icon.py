"""生成市场卡片图标 assets/icon-180.png（180x180 位图，方形）。

目录站只收 GitHub 托管的位图（png/jpg/jpeg/webp），SVG 会被拒；
这里按 icon.svg 的同一套图形在 4x 画布上重画，再降采样到 180px。
"""
import numpy as np
from PIL import Image, ImageDraw

S = 720          # 画布
OUT = 180        # 目标边长
k = S / 64.0     # icon.svg 的 viewBox 是 64x64


def p(x):
    return x * k


# --- 圆角方块 + 对角渐变 -------------------------------------------------
x0, y0, x1, y1 = 2, 4, 58, 60          # 渐变起止（viewBox 坐标）
stops = [(0.0, (59, 130, 246)), (0.55, (99, 102, 241)), (1.0, (139, 92, 246))]

yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / k
d = ((xx - x0) * (x1 - x0) + (yy - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)
d = np.clip(d, 0.0, 1.0)

grad = np.zeros((S, S, 3), dtype=np.float32)
for i in range(len(stops) - 1):
    a, ca = stops[i]
    b, cb = stops[i + 1]
    m = (d >= a) & (d <= b)
    t = np.zeros_like(d)
    t[m] = (d[m] - a) / (b - a)
    for c in range(3):
        grad[..., c] = np.where(m, ca[c] + (cb[c] - ca[c]) * t, grad[..., c])

mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([p(2), p(2), p(62), p(62)], radius=p(15), fill=255)

icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
icon.paste(Image.fromarray(grad.astype(np.uint8), "RGB"), (0, 0), mask)

# --- 图片框：半透明白底 + 白描边 ----------------------------------------
layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ld = ImageDraw.Draw(layer)
ld.rounded_rectangle(
    [p(11), p(14), p(53), p(44)],
    radius=p(5),
    fill=(255, 255, 255, 41),
    outline=(255, 255, 255, 255),
    width=max(1, round(p(2.2))),
)
icon = Image.alpha_composite(icon, layer)

# --- 太阳、山线、播放徽标 ------------------------------------------------
layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ld = ImageDraw.Draw(layer)

ld.ellipse([p(21 - 2.7), p(23.5 - 2.7), p(21 + 2.7), p(23.5 + 2.7)], fill=(255, 255, 255, 255))

pts = [(14, 39.5), (22.5, 31), (28, 36.5), (33, 32), (43.5, 41)]
ld.line([(p(x), p(y)) for x, y in pts], fill=(255, 255, 255, 255),
        width=max(1, round(p(2.4))), joint="curve")

ld.ellipse([p(35), p(35), p(55), p(55)], fill=(255, 255, 255, 240))
ld.polygon([(p(42.2), p(40.4)), (p(42.2), p(49.6)), (p(50.2), p(45.0))],
           fill=(79, 70, 229, 255))

icon = Image.alpha_composite(icon, layer)
icon = icon.resize((OUT, OUT), Image.LANCZOS)

icon.save("assets/icon-180.png", optimize=True)
print("wrote assets/icon-180.png", icon.size)
