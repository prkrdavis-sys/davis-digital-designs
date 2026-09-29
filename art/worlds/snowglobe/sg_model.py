"""Snow globe layout, shared by the Blender build and (via snowglobe.json) the runtime.

Units: 1 = the globe's outer radius (about 7.5 cm on a real desk). Blender
coordinates, Z up; the desk top is z = 0 and the camera looks from -Y.
"""

import json
import math
import random

GLOBE_C = (0.0, 0.0, 1.2)
R_OUT = 1.0
R_IN = 0.975
BASE_TOP = 0.6
VILLAGE_R = 0.775
S_MAX = 4.2

POND = {"c": (-0.33, -0.19), "rx": 0.2, "ry": 0.15}
CABIN = {"p": (0.4, 0.14), "face": (-0.8, -0.5)}
CINEMA = {"p": (-0.3, 0.44), "face": (0.35, -1.0)}
BILLBOARD = {"p": (0.15, 0.52), "face": (-0.15, -1.0), "w": 0.26}
SIGN = {"p": (0.47, -0.33), "face": (-0.45, -1.0), "w": 0.2}
XMAS_TREE = {"p": (-0.12, 0.12), "h": 0.34}
COTTAGES = [
    {"p": (-0.55, 0.1), "face": (1.0, -0.35), "wall": "#9fc7c9", "trim": "#f4efe6", "roof": "#3b4a5a"},
    {"p": (0.55, 0.36), "face": (-1.0, -0.6), "wall": "#e8b9a0", "trim": "#fff6ea", "roof": "#6b2f2c"},
    {"p": (-0.02, 0.66), "face": (0.0, -1.0), "wall": "#f1d58a", "trim": "#fff8e8", "roof": "#35503f"},
]
FILM_SET = {"p": (-0.06, -0.14), "face": (-0.8, -0.2)}
SNOWMAN = {"p": (-0.08, -0.5)}
PATH = [(0.16, -0.8), (0.14, -0.56), (0.05, -0.34), (0.1, -0.14), (0.18, 0.0), (0.26, 0.05)]
PATH_B = [(0.1, -0.14), (0.05, 0.1), (-0.05, 0.3), (-0.2, 0.36)]

# Emissive materials: name -> (hex color, day strength, night strength). The
# runtime multiplies each glTF emissive by the variant's strength.
GLOW = {
    "glow_window": ("#ffb866", 0.6, 5.0),
    "glow_lobby": ("#ffc98f", 0.8, 5.0),
    "glow_lamp": ("#ffd79a", 0.9, 9.0),
    "glow_bulb": ("#ffd27a", 2.0, 11.0),
    "glow_red": ("#ff3b3b", 2.0, 9.0),
    "glow_green": ("#47ff7a", 2.0, 9.0),
    "glow_blue": ("#4f8bff", 2.0, 9.0),
    "glow_star": ("#ffd66b", 3.0, 14.0),
    "glow_ring": ("#f4f7ff", 3.0, 7.0),
    "glow_fairy": ("#ffcf7a", 1.5, 9.0),
}

# Covers of the Create projects, shown on the village screens.
COVERS = {
    "screen_billboard": "/work/vibecheck-series/cover.png",
    "screen_marquee": "/work/code-academy-content/cover.png",
    "screen_sign": "/work/code-academy-content/cover.png",
    "screen_poster": "/work/vibecheck-series/cover.png",
    "screen_poster_b": "/work/vibecheck-series/cover.png",
}

SKATERS = [
    # radius scale, angular speed (rad/s), phase, coat
    (0.72, 0.55, 0.0, "#d83b3b"),
    (0.5, -0.42, 2.1, "#2aa89a"),
    (0.84, 0.35, 4.0, "#f0b43c"),
    (0.62, 0.48, 3.1, "#5b6cff"),
    (0.3, -0.6, 0.7, "#f2f2f2"),
]


