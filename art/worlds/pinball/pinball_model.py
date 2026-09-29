"""Inside the machine: pinball table layout, ball paths and camera rail.

Shared by the Blender build (build.py) and the runtime (through pinball.json).
Blender coordinates, Z up: the playfield top is z = 0, x runs across the table
(-3..3) and y runs up it (0 = flipper end, 12 = backbox). A real playfield is
~0.51 m wide, so one unit here is ~8.5 cm and the ball (27 mm) has radius 0.16.
three.js coordinates are (x, z, -y).
"""

import json
import math

import numpy as np

W = 3.0
L = 12.0
BALL_R = 0.16
WALL_H = 0.95
# Chapters: intro [0,1) flippers, work [1,2) ramp ride, interlude [2,3) corkscrew,
# outro [3,4] multiball crane. 4.0-4.2 margin; 4.4-4.7 is the parked backglass view.
S_MAX = 4.7

PALETTE = {
    "pink": "#ff5c9d",
    "cyan": "#3edcff",
    "yellow": "#ffd84a",
    "violet": "#9b6bff",
    "orange": "#ff8a3d",
    "green": "#5dffa8",
    "red": "#ff3b4e",
    "white": "#fff4e0",
    "ink": "#1a0b2e",
}


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def three(p):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return [round(float(p[0]), 4), round(float(p[2]), 4), round(float(-p[1]), 4)]


# --------------------------------------------------------------------------
# Layout
FLIPPERS = [
    # pivot, rest angle (deg from +x), flipped angle, length
    {"pivot": (-1.08, 1.42), "rest": -28.0, "up": 26.0, "length": 0.98, "rubber": "pink"},
    {"pivot": (1.08, 1.42), "rest": 208.0, "up": 154.0, "length": 0.98, "rubber": "cyan"},
]
FLIPPER_R = (0.14, 0.065)
FLIPPER_H = 0.16

BUMPER_R = 0.42
BUMPERS = [
    {"pos": (0.02, 8.5), "color": "pink"},
    {"pos": (1.4, 8.85), "color": "cyan"},
    {"pos": (0.7, 9.88), "color": "yellow"},
]

SLINGS = [
    [(-1.98, 3.55), (-1.98, 2.32), (-1.42, 1.98)],
    [(1.98, 3.55), (1.98, 2.32), (1.42, 1.98)],
]
INLANE_GUIDES = [
    [(-2.46, 3.45), (-2.46, 2.45), (-1.36, 1.74)],
    [(2.2, 3.45), (2.2, 2.45), (1.36, 1.74)],
]
PLUNGER_X = 2.73
PLUNGER_WALL = [(2.48, 0.95), (2.48, 8.3)]
ORBIT_C = (0.0, 9.0)
ORBIT_R = 2.97
LEFT_ORBIT_WALL_X = -2.42
TOP_LANE_X = [-0.5, 0.2, 0.9, 1.6]
TOP_LANE_Y = (10.32, 10.98)
DROP_TARGETS = [(-2.22, y) for y in (4.1, 4.5, 4.9, 5.3)]
SPINNER = (-2.7, 7.55)
SPINNER_W = 0.46
BACKBOX_Y = 12.25
BACKGLASS = {"center": (0.0, 12.2, 4.35), "size": (5.7, 4.1)}
DMD = {"center": (0.0, 12.2, 1.55), "size": (2.3, 0.62)}

# Inserts: (shape, x, y, rotation deg, size, color, group)
INSERTS = []


