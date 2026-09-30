"""Fast framing check of the camera flight (plain python3 + numpy + PIL, no Blender).

Ray-marches the dune height field with sun shading and cast shadows and draws
the slabs as boxes, so camera keys can be tuned in seconds.

    python3 art/worlds/dunes/preview_frames.py 0.0,0.62,1.0 [out_dir] [width]

Writes <out_dir>/frame-<s>.png plus a contact sheet frames.png.
"""

import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import dunes_model as dm  # noqa: E402

OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path("/tmp/dunes_frames")
W = int(sys.argv[3]) if len(sys.argv) > 3 else 400
H = W * 10 // 16
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / "hgrid.npy"
RES = 2.0
x0, y0, size = dm.CORE_X0, dm.CORE_Y0, dm.CORE_SIZE
N = int(size / RES) + 1

if CACHE.exists():
    G = np.load(CACHE)
else:
    xs = np.linspace(x0, x0 + size, N)
    ys = np.linspace(y0, y0 + size, N)
    G = np.zeros((N, N), np.float32)
    for i in range(0, N, 100):
        X, Y = np.meshgrid(xs, ys[i : i + 100])
        G[i : i + 100] = dm.height(X, Y)
    np.save(CACHE, G)


def hsample(x, y):
    u = np.clip((x - x0) / RES, 0, N - 1.001)
    v = np.clip((y - y0) / RES, 0, N - 1.001)
    i, j = np.floor(v).astype(int), np.floor(u).astype(int)
    fu, fv = u - j, v - i
    a = G[i, j] * (1 - fu) + G[i, j + 1] * fu
    b = G[i + 1, j] * (1 - fu) + G[i + 1, j + 1] * fu
    return a * (1 - fv) + b * fv


def normal_at(x, y):
    e = RES
    gx = (hsample(x + e, y) - hsample(x - e, y)) / (2 * e)
    gy = (hsample(x, y + e) - hsample(x, y - e)) / (2 * e)
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


SUN = dm.sun_dir()
metas = dm.monolith_placements()


def slab_hit(o, d, m):
    """Ray vs oriented box (slab) -> t or inf, plus a flag for the panel face."""
    yaw = math.radians(m["yaw"])
    c, s = math.cos(yaw), math.sin(yaw)
    R = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])  # world -> local
    lo = np.array([-m["thickness"] / 2, -m["w"] / 2, 0.0])
    hi = np.array([m["thickness"] / 2, m["w"] / 2, m["ground"] + m["h"] - m["base"]])
    ol = (o - np.array([m["p"][0], m["p"][1], m["base"]])) @ R.T
    dl = d @ R.T
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = (lo - ol) / dl
        t2 = (hi - ol) / dl
    tn = np.nanmax(np.minimum(t1, t2), -1)
    tf = np.nanmin(np.maximum(t1, t2), -1)
    hit = (tf >= tn) & (tf > 0)
    t = np.where(hit, np.maximum(tn, 0), np.inf)
    p = ol + dl * t[..., None]
    zc = (m["ground"] - m["base"]) + m["h"] * 0.54
    pw = m["w"] * 0.78
    ph = pw * 16 / 9
    panel = hit & (p[..., 0] > m["thickness"] / 2 - 0.01) & (np.abs(p[..., 1]) < pw / 2) & (np.abs(p[..., 2] - zc) < ph / 2)
    return t, panel


def sky(d):
    e = np.clip(d[..., 2], -0.2, 1)
    horizon = np.array([1.0, 0.62, 0.36])
    zen = np.array([0.22, 0.38, 0.62])
    t = np.clip(e / 0.5, 0, 1)[..., None] ** 0.6
    col = horizon * (1 - t) + zen * t
    g = np.clip(d @ SUN, 0, 1)[..., None]
    return col + np.array([1.0, 0.8, 0.5]) * (g**40 * 2.5 + g**6 * 0.35)


