"""The golden dunes: terrain, monolith layout and the camera flight, in pure numpy.

Shared by build.py (Blender) and the quick previews (plain python3). Units are
meters, Blender axes (Z up). Wind blows toward +X; the linear (seif) ridges run
roughly along Y with their slip faces on the east side. The sun sets in the
west, so each corridor floor is split by the long shadow of its western ridge
and the east ridge's stoss slope glows.
"""

import json
import math
import pathlib

import numpy as np

# ---------------------------------------------------------------------------
# Terrain extents. CORE is the dense, light-baked square; FAR reaches the horizon.
CORE_X0, CORE_Y0, CORE_SIZE = -1500.0, -1700.0, 3000.0
CORE_RES = 1501  # vertices per side (2 m spacing)
FAR_EXTENT = 14000.0
FIELD_RES = 512  # runtime height field (particles, camera helpers)

RIDGE_SPACING = 440.0
RIDGE_OFFSET = 220.0  # crest of ridge k sits near x = k * SPACING + OFFSET
SUN_AZIMUTH = -100.0  # degrees from +Y toward +X (negative = west)
SUN_ELEVATION = 8.0  # light direction; the painted sky sits a little lower for color
SKY_ELEVATION = 3.5
S_MAX = 4.2


def sun_dir():
    az, el = math.radians(SUN_AZIMUTH), math.radians(SUN_ELEVATION)
    return np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])


# ---------------------------------------------------------------------------
# Gradient noise (vectorized Perlin), deterministic.
_rng = np.random.default_rng(7)
_PERM = np.concatenate([_rng.permutation(256)] * 2).astype(np.int32)
_ANG = _rng.uniform(0, 2 * np.pi, 256)
_GX, _GY = np.cos(_ANG), np.sin(_ANG)


def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def noise(x, y):
    """Perlin noise in roughly [-0.7, 0.7]."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf, yf = x - xi, y - yi
    xi &= 255
    yi &= 255

    def g(ix, iy, dx, dy):
        h = _PERM[_PERM[ix] + iy]
        return _GX[h] * dx + _GY[h] * dy

    n00 = g(xi, yi, xf, yf)
    n10 = g(xi + 1, yi, xf - 1, yf)
    n01 = g(xi, yi + 1, xf, yf - 1)
    n11 = g(xi + 1, yi + 1, xf - 1, yf - 1)
    u, v = _fade(xf), _fade(yf)
    return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v


def fbm(x, y, octaves=4, lac=2.03, gain=0.5):
    v = np.zeros(np.broadcast(x, y).shape)
    a, f = 1.0, 1.0
    for i in range(octaves):
        v += a * noise(x * f + i * 17.3, y * f - i * 9.1)
        a *= gain
        f *= lac
    return v


def smax(a, b, k):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0, 1)
    return a * h + b * (1 - h) + k * h * (1 - h)


def _ridge_crest(k, y):
    return k * RIDGE_SPACING + RIDGE_OFFSET + 34.0 * np.sin(y / 230.0 + 0.9 * k) + 13.0 * np.sin(y / 101.0 + 2.3 * k) + 6.0 * noise(y / 60.0, k * 3.1)


def cx(k, off, y):
    """x of a point `off` meters east of ridge k's crest at this y (corridor-relative placement)."""
    return float(_ridge_crest(k, np.array(float(y)))) + off


# ---------------------------------------------------------------------------
# Monoliths, placed relative to the ridge crests so they sit on the lit corridor floors.
# yaw: the panel face points along (cos(yaw), sin(yaw)); 180 = facing west (toward the sun).
ROW_X = None


def _slab(mid, k, off, y, yaw, h, w, kind, lean, product):
    return {"id": mid, "p": (round(cx(k, off, y), 2), float(y)), "yaw": yaw, "h": h, "w": w, "kind": kind, "lean": lean, "product": product}


def _row():
    x = cx(1, -112, 480)
    kinds = ["glass", "metal", "stone", "glass", "metal"]
    return [{"id": f"m{6 + i}", "p": (round(x + i * 1.5, 2), 360.0 + i * 58.0), "yaw": 196.0, "h": 20.0, "w": 7.0, "kind": kinds[i], "lean": 0.0, "product": i} for i in range(5)]


