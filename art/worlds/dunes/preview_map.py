"""Quick top-down check of the dune field, shadows, slabs and flight path (plain python3 + PIL).

    python3 art/worlds/dunes/preview_map.py [out.png] [x0 y0 size]
"""

import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import dunes_model as dm  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/dunes_map.png"
if len(sys.argv) > 4:
    x0, y0, size = map(float, sys.argv[2:5])
else:
    x0, y0, size = -700.0, -1300.0, 1500.0
N = 750
xs = np.linspace(x0, x0 + size, N)
ys = np.linspace(y0, y0 + size, N)
X, Y = np.meshgrid(xs, ys)
H = dm.height(X, Y)
px = size / (N - 1)
gy, gx = np.gradient(H, px)
n = np.stack([-gx, -gy, np.ones_like(H)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
L = dm.sun_dir()
lam = np.clip(n @ L, 0, 1)
# March toward the sun for cast shadows.
shadow = np.ones_like(H)
step = px
tan_el = math.tan(math.radians(dm.SUN_ELEVATION))
dx, dy = L[0] / math.hypot(L[0], L[1]), L[1] / math.hypot(L[0], L[1])
for k in range(1, 90):
    d = k * step
    sx = np.clip(((X + dx * d) - x0) / px, 0, N - 1).astype(int)
    sy = np.clip(((Y + dy * d) - y0) / px, 0, N - 1).astype(int)
    shadow = np.where(H[sy, sx] > H + d * tan_el, 0.0, shadow)
shade = lam * shadow * 0.85 + 0.15 * n[..., 2]
col = np.stack([shade * 1.0, shade * 0.72, shade * 0.45], -1)
elev = (H - H.min()) / (H.max() - H.min())
col = col * 0.85 + elev[..., None] * 0.15
img = Image.fromarray((np.clip(col, 0, 1)[::-1] * 255).astype(np.uint8))
dr = ImageDraw.Draw(img)


def to_px(x, y):
    return ((x - x0) / px, (N - 1) - (y - y0) / px)


ss, pos, look, fov, roll = dm.flight(0.01)
pts = [to_px(p[0], p[1]) for p in pos]
dr.line(pts, fill=(60, 200, 255), width=2)
for s in range(0, 5):
    i = min(len(ss) - 1, int(s / 0.01))
    x, y = to_px(pos[i][0], pos[i][1])
    dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 255, 255))
    dr.text((x + 6, y - 6), f"s{s}", fill=(255, 255, 255))
for i in range(0, len(ss), 20):
    a = to_px(pos[i][0], pos[i][1])
    b = to_px(look[i][0], look[i][1])
    v = np.array(b) - np.array(a)
    v = v / max(1e-6, np.linalg.norm(v)) * 18
    dr.line([a, (a[0] + v[0], a[1] + v[1])], fill=(255, 120, 200), width=1)
for m in dm.MONOLITHS:
    nrm, t = dm.monolith_frame(m)
    c = np.array(m["p"])
    a = to_px(*(c - t * m["w"] / 2))
    b = to_px(*(c + t * m["w"] / 2))
    dr.line([a, b], fill=(20, 20, 20), width=4)
    f = to_px(*(c + nrm * 10))
    dr.line([to_px(*c), f], fill=(255, 230, 0), width=1)
for k, x, y, *_ in dm.PROPS:
    p = to_px(x, y)
    dr.rectangle([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=(255, 255, 255) if k == "trunk" else (90, 90, 90))
img.save(out)
print("saved", out, "h range", round(float(H.min()), 1), round(float(H.max()), 1))
alt = pos[:, 2] - dm.height(pos[:, 0], pos[:, 1])
print("clearance min/max", round(float(alt.min()), 2), round(float(alt.max()), 1))
