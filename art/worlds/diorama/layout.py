"""Shared layout for the homepage diorama.

Blender coordinates: meters, Z up, island centred near the origin, pond at
roughly (0.15, 0.05). three.js conversion is (x, z, -y).
Keep src/worlds/scenes/diorama/layout.ts in sync with PLOTS / POND / TABLE.
"""

from mathutils import Vector

from look import lin

S_MAX = 2.2
PAD_H = 0.07
PAD_R = 0.52
POND = {"cx": 0.16, "cy": 0.04, "rx": 1.62, "ry": 1.28, "z": 0.055}
TABLE_R = 8.7
TABLE_H = 0.2

# Journey order around the pond, then three satellite islets.
# id, x, y, yaw_deg, placeholder kind, palette hex (day, night, glow)
PLOTS = [
    ("garden", 2.58, -3.88, 18.0, "star", "#ffcf4d", "#ffd76f", "#ffe9a0"),
    ("doors", 3.88, -1.12, -14.0, "arch", "#9dbcff", "#a3b6ff", "#ffe08f"),
    ("museum", 3.52, 1.78, -26.0, "frame", "#f4c552", "#ffd66e", "#fff1c2"),
    ("bubbles", 1.22, 3.58, 10.0, "sphere", "#ff9cc2", "#ffa6d0", "#ffd0ea"),
    ("greenhouse", -1.78, 3.38, 24.0, "glass", "#8fd08a", "#9ae8a4", "#c8ffc4"),
    ("dna", -3.58, 1.42, -12.0, "helix", "#5cc3d2", "#6dffab", "#7f97ff"),
    ("pinball", -3.48, -1.58, 38.0, "table", "#ff5c9d", "#ff4fa0", "#3edcff"),
    ("snowglobe", -1.12, -3.68, 6.0, "globe", "#a9dcff", "#86e8cc", "#cbb2ff"),
    ("everest", 0.38, 6.48, 0.0, "peak", "#f4c552", "#ffd66e", "#8dbcff"),
    ("dunes", -6.18, -3.78, 42.0, "cone", "#ffb85f", "#ffdca8", "#ff8a66"),
    ("planes", 6.38, -2.32, -18.0, "plane", "#ffa684", "#ffd07e", "#bea3ff"),
]

PATH = [
    (2.58, -3.88),
    (3.28, -2.48),
    (3.88, -1.12),
    (3.72, 0.32),
    (3.52, 1.78),
    (2.42, 2.82),
    (1.22, 3.58),
    (-0.22, 3.52),
    (-1.78, 3.38),
    (-2.72, 2.42),
    (-3.58, 1.42),
    (-3.62, -0.08),
    (-3.48, -1.58),
    (-2.28, -2.72),
    (-1.12, -3.68),
    (0.62, -3.92),
    (2.58, -3.88),
]

SPURS = [
    ((1.22, 3.58), (0.38, 6.48)),
    ((-3.48, -1.58), (-6.18, -3.78)),
    ((2.58, -3.88), (6.38, -2.32)),
]


def plot_map():
    return {p[0]: p for p in PLOTS}


def plot_xy(pid):
    p = plot_map()[pid]
    return Vector((p[1], p[2], 0.0))


def to_three(v):
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


def palette(pid, variant):
    p = plot_map()[pid]
    return lin(p[5] if variant == "day" else p[6]), lin(p[7])