MONOLITHS = [
    # corridor A (intro), standing on the lit stoss slope of ridge -1
    _slab("m1", -1, -118, -1060, 200.0, 21.0, 7.2, "glass", 0.0, 0),
    _slab("m2", -1, -108, -820, 188.0, 18.0, 6.6, "stone", 4.5, 1),
    # corridor B (work), ridge 0
    _slab("m3", 0, -112, -400, 205.0, 22.0, 7.6, "metal", 0.0, 2),
    _slab("m4", 0, -125, -170, 192.0, 19.0, 7.0, "glass", -3.0, 3),
    _slab("m5", 0, -105, 40, 210.0, 21.0, 7.2, "stone", 0.0, 4),
    # corridor C (faq): a row of five, one per product, ridge 1
    *_row(),
]
THICKNESS = 1.5
SINK = 2.8  # meters of the slab below the local sand level


def _ridge_height(k, y):
    peaks = np.maximum(0.0, np.sin(y / 125.0 + 2.1 * k + 0.8 * np.sin(y / 300.0))) ** 3
    return 32.0 + 8.0 * np.sin(y / 340.0 + 1.3 * k) + 5.0 * noise(y / 150.0 + 11.0, k * 5.7) + 11.0 * peaks


def seif(x, y):
    """Linear ridges: long gentle stoss slope to the west, sharp brink, steep slip face east."""
    h = np.full(np.broadcast(x, y).shape, -50.0)
    kmin = int(math.floor((np.min(x) - RIDGE_OFFSET) / RIDGE_SPACING)) - 1
    kmax = int(math.ceil((np.max(x) - RIDGE_OFFSET) / RIDGE_SPACING)) + 1
    for k in range(kmin, kmax + 1):
        c = _ridge_crest(k, y)
        H = _ridge_height(k, y)
        d = x - c
        lw = 165.0 + 22.0 * noise(y / 200.0, k * 1.7)
        t = np.clip(-d / lw, 0, 1)
        stoss = H * (1 - t) ** 1.45
        ls = H * 1.6
        e = d / ls
        slip = np.where(e < 0.82, H * (1 - e), H * 0.18 * np.exp(-np.clip(e - 0.82, 0, 30) * 5.0))
        r = np.where(d < 0, stoss, slip)
        h = np.maximum(h, r)
    return h


BARCHANS = None


def _barchans():
    """Crescent dunes scattered over the corridor floors (deterministic)."""
    global BARCHANS
    if BARCHANS is not None:
        return BARCHANS
    rng = np.random.default_rng(21)
    ks = [k[0] for k in FLIGHT]
    path = catmull([(k[1], k[2]) for k in FLIGHT], ks, np.arange(0, 3.2, 0.01))
    out = []
    for k in range(-8, 9):
        for j in range(-10, 11):
            x = k * RIDGE_SPACING + RIDGE_OFFSET + rng.uniform(80, 250)
            y = j * 150.0 + rng.uniform(-60, 60)
            if any(math.hypot(x - m["p"][0], y - m["p"][1]) < 45 for m in MONOLITHS):
                continue
            if np.min(np.hypot(path[:, 0] - x, path[:, 1] - y)) < 28:
                continue
            H = rng.uniform(3.0, 7.5)
            out.append((x, y, H, H * rng.uniform(6.5, 9.0), rng.uniform(-18, 18)))
    BARCHANS = out
    return out


