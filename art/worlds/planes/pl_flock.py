"""Flock formation slots + the camera rail (three.js coordinates).

slots() uses mulberry32 so src/worlds/scenes/planes/sim.ts produces the
exact same formation; the Cycles stills place planes on these slots.
"""

import math

import numpy as np

from pl_common import WORLD

S_MAX = 3.2


def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]

    def rnd():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rnd


def slots():
    """Per plane: home offset from the anchor, print cell, tint seed, scale, phase."""
    fl = WORLD["flock"]
    ex, ey, ez = fl["extent"]
    rnd = mulberry32(1234)
    out = []
    for _ in range(fl["count"]):
        zf = rnd() * 2 - 1
        back = (zf + 1) / 2
        x = ex * (rnd() * 2 - 1) * (0.35 + 0.65 * back)
        y = ey * (rnd() * 2 - 1)
        out.append({
            "home": (x, y, ez * zf),
            "print": min(3, int(rnd() * 4)),
            "tint": rnd(),
            "scale": 0.85 + rnd() * 0.3,
            "phase": rnd() * math.tau,
        })
    return out


# --------------------------------------------------------------------------
# Camera rail. Keys: s, camera position, subject point, shift (fraction of the
# distance the aim moves left of the subject, so it sits right of centre), vertical fov, roll.
KEYS = [
    # intro: skim the cloud tops toward the sun, catching up with the flock
    (0.00, (-16.0, 4.6, 72.0), (3.0, 11.5, -12.0), 0.15, 44, -2),
    (0.40, (-15.0, 7.2, 52.0), (2.0, 13.0, -9.0), 0.17, 43, -4),
    (0.75, (-14.0, 10.2, 35.0), (1.0, 14.0, -6.0), 0.19, 42, -6),
    # form: alongside the flock as it banks, then dip under it
    (1.05, (-12.5, 12.6, 22.0), (1.5, 14.0, -5.0), 0.21, 43, -8),
    (1.40, (-9.5, 14.2, 12.5), (2.5, 14.2, -8.0), 0.23, 45, -11),
    (1.75, (-6.0, 10.4, 11.0), (3.0, 15.2, -12.0), 0.21, 47, 5),
    # outro: crane over the flock, then rise into the sunset / stars
    (2.10, (-8.0, 21.0, 19.0), (3.0, 12.0, -14.0), 0.19, 45, 3),
    (2.45, (-6.0, 33.0, 28.0), (40.0, 30.0, -320.0), 0.14, 48, 1),
    (2.85, (-3.0, 51.0, 30.0), (70.0, 88.0, -600.0), 0.10, 52, 0),
    (S_MAX, (-1.0, 60.0, 28.0), (80.0, 126.0, -600.0), 0.08, 54, 0),
]


def rail_keys():
    out = []
    up = np.array([0.0, 1.0, 0.0])
    for s, pos, subj, shift, fov, roll in KEYS:
        p = np.array(pos)
        c = np.array(subj)
        d = c - p
        dist = np.linalg.norm(d)
        right = np.cross(d, up)
        right /= np.linalg.norm(right)
        look = c - right * dist * shift
        out.append({"s": s, "pos": p, "look": look, "fov": fov, "roll": roll})
    return out