def _inserts():
    out = []
    for k, y in enumerate((4.15, 4.65, 5.15)):
        out.append(("arrow", -1.22, y, 0, 0.3 - k * 0.02, "cyan", "ramp"))
    for k, y in enumerate((5.4, 5.9, 6.4)):
        out.append(("arrow", -2.72, y, 0, 0.28, "pink", "orbit"))
    cols = ["pink", "orange", "yellow", "green", "cyan", "violet", "pink"]
    for k in range(7):
        a = math.radians(160 - k * 23.3)
        out.append(("circle", 0.1 + math.cos(a) * 1.05, 3.72 + math.sin(a) * 1.05, 0, 0.13, cols[k], "arc"))
    out.append(("triangle", 0.1, 4.28, 0, 0.5, "yellow", "jackpot"))
    out.append(("circle", 0.1, 3.72, 0, 0.17, "red", "arc"))
    out.append(("oval", 0.0, 1.74, 0, 0.26, "red", "shoot"))
    for x in (-2.72, -2.23, 1.98, 2.34):
        out.append(("circle", x, 2.95, 0, 0.1, "white", "lanes"))
    for x, y in DROP_TARGETS:
        out.append(("rect", x + 0.36, y, 0, 0.13, "yellow", "targets"))
    for k, x in enumerate((-0.15, 0.55, 1.25)):
        out.append(("star", x, 10.66, 0, 0.17, "yellow", "toplanes"))
        out.append(("arrow", x, 10.05, 0, 0.18, ["pink", "cyan", "yellow"][k], "toplanes"))
    for k, y in enumerate((6.1, 6.55, 7.0)):
        out.append(("chevron", 2.02, y, 0, 0.24, "yellow", "right"))
    for k, x in enumerate(np.linspace(-0.62, 1.52, 9)):
        out.append(("circle", float(x), 5.72, 0, 0.075, ["pink", "cyan", "yellow"][k % 3], "letters"))
    out.append(("diamond", -1.72, 3.05, 0, 0.16, "violet", "lanes"))
    out.append(("diamond", 1.72, 3.05, 0, 0.16, "violet", "lanes"))
    return out


INSERTS = _inserts()


def gi_lamps():
    """Warm GI bulbs along the walls, slingshots and top arc (x, y, z)."""
    pts = []
    for y in np.arange(1.6, 8.6, 1.35):
        pts.append((-2.9, float(y), 0.1))
        if y > 3.8:
            pts.append((2.38, float(y), 0.1))
    for a in np.linspace(15, 165, 7):
        r = math.radians(a)
        pts.append((ORBIT_C[0] + math.cos(r) * (ORBIT_R - 0.1), ORBIT_C[1] + math.sin(r) * (ORBIT_R - 0.1), 0.1))
    for side in (-1, 1):
        pts.append((side * 1.72, 2.55, 0.1))
        pts.append((side * 1.9, 3.3, 0.1))
    pts += [(-0.6, 9.3, 0.1), (1.9, 9.6, 0.1), (0.7, 8.25, 0.1)]
    return pts


# --------------------------------------------------------------------------
# Curves
def catmull(points, closed=False, per_unit=40, alpha=0.5):
    """Centripetal Catmull-Rom through `points` (N x 3), densely sampled."""
    P = [np.array(p, dtype=float) for p in points]
    if closed:
        P = [P[-1]] + P + [P[0], P[1]]
    else:
        P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(1e-4, np.linalg.norm(p1 - p0) ** alpha)
        t2 = t1 + max(1e-4, np.linalg.norm(p2 - p1) ** alpha)
        t3 = t2 + max(1e-4, np.linalg.norm(p3 - p2) ** alpha)
        n = max(4, int(np.linalg.norm(p2 - p1) * per_unit))
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    if not closed:
        out.append(P[-2])
    return np.array(out)


def resample(pts, step=0.04, closed=False):
    """Uniform arc-length resampling. Returns (points, arc lengths)."""
    pts = np.asarray(pts, dtype=float)
    if closed:
        pts = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    acc = np.concatenate([[0.0], np.cumsum(seg)])
    total = acc[-1]
    n = max(2, int(round(total / step)) + 1)
    us = np.linspace(0, total, n)
    out = np.stack([np.interp(us, acc, pts[:, k]) for k in range(3)], axis=1)
    if closed:
        out, us = out[:-1], us[:-1]
    return out, us