def barchan_field(x, y):
    h = np.zeros(np.broadcast(x, y).shape)
    for bx, by, H, W, rot in _barchans():
        if np.max(x) < bx - W * 4 or np.min(x) > bx + W * 4 or np.max(y) < by - W * 3 or np.min(y) > by + W * 3:
            continue
        a = math.radians(rot)
        u = (x - bx) * math.cos(a) + (y - by) * math.sin(a)
        v = -(x - bx) * math.sin(a) + (y - by) * math.cos(a)
        q = np.clip(v / W, -1.2, 1.2)
        env = np.clip(1 - q * q, 0, 1) ** 0.8
        hv = H * env
        uc = 0.9 * W * q * q
        d = u - uc
        lst = np.maximum(hv, 0.1) * 5.5 + 4
        stoss = hv * np.clip(1 + d / lst, 0, 1) ** 1.4
        slip = hv * np.clip(1 - d / (np.maximum(hv, 0.1) * 1.7), 0, 1)
        h = np.maximum(h, np.where(d < 0, stoss, slip))
    return h


def monolith_frame(m):
    yaw = math.radians(m["yaw"])
    n = np.array([math.cos(yaw), math.sin(yaw)])
    t = np.array([-n[1], n[0]])
    return n, t


def drifts(x, y):
    """Sand banked against each slab: a windward ramp, a scour moat, a long lee tail."""
    h = np.zeros(np.broadcast(x, y).shape)
    for m in MONOLITHS:
        mx, my = m["p"]
        if np.max(x) < mx - 80 or np.min(x) > mx + 80 or np.max(y) < my - 60 or np.min(y) > my + 60:
            continue
        dx, dy = x - mx, y - my
        w = m["w"] * 0.5 + 1.5
        # wind is +X: windward is -X, lee is +X
        ramp = 1.15 * np.exp(-(((dx + 3.5) / 5.0) ** 2) - (dy / (w + 4.0)) ** 2)
        tail = 1.0 * np.exp(-(((dx - 18.0) / 17.0) ** 2) - (dy / (w * 0.75)) ** 2)
        r = np.hypot(dx / (w + 1.0), dy / (w + 1.0))
        moat = -0.45 * np.exp(-((r - 1.05) / 0.4) ** 2)
        h += ramp + tail + moat
    return h