# Camera rail: (s, camera position, subject, shift, vertical fov, roll).
# `shift` slides the aim left of the subject so it sits right of centre,
# clear of the page's text column. Chapters: intro [0,1) on the desk and
# through the glass, work [1,2) down into the village, interlude [2,3) by
# the pond and up into the dome, outro [3,4.2] back out to the desk.
KEYS = [
    (0.00, (-1.9, -7.6, 3.1), (0.2, 0.0, 1.05), 1.1, 30, 0),
    (0.30, (0.9, -6.3, 2.2), (0.1, 0.0, 1.1), 1.05, 30, -1),
    (0.58, (1.35, -4.0, 1.9), (0.0, 0.0, 1.12), 0.9, 32, 0),
    (0.78, (0.55, -2.35, 1.74), (0.0, 0.1, 0.95), 0.55, 36, 0),
    (0.90, (0.16, -1.24, 1.54), (0.0, 0.15, 0.85), 0.3, 40, 0),
    (1.00, (0.03, -0.78, 1.36), (0.0, 0.2, 0.78), 0.25, 42, 0),
    (1.25, (0.44, -0.6, 1.02), (0.3, 0.1, 0.76), 0.55, 42, 2),
    (1.55, (0.2, -0.4, 0.82), (0.34, 0.1, 0.73), 0.7, 40, 0),
    (1.80, (0.12, -0.12, 0.84), (0.15, 0.52, 0.8), 0.5, 40, 0),
    (2.00, (0.08, 0.1, 0.82), (0.15, 0.52, 0.8), 0.45, 42, 0),
    (2.25, (0.14, -0.08, 0.86), (-0.32, -0.18, 0.71), 0.5, 40, 0),
    (2.50, (0.08, -0.42, 0.81), (-0.33, -0.17, 0.71), 0.6, 42, 0),
    (2.72, (0.1, -0.45, 0.79), (-0.05, 0.15, 1.5), 0.3, 50, 0),
    (2.95, (0.0, -0.22, 1.35), (0.0, 0.05, 0.7), 0.3, 44, 0),
    (3.15, (0.05, -0.62, 1.62), (0.0, 0.05, 0.9), 0.25, 42, 0),
    (3.35, (0.25, -1.35, 1.85), (0.0, 0.0, 1.1), 0.4, 38, 0),
    (3.65, (2.0, -3.8, 2.0), (0.0, 0.0, 1.15), 0.8, 32, 0),
    (4.00, (3.7, -5.9, 2.0), (0.0, 0.0, 1.1), 1.0, 30, 1),
    (4.20, (4.0, -6.4, 2.05), (0.0, 0.0, 1.1), 1.02, 30, 1),
]

# Snow globe "shake": 0 settled, 1 fully swirled. Keyed in chapter time.
SHAKE = [(0.0, 0.15), (0.85, 0.35), (1.1, 0.2), (2.9, 0.2), (3.15, 0.9), (3.45, 1.0), (3.9, 0.55), (4.2, 0.45)]