def render(s):
    ss, pos, look, fov, roll = dm.flight(0.01)
    i = int(round(s / 0.01))
    o, tgt, fv, rl = pos[i], look[i], fov[i], roll[i]
    f = tgt - o
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    a = math.radians(rl)
    r, u = r * math.cos(a) + u * math.sin(a), -r * math.sin(a) + u * math.cos(a)
    th = math.tan(math.radians(fv) / 2)
    px = (np.arange(W) + 0.5) / W * 2 - 1
    py = 1 - (np.arange(H) + 0.5) / H * 2
    PX, PY = np.meshgrid(px * th * W / H, py * th)
    d = f + PX[..., None] * r + PY[..., None] * u
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    # March the height field.
    t = np.full((H, W), 0.5)
    hitt = np.full((H, W), np.inf)
    alive = np.ones((H, W), bool)
    for _ in range(700):
        p = o + d * t[..., None]
        h = hsample(p[..., 0], p[..., 1])
        below = alive & (p[..., 2] < h)
        hitt[below] = t[below]
        alive &= ~below
        if not alive.any():
            break
        t = t + np.maximum(0.25, t * 0.012)
        alive &= t < 9000
    col = sky(d)
    ter = np.isfinite(hitt)
    p = o + d * np.where(ter, hitt, 0)[..., None]
    n = normal_at(p[..., 0], p[..., 1])
    lam = np.clip(n @ SUN, 0, 1)
    # Shadow: march toward the sun.
    sh = np.ones((H, W))
    q = p.copy() + n * 0.3
    for k in range(1, 70):
        q = q + SUN * (1.5 + k * 0.25)
        sh = np.where(q[..., 2] < hsample(q[..., 0], q[..., 1]), 0.0, sh)
    sand = np.array([1.0, 0.66, 0.38])
    lit = sand * (lam * sh * 1.6 + 0.18 + 0.1 * n[..., 2])[..., None]
    fog = 1 - np.exp(-hitt * 0.00035)
    lit = lit * (1 - fog[..., None]) + np.array([1.0, 0.7, 0.5]) * fog[..., None]
    col = np.where(ter[..., None], lit, col)
    best = np.where(ter, hitt, np.inf)
    for m in metas:
        ts, panel = slab_hit(o, d, m)
        closer = ts < best
        body = {"glass": (0.05, 0.05, 0.06), "metal": (0.55, 0.4, 0.28), "stone": (0.62, 0.42, 0.28)}[m["kind"]]
        c = np.where(panel[..., None], np.array([1.0, 0.75, 0.45]) * 1.3, np.array(body))
        col = np.where(closer[..., None], c, col)
        best = np.where(closer, ts, best)
    img = np.clip(col / (1 + col) * 1.6, 0, 1) ** (1 / 1.6)
    im = Image.fromarray((img * 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    dr.line([(W * 0.42, 0), (W * 0.42, H)], fill=(255, 255, 255), width=1)
    alt = o[2] - hsample(np.array(o[0]), np.array(o[1]))
    dr.text((6, 6), f"s={s:.2f} alt={float(alt):.1f}m fov={fv:.0f} roll={rl:.1f}", fill=(255, 255, 255))
    return im


if __name__ == "__main__":
    ss_list = [float(v) for v in (sys.argv[1] if len(sys.argv) > 1 else "0,0.5,1").split(",")]
    frames = []
    for s in ss_list:
        im = render(s)
        im.save(OUT / f"frame-{s:.2f}.png")
        frames.append(im)
        print("frame", s, flush=True)
    cols = min(4, len(frames))
    rows = math.ceil(len(frames) / cols)
    sheet = Image.new("RGB", (cols * W, rows * H))
    for k, im in enumerate(frames):
        sheet.paste(im, ((k % cols) * W, (k // cols) * H))
    sheet.save(OUT / "frames.png")
    print("saved", OUT / "frames.png")