def height(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    base = 3.0 * fbm(x / 260.0, y / 260.0, 4) + 1.2 * fbm(x / 70.0 + 5.0, y / 70.0, 3)
    ridges = seif(x, y)
    # small crescentic ridges riding the stoss slopes
    sup = 1.0 - np.abs(noise(x / 34.0 + 0.4 * noise(x / 90.0, y / 90.0), y / 55.0))
    sup = sup**3 * 2.4 * np.clip(ridges / 10.0, 0, 1)
    floor = barchan_field(x, y)
    h = smax(ridges + sup, floor, 2.5) + base
    return h + drifts(x, y)


def ground_at(px, py):
    """Local sand level around a slab (ignores its own drift), for sinking the base."""
    ang = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    xs = px + 3.0 * np.cos(ang)
    ys = py + 3.0 * np.sin(ang)
    base = 3.0 * fbm(xs / 260.0, ys / 260.0, 4) + 1.2 * fbm(xs / 70.0 + 5.0, ys / 70.0, 3)
    h = smax(seif(xs, ys), barchan_field(xs, ys), 2.5) + base
    return float(np.mean(h))


def core_grid(res=CORE_RES):
    xs = np.linspace(CORE_X0, CORE_X0 + CORE_SIZE, res)
    ys = np.linspace(CORE_Y0, CORE_Y0 + CORE_SIZE, res)
    X, Y = np.meshgrid(xs, ys)
    H = np.zeros_like(X)
    step = 128
    for i in range(0, res, step):
        H[i : i + step] = height(X[i : i + step], Y[i : i + step])
    return xs, ys, H


def far_axis(n_in=40, n_out=110):
    """Grid coordinates for the horizon skirt: coarse inside the core, geometric outside."""
    half = CORE_SIZE / 2
    inner = np.linspace(-half, half, n_in)
    ratio = (FAR_EXTENT / half) ** (1.0 / n_out)
    outer = half * ratio ** np.arange(1, n_out + 1)
    return np.concatenate([-outer[::-1], inner, outer])


# ---------------------------------------------------------------------------
# Camera flight. Hand keys in chapter time s: (s, x, y, clearance or absolute z, look target, fov).
# Look targets are (x, y, z_above_ground) or a monolith id with offsets.
def _m(mid):
    return next(m for m in MONOLITHS if m["id"] == mid)


def _key(s, k, off, y, clear, look, fov):
    lk = (cx(look[0], look[1], look[2]), look[2], look[3]) if len(look) == 4 else look
    return (s, cx(k, off, y), float(y), clear, lk, fov)


_ROW_X = MONOLITHS[5]["p"][0]


def _far(x, y, az, dist, z):
    a = math.radians(az)
    return (x + math.sin(a) * dist, y + math.cos(a) * dist, z)


FLIGHT = [
    # s, ridge k, offset east of crest, y, clearance, look (k, off, y, z above ground) or (x, y, z), fov
    # intro: corridor A, the lit stoss slope of ridge -1 on the right
    _key(0.00, -1, -162, -1150, 7.0, (-1, -130, -1058, 10.0), 44),
    _key(0.15, -1, -150, -1112, 7.0, (-1, -128, -1045, 9.0), 45),
    _key(0.30, -1, -136, -1072, 7.0, (-1, -142, -960, 6.0), 47),
    _key(0.45, -1, -140, -980, 7.0, (-1, -120, -840, 9.0), 47),
    _key(0.62, -1, -124, -862, 6.5, (-1, -114, -800, 10.0), 46),
    _key(0.75, -1, -118, -790, 7.0, (-1, -20, -680, 20.0), 48),
    # climb the stoss slope, over the brink into corridor B
    _key(0.88, -1, -60, -720, 8.0, (-1, 40, -620, 8.0), 50),
    _key(1.00, -1, 0, -670, 10.0, (0, -150, -540, 3.0), 52),
    _key(1.10, -1, 50, -620, 9.0, (0, -120, -460, 8.0), 50),
    # work: skim three slabs
    _key(1.25, 0, -170, -530, 7.0, (0, -125, -410, 12.0), 48),
    _key(1.38, 0, -128, -440, 6.5, (0, -150, -300, 6.0), 47),
    _key(1.52, 0, -142, -330, 7.0, (0, -128, -180, 10.0), 47),
    _key(1.66, 0, -140, -195, 6.5, (0, -115, -40, 8.0), 47),
    _key(1.80, 0, -122, -60, 7.0, (0, -110, 40, 10.0), 47),
    _key(1.90, 0, -120, 15, 6.5, (0, -20, 150, 20.0), 48),
    # over ridge 0 into corridor C
    _key(2.02, 0, -60, 110, 8.0, (0, 40, 220, 8.0), 50),
    _key(2.12, 0, 0, 180, 10.0, (1, -130, 330, 4.0), 52),
    _key(2.25, 0, 60, 250, 9.0, (_ROW_X - 8, 360.0, 10.0), 50),
    # faq: glide along the row
    (2.40, _ROW_X - 24, 310.0, 7.0, (_ROW_X, 420.0, 10.0), 46),
    (2.60, _ROW_X - 22, 390.0, 7.0, (_ROW_X, 480.0, 10.0), 44),
    (2.80, _ROW_X - 21, 460.0, 7.0, (_ROW_X, 540.0, 10.0), 44),
    (3.00, _ROW_X - 20, 530.0, 7.5, (_ROW_X, 610.0, 11.0), 44),
    # outro: climb and turn toward the sunset
    (3.20, _ROW_X - 30, 600.0, 18.0, (_ROW_X - 80, 720.0, 12.0), 46),
    (3.45, _ROW_X - 50, 660.0, 50.0, _far(_ROW_X - 50, 660.0, -80, 1200, 40.0), 48),
    (3.75, _ROW_X - 80, 700.0, 95.0, _far(_ROW_X - 80, 700.0, -106, 3000, 150.0), 46),
    (4.20, _ROW_X - 110, 720.0, 135.0, _far(_ROW_X - 110, 720.0, -112, 6000, 300.0), 42),
]


def catmull(points, ts, t):
    """Centripetal-ish Catmull-Rom through (ts, points) evaluated at t (vector)."""
    P = np.asarray(points, dtype=np.float64)
    T = np.asarray(ts, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)
    i = np.clip(np.searchsorted(T, t, side="right") - 1, 0, len(T) - 2)
    t0, t1 = T[i], T[i + 1]
    u = ((t - t0) / (t1 - t0))[:, None]
    p0 = P[np.maximum(i - 1, 0)]
    p1 = P[i]
    p2 = P[i + 1]
    p3 = P[np.minimum(i + 2, len(P) - 1)]
    # Tangents scaled for non-uniform spacing.
    tm1 = T[np.maximum(i - 1, 0)]
    tp2 = T[np.minimum(i + 2, len(T) - 1)]
    m1 = (p2 - p0) / np.maximum((t1 - tm1), 1e-6)[:, None] * (t1 - t0)[:, None]
    m2 = (p3 - p1) / np.maximum((tp2 - t0), 1e-6)[:, None] * (t1 - t0)[:, None]
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p1 + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2 + (u3 - u2) * m2


def gauss_smooth(v, sigma):
    if sigma <= 0:
        return v
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.concatenate([np.repeat(v[:1], r, axis=0), v, np.repeat(v[-1:], r, axis=0)])
    if v.ndim == 1:
        return np.convolve(pad, k, mode="valid")
    return np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(v.shape[1])], axis=1)