def track(keys, s):
    if s <= keys[0][0]:
        return keys[0][1]
    for (s0, v0), (s1, v1) in zip(keys, keys[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0)
            t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return keys[-1][1]


def camera_ground_path():
    """XY points where the rail runs low through the village (trees keep clear)."""
    pts = []
    for (s0, p0, *_), (s1, p1, *_) in zip(KEYS, KEYS[1:]):
        for j in range(10):
            t = j / 10
            x, y, z = (p0[i] + (p1[i] - p0[i]) * t for i in range(3))
            if math.hypot(x, y) < VILLAGE_R and z < 1.2:
                pts.append((x, y))
    return pts


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def pond_mask(x, y):
    """1 inside the pond, 0 outside, soft rim."""
    dx = (x - POND["c"][0]) / POND["rx"]
    dy = (y - POND["c"][1]) / POND["ry"]
    d = math.sqrt(dx * dx + dy * dy)
    return 1.0 - _smooth(0.92, 1.25, d)


def base_ground(x, y):
    r = math.hypot(x, y)
    dome = max(0.0, 1.0 - (r / 0.8) ** 2)
    h = BASE_TOP + 0.006 + 0.085 * dome ** 1.25
    # Soft drifts, bigger toward the rim where snow piles against the glass.
    h += 0.008 * math.sin(x * 11.0 + 1.3) * math.cos(y * 9.0 - 0.4) + 0.006 * math.sin(x * 23.0 - y * 17.0)
    h += 0.03 * _smooth(0.55, 0.78, r)
    return h


POND_Z = base_ground(*POND["c"]) - 0.012


def ground(x, y):
    m = pond_mask(x, y)
    return base_ground(x, y) * (1 - m) + (POND_Z - 0.004) * m


def path_points(pts, step=0.01):
    """Catmull-Rom resample of a 2D polyline."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        seg = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        k = max(2, int(seg / step))
        for j in range(k):
            t = j / k
            t2, t3 = t * t, t * t * t
            out.append(
                tuple(
                    0.5 * ((2 * p1[c]) + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)
                    for c in (0, 1)
                )
            )
    out.append(pts[-1])
    return out


def dist_to_path(x, y, pts):
    return min(math.hypot(x - px, y - py) for px, py in pts)


def tree_spots(seed=7):
    """Scatter pines around the rim and in clusters, avoiding buildings, pond and paths."""
    rng = random.Random(seed)
    path = path_points(PATH, 0.02) + path_points(PATH_B, 0.02)
    cam = camera_ground_path()
    keep_out = [
        (CABIN["p"], 0.17),
        *[(c["p"], 0.14) for c in COTTAGES],
        (FILM_SET["p"], 0.08),
        (CINEMA["p"], 0.2),
        (BILLBOARD["p"], 0.15),
        (SIGN["p"], 0.09),
        (XMAS_TREE["p"], 0.12),
        (SNOWMAN["p"], 0.07),
        (POND["c"], 0.24),
    ]
    spots = []
    tries = 0
    while len(spots) < 64 and tries < 8000:
        tries += 1
        r = 0.34 + 0.42 * math.sqrt(rng.random())
        a = rng.random() * math.tau
        x, y = r * math.cos(a), r * math.sin(a)
        if math.hypot(x, y) > VILLAGE_R - 0.05:
            continue
        # Keep the front of the globe (toward the camera) more open.
        if y < -0.45 and abs(x) < 0.32:
            continue
        if any(math.hypot(x - p[0], y - p[1]) < rad for p, rad in keep_out):
            continue
        if dist_to_path(x, y, path) < 0.06:
            continue
        if cam and dist_to_path(x, y, cam) < 0.09:
            continue
        if any(math.hypot(x - sx, y - sy) < 0.048 for sx, sy, _ in spots):
            continue
        h = 0.07 + 0.17 * rng.random() ** 1.4 * (0.6 + 0.4 * r / VILLAGE_R)
        spots.append((x, y, h))
    return spots


def lamp_spots():
    pts = path_points(PATH, 0.01)
    out = []
    for i in range(6, len(pts) - 2, 17):
        x, y = pts[i]
        nx, ny = pts[i + 1][0] - x, pts[i + 1][1] - y
        L = math.hypot(nx, ny) or 1
        side = 1 if (i // 17) % 2 == 0 else -1
        out.append((x - ny / L * 0.04 * side, y + nx / L * 0.04 * side))
    return out


def skater_pose(k, t):
    """Position (x, y), heading (rad) of skater k at time t seconds."""
    rs, w, ph, _ = SKATERS[k]
    a = ph + w * t
    x = POND["c"][0] + math.cos(a) * POND["rx"] * rs * 0.8
    y = POND["c"][1] + math.sin(a) * POND["ry"] * rs * 0.8
    heading = a + (math.pi / 2 if w > 0 else -math.pi / 2)
    return x, y, heading


def to_three(v):
    return (round(v[0], 5), round(v[2], 5), round(-v[1], 5))


def export_meta(path):
    meta = {
        "globe": {"center": to_three(GLOBE_C), "rOut": R_OUT, "rIn": R_IN, "baseTop": BASE_TOP, "villageR": VILLAGE_R},
        "pond": {"center": to_three((POND["c"][0], POND["c"][1], POND_Z)), "rx": POND["rx"], "ry": POND["ry"]},
        "skaters": [{"r": s[0], "w": s[1], "phase": s[2]} for s in SKATERS],
        "glow": {k: {"color": v[0], "day": v[1], "night": v[2]} for k, v in GLOW.items()},
        "covers": COVERS,
        "sMax": S_MAX,
        "shake": [[s, v] for s, v in SHAKE],
        "focus": [[k[0], *to_three(k[2])] for k in KEYS],
    }
    path.write_text(json.dumps(meta, indent=1))