class Path:
    """Arc-length parameterized polyline with banked frames."""

    def __init__(self, pts, closed=False, bank=None, step=0.04):
        self.closed = closed
        self.p, self.u = resample(pts, step, closed)
        self.length = float(self.u[-1] + (np.linalg.norm(self.p[0] - self.p[-1]) if closed else 0.0))
        n = len(self.p)
        t = np.zeros_like(self.p)
        for i in range(n):
            a = self.p[(i - 1) % n] if closed or i > 0 else self.p[i]
            b = self.p[(i + 1) % n] if closed or i < n - 1 else self.p[i]
            d = b - a
            t[i] = d / max(1e-9, np.linalg.norm(d))
        self.t = t
        up = np.array([0.0, 0.0, 1.0])
        nrm = up - t * t[:, 2:3]
        nrm /= np.linalg.norm(nrm, axis=1)[:, None]
        right = np.cross(t, nrm)
        self.bank = np.zeros(n) if bank is None else np.array([bank(self, i) for i in range(n)])
        c, s = np.cos(self.bank)[:, None], np.sin(self.bank)[:, None]
        # Positive bank tilts the up vector toward the right (leaning into a right turn).
        self.n = nrm * c + right * s
        self.r = np.cross(t, self.n)

    def _idx(self, u):
        if self.closed:
            u = u % self.length
        else:
            u = min(max(u, 0.0), float(self.u[-1]))
        f = u / (self.length / len(self.p)) if self.closed else np.interp(u, self.u, np.arange(len(self.u)))
        i = int(math.floor(f))
        return i, f - i

    def _lerp(self, arr, u):
        i, k = self._idx(u)
        n = len(arr)
        j = (i + 1) % n if self.closed else min(i + 1, n - 1)
        i = i % n
        return arr[i] * (1 - k) + arr[j] * k

    def at(self, u):
        return self._lerp(self.p, u)

    def frame(self, u):
        t = self._lerp(self.t, u)
        n = self._lerp(self.n, u)
        t /= np.linalg.norm(t)
        n = n - t * (n @ t)
        n /= np.linalg.norm(n)
        return t, n, np.cross(t, n)


# --- The ramp: plastic ramp up the left, wireform over the top, down the right,
# into a two-turn corkscrew habitrail and out onto the right inlane.
RAMP_CP = [
    (-1.25, 5.62, 0.0),
    (-1.27, 6.3, 0.08),
    (-1.33, 7.35, 0.4),
    (-1.45, 8.5, 0.8),
    (-1.45, 9.5, 1.1),
    (-1.05, 10.45, 1.34),
    (-0.2, 11.05, 1.48),
    (0.85, 11.22, 1.54),
    (1.8, 10.82, 1.54),
    (2.3, 9.95, 1.5),
    (2.38, 8.8, 1.46),
    (2.33, 7.5, 1.42),
    (2.3, 6.2, 1.38),
    (2.3, 5.35, 1.35),
]
CORK_C = (1.75, 4.9)
CORK_R = 0.55
CORK_TURNS = 2.0
CORK_Z = (1.33, 0.44)
EXIT_CP = [(2.3, 4.9, CORK_Z[1]), (2.31, 4.2, 0.3), (2.27, 3.62, 0.13), (2.1, 3.22, 0.0)]
PLASTIC_UNTIL_Y = 8.55  # the ramp is a plastic channel below this y, wireform above


def cork_points():
    n = 220
    pts = []
    for k in range(n + 1):
        f = k / n
        th = -2 * math.pi * CORK_TURNS * f
        z = CORK_Z[0] + (CORK_Z[1] - CORK_Z[0]) * f
        pts.append((CORK_C[0] + CORK_R * math.cos(th), CORK_C[1] + CORK_R * math.sin(th), z))
    return np.array(pts)


def _ramp_bank(path, i):
    """Bank into turns: signed horizontal curvature, clamped; the corkscrew banks hard."""
    n = len(path.p)
    a, b = path.t[max(0, i - 6)], path.t[min(n - 1, i + 6)]
    ds = max(1e-6, path.u[min(n - 1, i + 6)] - path.u[max(0, i - 6)])
    turn = (a[0] * b[1] - a[1] * b[0]) / ds  # >0 = turning left
    return float(np.clip(-turn * 0.28, -0.75, 0.75))


def ramp_path():
    head = catmull(RAMP_CP, per_unit=60)
    cork = cork_points()
    tail = catmull(EXIT_CP, per_unit=60)
    pts = np.vstack([head[:-1], cork, tail[1:]])
    return Path(pts, bank=_ramp_bank, step=0.03)