def flight(step=0.01):
    """Dense camera samples: pos (N,3), look (N,3), fov (N,), roll (N,) in Blender coords."""
    ss = np.arange(0, S_MAX + 1e-9, step)
    K = FLIGHT
    ks = [k[0] for k in K]
    xy = catmull([(k[1], k[2]) for k in K], ks, ss)
    clear = catmull([(k[3],) for k in K], ks, ss)[:, 0]
    fov = catmull([(k[5],) for k in K], ks, ss)[:, 0]
    look_xy = catmull([(k[4][0], k[4][1]) for k in K], ks, ss)
    look_z = catmull([(k[4][2],) for k in K], ks, ss)[:, 0]
    # Terrain under and just ahead of the camera: the drone holds its clearance over crests.
    ground = np.zeros(len(ss))
    for j, (ox, oy) in enumerate([(0, 0), (4, 0), (-4, 0), (0, 4), (0, -4), (3, 3), (-3, -3), (3, -3), (-3, 3)]):
        g = height(xy[:, 0] + ox, xy[:, 1] + oy)
        ground = g if j == 0 else np.maximum(ground, g)
    ahead = np.maximum.reduce([np.roll(ground, -k) for k in range(0, 6)])
    ahead[-6:] = ground[-6:]
    z = np.maximum(ground, ahead * 0.6 + ground * 0.4) + clear
    for _ in range(3):
        z = gauss_smooth(z, 3.0)
        z = np.maximum(z, ground + clear * 0.85)
    look_ground = height(look_xy[:, 0], look_xy[:, 1])
    look = np.column_stack([look_xy, gauss_smooth(look_ground, 4.0) + look_z])
    look = gauss_smooth(look, 2.0)
    pos = np.column_stack([xy, z])
    # Bank into turns: roll from lateral acceleration of the horizontal path.
    vel = np.gradient(xy, axis=0) / step
    acc = np.gradient(vel, axis=0) / step
    speed = np.linalg.norm(vel, axis=1) + 1e-6
    lat = (vel[:, 0] * acc[:, 1] - vel[:, 1] * acc[:, 0]) / speed
    # Positive roll about the camera's back axis lifts its right side: a left bank for a left turn.
    roll = np.clip(lat * 0.004, -12, 12)
    roll = gauss_smooth(roll, 6.0)
    return ss, pos, look, fov, roll


# ---------------------------------------------------------------------------
# Details: footprints to the row of slabs, bleached wood, boulders.
def footprints():
    """A walker's trail over the sand toward the fourth slab of the row."""
    rng = np.random.default_rng(5)
    target = np.array(_m("m9")["p"]) + np.array([-3.5, -1.0])
    start = target + np.array([-95.0, -60.0])
    pts = []
    n = 150
    for i in range(n):
        t = i / (n - 1)
        p = start + (target - start) * t
        side = np.array([-(target - start)[1], (target - start)[0]])
        side /= np.linalg.norm(side)
        p = p + side * (4.0 * math.sin(t * 5.1) + 1.5 * math.sin(t * 13.0))
        pts.append(p)
    pts = np.array(pts)
    out = []
    d_total = 0.0
    step = 0.72
    i = 0
    seg = 0
    pos = pts[0].copy()
    while seg < len(pts) - 1:
        a, b = pts[seg], pts[seg + 1]
        L = np.linalg.norm(b - a)
        d_total += 0.0
        # march along the polyline
        while np.linalg.norm(b - pos) > step:
            dirv = (b - pos) / np.linalg.norm(b - pos)
            pos = pos + dirv * step
            side = np.array([-dirv[1], dirv[0]])
            foot = pos + side * (0.14 if i % 2 == 0 else -0.14) + rng.normal(0, 0.02, 2)
            yaw = math.degrees(math.atan2(dirv[1], dirv[0])) + rng.normal(0, 4)
            out.append((float(foot[0]), float(foot[1]), yaw, i % 2))
            i += 1
        seg += 1
        _ = L
    hs = height(np.array([f[0] for f in out]), np.array([f[1] for f in out]))
    return [{"p": [round(f[0], 3), round(f[1], 3), round(float(h), 3)], "yaw": round(f[2], 1), "side": f[3]} for f, h in zip(out, hs)]


def _near(mid, dx, dy):
    p = _m(mid)["p"]
    return p[0] + dx, p[1] + dy


PROPS = [
    # kind, x, y, yaw, scale, sink
    ("trunk", *_near("m1", -14.0, 60.0), 40.0, 1.3, 0.25),
    ("trunk", *_near("m3", -22.0, 70.0), 160.0, 1.1, 0.3),
    ("trunk", *_near("m7", -30.0, -20.0), 210.0, 1.0, 0.2),
    ("boulder", *_near("m1", 6.0, -16.0), 10.0, 1.6, 0.6),
    ("boulder", *_near("m2", 9.0, 12.0), 80.0, 1.2, 0.5),
    ("boulder", *_near("m4", -8.0, 40.0), 200.0, 2.2, 0.9),
    ("boulder", *_near("m6", 12.0, -30.0), 130.0, 1.8, 0.7),
    ("boulder", *_near("m10", 10.0, 45.0), 300.0, 2.6, 1.1),
]


def monolith_placements():
    out = []
    for m in MONOLITHS:
        g = ground_at(*m["p"])
        out.append({**m, "ground": round(g, 3), "base": round(g - SINK, 3), "thickness": THICKNESS})
    return out


def ridge_lines(step=24.0):
    """Crest polylines (x, y, z) for the blowing-sand plumes at runtime."""
    ys = np.arange(CORE_Y0, CORE_Y0 + CORE_SIZE + 1, step)
    out = []
    for k in range(-4, 4):
        xs = np.array([cx(k, 0.0, y) for y in ys])
        if xs.max() < CORE_X0 or xs.min() > CORE_X0 + CORE_SIZE:
            continue
        zs = height(xs, ys)
        out.append([[round(float(a), 2), round(float(b), 2), round(float(c), 2)] for a, b, c in zip(xs, ys, zs)])
    return out


def export_meta(path, extra=None):
    meta = {
        "ridges": ridge_lines(),
        "core": {"x0": CORE_X0, "y0": CORE_Y0, "size": CORE_SIZE},
        "sun": {"azimuth": SUN_AZIMUTH, "elevation": SUN_ELEVATION, "dir": [round(float(v), 5) for v in sun_dir()]},
        "monoliths": monolith_placements(),
        "footprints": footprints(),
        "props": [{"kind": k, "p": [x, y], "yaw": yaw, "scale": sc, "sink": sk} for k, x, y, yaw, sc, sk in PROPS],
        "sMax": S_MAX,
    }
    if extra:
        meta.update(extra)
    pathlib.Path(path).write_text(json.dumps(meta, separators=(",", ":")))
    return meta