def ramp_marks(path):
    """Arc lengths where the plastic ends, the corkscrew starts and ends."""
    p = path.p
    plastic_end = float(path.u[np.argmax(p[:, 1] > PLASTIC_UNTIL_Y)])
    d0 = np.linalg.norm(p - np.array([CORK_C[0] + CORK_R, CORK_C[1], CORK_Z[0]]), axis=1)
    cork_start = float(path.u[int(np.argmin(d0))])
    d1 = np.linalg.norm(p - np.array([CORK_C[0] + CORK_R, CORK_C[1], CORK_Z[1]]), axis=1)
    cork_end = float(path.u[int(np.argmin(d1))])
    top = float(path.u[int(np.argmax(p[:, 2]))])
    return {"plastic_end": plastic_end, "top": top, "cork_start": cork_start, "cork_end": cork_end, "end": float(path.u[-1])}


# --- Ball circuits (z = ball centre). Closed loops for multiball.
def _flat(pts, z=BALL_R):
    return [(x, y, z) for x, y in pts]


ORBIT_LOOP = _flat(
    [
        (-0.35, 1.05), (-1.4, 2.7), (-2.4, 4.6), (-2.7, 6.4), (-2.72, 8.6), (-2.2, 10.9), (-0.8, 11.78), (0.9, 11.75),
        (2.15, 10.9), (1.95, 9.55), (1.0, 8.3), (0.35, 6.2), (-0.1, 4.0), (0.4, 2.4), (0.6, 1.3),
    ]
)
BUMPER_LOOP = _flat([(0.72, 9.26), (-0.5, 9.0), (0.62, 8.05), (1.95, 9.3), (1.22, 10.4), (-0.18, 10.05), (0.45, 8.9), (1.25, 9.6)])
LAUNCH = _flat([(PLUNGER_X, 0.45), (PLUNGER_X, 4.0), (PLUNGER_X, 8.2), (2.62, 10.0), (1.9, 11.2), (0.5, 11.85), (-0.8, 11.78)])


def ramp_loop():
    """Right flipper -> up to the ramp flap -> the whole ramp -> inlane -> right flipper."""
    ramp = ramp_path()
    lead = catmull(_flat([(0.6, 1.3), (-0.4, 2.8), (-1.1, 4.4), (-1.25, 5.3)]) + [(-1.25, 5.62, BALL_R)], per_unit=40)
    body = ramp.p + ramp.n * BALL_R
    back = catmull(_flat([(2.1, 3.22), (1.95, 2.45), (1.45, 1.85), (0.95, 1.35), (0.6, 1.3)]), per_unit=40)
    return np.vstack([lead[:-1], body, back[1:-1]])


# --------------------------------------------------------------------------
# Camera rail
def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def pchip(xs, ys, x):
    """Monotone cubic interpolation (Fritsch-Carlson)."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h = np.diff(xs)
    d = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(xs) - 1):
        m[k] = 0.0 if d[k - 1] * d[k] <= 0 else 3 * (h[k - 1] + h[k]) / ((2 * h[k] + h[k - 1]) / d[k - 1] + (h[k] + 2 * h[k - 1]) / d[k])
    x = min(max(x, xs[0]), xs[-1])
    k = min(len(xs) - 2, int(np.searchsorted(xs, x, side="right") - 1))
    t = (x - xs[k]) / h[k]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    return float(h00 * ys[k] + h10 * h[k] * m[k] + h01 * ys[k + 1] + h11 * h[k] * m[k + 1])


RIDE = (1.0, 3.04)
BUMPER_FOCUS = (0.2, 9.0, 0.0)


def ride_u(s, marks):
    """Arc length along the ramp for chapter time s during the ride."""
    xs = [RIDE[0], 1.4, 1.72, 2.0, 2.78, RIDE[1]]
    ys = [0.0, marks["plastic_end"] * 0.92, marks["top"] + 1.2, marks["cork_start"], marks["cork_end"], marks["end"]]
    return pchip(xs, ys, s)


HAND_KEYS = [
    # s, pos, look, roll, fov
    (0.0, (0.02, 0.42, 0.36), (-0.95, 7.0, -0.2), -2.0, 54),
    (0.3, (-0.08, 1.7, 0.46), (-1.25, 7.5, -0.05), -1.0, 54),
    (0.6, (-0.5, 3.25, 0.5), (-1.7, 7.4, 0.12), 1.5, 55),
    (0.84, (-1.02, 4.62, 0.4), (-1.55, 7.3, 0.4), 0.5, 56),
    (3.26, (1.62, 1.72, 0.62), (-0.7, 1.35, 0.3), 6.0, 56),
    (3.5, (2.62, 0.35, 1.85), (-0.6, 4.4, 0.25), 2.0, 52),
    (3.8, (1.9, -2.15, 3.45), (-1.25, 7.1, 0.95), 0.0, 46),
    (4.2, (1.05, -3.6, 4.45), (-1.65, 8.2, 1.75), 0.0, 42),
    (4.45, (1.9, 6.35, 3.35), (-1.25, 12.2, 3.95), 0.0, 40),
    (4.7, (1.45, 6.75, 3.45), (-1.35, 12.2, 4.05), 0.0, 40),
]


def ride_pose(s, path, marks):
    u = ride_u(s, marks)
    t, n, r = path.frame(u)
    p = path.at(u)
    k_in = smooth((s - RIDE[0]) / 0.12)
    # Over the top of the ramp the camera cranes up a little and turns to the bumpers below.
    w = smooth((u - marks["top"] + 3.2) / 2.6) * (1 - smooth((u - marks["top"] - 0.8) / 3.0))
    height = 0.3 + 0.03 * math.sin(s * 9) + 0.22 * w
    pos = p + n * height - r * 0.04
    ahead = min(path.length - 0.01, u + 1.25)
    at, an, ar = path.frame(ahead)
    look = path.at(ahead) + an * (0.16 + 0.08 * k_in) - ar * 0.34
    look = look * (1 - w * 0.6) + np.array(BUMPER_FOCUS) * w * 0.6
    roll = math.degrees(path._lerp(path.bank, u)) * 0.8
    in_cork = smooth((u - marks["cork_start"] + 0.6) / 0.8) * (1 - smooth((u - marks["cork_end"]) / 0.6))
    fov = 56 + 6 * in_cork
    return pos, look, roll, fov


def camera_keys(step=0.01):
    """Dense camera samples: hand keys + the ramp ride, Catmull-Rom blended in s."""
    path = ramp_path()
    marks = ramp_marks(path)
    keys = []
    for s, pos, look, roll, fov in HAND_KEYS:
        keys.append((s, np.array(pos, float), np.array(look, float), roll, fov))
    s = RIDE[0]
    while s <= RIDE[1] + 1e-6:
        pos, look, roll, fov = ride_pose(s, path, marks)
        keys.append((s, pos, look, roll, fov))
        s += 0.02
    keys.sort(key=lambda k: k[0])
    tour = [k for k in keys if k[0] <= TOUR_END + 1e-6]
    parked = [k for k in keys if k[0] > TOUR_END + 1e-6]
    tour_eval = _key_interp(tour)
    parked_eval = _key_interp(parked)
    out = []
    n = int(round(S_MAX / step)) + 1
    for j in range(n):
        x = j * step
        if x <= TOUR_END:
            pos, look, roll, fov = tour_eval(x)
        elif x >= parked[0][0]:
            pos, look, roll, fov = parked_eval(x)
        else:
            k = smooth((x - TOUR_END) / (parked[0][0] - TOUR_END))
            a, b = tour_eval(TOUR_END), parked_eval(parked[0][0])
            pos, look, roll, fov = (a[i] * (1 - k) + b[i] * k for i in range(4))
        out.append({"s": round(x, 4), "pos": tuple(pos), "look": tuple(look), "roll": float(roll), "fov": float(fov)})
    return out


TOUR_END = 4.2


def _key_interp(keys):
    """Cubic Hermite (Catmull-Rom tangents) through keys, non-uniform in s."""
    xs = np.array([k[0] for k in keys])

    def interp(vals, x):
        if len(xs) == 1:
            return vals[0]
        i = int(np.clip(np.searchsorted(xs, x, side="right") - 1, 0, len(xs) - 2))
        i0, i3 = max(0, i - 1), min(len(xs) - 1, i + 2)
        x0, x1, x2, x3 = xs[i0], xs[i], xs[i + 1], xs[i3]
        v0, v1, v2, v3 = vals[i0], vals[i], vals[i + 1], vals[i3]
        t = (x - x1) / (x2 - x1)
        m1 = (v2 - v0) / max(1e-6, x2 - x0) * (x2 - x1)
        m2 = (v3 - v1) / max(1e-6, x3 - x1) * (x2 - x1)
        h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
        return h00 * v1 + h10 * m1 + h01 * v2 + h11 * m2

    P = np.array([k[1] for k in keys])
    Lk = np.array([k[2] for k in keys])
    R = np.array([k[3] for k in keys], float)
    F = np.array([k[4] for k in keys], float)
    return lambda x: (interp(P, x), interp(Lk, x), interp(R, x), interp(F, x))


# --------------------------------------------------------------------------
# Ball staging for stills (the runtime animates the same circuits live).
HERO_LEAD = 1.5


def hero_u(s, marks):
    return ride_u(s, marks) + HERO_LEAD


def launch_times():
    return [3.18, 3.36, 3.54, 3.72]


def still_balls(s):
    """Ball centres for a Cycles still at chapter time s."""
    ramp = ramp_path()
    marks = ramp_marks(ramp)
    balls = []
    if 0.7 <= s <= 3.0:
        u = hero_u(s, marks)
        if u < ramp.length:
            balls.append(ramp.at(u) + ramp.frame(u)[1] * BALL_R)
    orbit = Path(ORBIT_LOOP, closed=True)
    bump = Path(BUMPER_LOOP, closed=True)
    balls.append(bump.at(bump.length * ((s * 0.37 + 0.2) % 1)))
    if s < 1.0:
        balls.append(np.array([0.72, 2.2, BALL_R]))
    launched = [t for t in launch_times() if s >= t]
    for k, t in enumerate(launched):
        balls.append(orbit.at(orbit.length * ((0.12 + k * 0.23 + (s - t) * 0.4) % 1)))
    for k in range(len(launch_times()) - len(launched)):
        balls.append(np.array([PLUNGER_X, 0.3 - k * 0.34, BALL_R]))
    return balls


# --------------------------------------------------------------------------
def export_runtime(path_out):
    ramp = ramp_path()
    marks = ramp_marks(ramp)
    step = 0.01
    s0, s1 = 0.6, RIDE[1]
    cam_u = [round(ride_u(s0 + k * step, marks), 4) for k in range(int(round((s1 - s0) / step)) + 1)]
    ramp_pts = [c for p, n in zip(ramp.p, ramp.n) for c in three(p + n * BALL_R)]

    def flat(pts):
        return [c for p in pts for c in three(p)]

    orbit = Path(ORBIT_LOOP, closed=True, step=0.05)
    bump = Path(BUMPER_LOOP, closed=True, step=0.05)
    loop = Path(ramp_loop(), closed=True, step=0.04)
    launch = Path(catmull(LAUNCH, per_unit=40), step=0.05)
    meta = {
        "ballR": BALL_R,
        "sMax": S_MAX,
        "bumpers": [{"p": three((*b["pos"], 0.0)), "r": BUMPER_R, "color": PALETTE[b["color"]]} for b in BUMPERS],
        "flippers": [{"pivot": three((*f["pivot"], 0.0)), "rest": f["rest"], "up": f["up"]} for f in FLIPPERS],
        "spinner": {"p": three((SPINNER[0], SPINNER[1], 0.42)), "w": SPINNER_W},
        "targets": [three((x, y, 0.0)) for x, y in DROP_TARGETS],
        "backglass": {"center": three(BACKGLASS["center"]), "size": BACKGLASS["size"]},
        "dmd": {"center": three(DMD["center"]), "size": DMD["size"]},
        "ramp": {"points": ramp_pts, "length": ramp.length, "marks": marks},
        "camU": {"s0": s0, "step": step, "u": cam_u, "lead": HERO_LEAD},
        "loops": {
            "orbit": {"points": flat(orbit.p), "length": orbit.length},
            "bumpers": {"points": flat(bump.p), "length": bump.length},
            "ramp": {"points": flat(loop.p), "length": loop.length},
        },
        "launch": {"points": flat(launch.p), "length": launch.length, "times": launch_times(), "plungerX": PLUNGER_X},
        "plunger": three((PLUNGER_X, 0.3, BALL_R)),
    }
    path_out.write_text(json.dumps(meta, separators=(",", ":")))
    return meta


if __name__ == "__main__":
    import pathlib
    import sys

    r = ramp_path()
    print("ramp length", round(r.length, 2), ramp_marks(r))
    m = export_runtime(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pinball.json"))
    print("bank range", r.bank.min(), r.bank.max())
