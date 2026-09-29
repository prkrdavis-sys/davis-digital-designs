"""The Victorian conservatory, built procedurally.

Layout (Blender, meters, Z up): a six-bay nave runs along +Y from the
entrance (y = NAVE_Y0) into a glass rotunda centred at the origin, crowned by
an elliptical dome and a lantern. Everything static is emitted into
MeshBuilders keyed by (group, chunk): groups decide the bake atlas, chunks
decide the Low Resources depth band.
"""

import math
import random
from collections import defaultdict

from mathutils import Matrix, Vector

from mesh import MeshBuilder, arc, resample, spiral

V = Vector
TAU = math.pi * 2

R_ROT = 7.0
N_COL = 20
COL_STEP = TAU / N_COL
OPEN_HALF = math.radians(36)
NAVE_HW = R_ROT * math.sin(OPEN_HALF)
NAVE_Y1 = -R_ROT * math.cos(OPEN_HALF)
NAVE_Y0 = -22.0
N_BAYS = 6
BAY = (NAVE_Y1 - NAVE_Y0) / N_BAYS
DWARF = 0.6
EAVE = 3.4
APEX = 7.0
ROT_WALL = 7.5
DOME_H = 5.6
LANT_R = 1.4
LANT_H = 1.25
VR = (NAVE_HW**2 + (APEX - EAVE) ** 2) / (2 * (APEX - EAVE))
VZ = APEX - VR
DOOR_HW = NAVE_HW / 4
DOOR_H = 2.75

GROUPS = {
    "iron": ["iron", "gilt", "wire"],
    "masonry": ["brick", "stone", "soil", "wood", "terracotta", "moss"],
    "glass": ["glass"],
    "floor": ["floor_tiles"],
}
IRON, GILT, WIRE = 0, 1, 2
BRICK, STONE, SOIL, WOOD, TERRA, MOSS = range(6)


# --------------------------------------------------------------------------
# Geometry of the envelope
def vault_z(x):
    return VZ + math.sqrt(max(0.0, VR * VR - x * x))


def vault_angles():
    a = math.atan2(EAVE - VZ, NAVE_HW)
    return math.pi - a, a


def vault_pt(a, y, inset=0.0):
    r = VR - inset
    return V((r * math.cos(a), y, VZ + r * math.sin(a)))


def dome_pt(theta, phi, inset=0.0):
    """Point on the elliptical dome; inset moves along the surface normal (inward)."""
    r = R_ROT * math.cos(phi)
    z = ROT_WALL + DOME_H * math.sin(phi)
    n = V((math.cos(phi) / R_ROT, math.sin(phi) / DOME_H)).normalized()
    r -= n.x * inset
    z -= n.y * inset
    return V((r * math.cos(theta), r * math.sin(theta), z))


PHI_TOP = math.acos(LANT_R / R_ROT)
DOME_TOP = ROT_WALL + DOME_H * math.sin(PHI_TOP)


def col_angle(k):
    return -math.pi / 2 + OPEN_HALF + COL_STEP * k


ROT_COLS = [k for k in range(N_COL) if k <= N_COL - 4]  # 17 columns; the last three bays are the nave opening


def in_opening(theta):
    d = (theta + math.pi / 2 + math.pi) % TAU - math.pi
    return abs(d) < OPEN_HALF - 1e-3


def nave_frames():
    return [NAVE_Y0 + BAY * k for k in range(N_BAYS + 1)]


class Parts:
    def __init__(self):
        self.mb = defaultdict(MeshBuilder)
        self.spots = defaultdict(list)  # planting spots by kind
        self.bulbs = []  # (pos, string id)
        self.lanterns = []  # (pos, yaw)
        self.baskets = []  # (pos,)
        self.ivy = []  # polylines for ivy to climb
        self.benches = []  # (pos, yaw, kind)

    def __call__(self, group, chunk):
        return self.mb[(group, chunk)]


def nave_chunk(y):
    return f"nave{min(N_BAYS - 1, max(0, int((y - NAVE_Y0) // BAY)))}"


def rot_chunk(theta):
    q = int(((theta + math.pi / 4) % TAU) // (math.pi / 2))
    return f"rot{q}"


# --------------------------------------------------------------------------
# Ornament
def column(mb, x, y, z0, z1, r=0.075, capital=True):
    """Fluted cast-iron column with a moulded base and a bell capital."""
    c = (x, y, z0)
    base = [(r * 1.9, 0.0), (r * 1.9, 0.07), (r * 1.7, 0.09), (r * 1.55, 0.12), (r * 1.62, 0.15), (r * 1.3, 0.2), (r * 1.18, 0.24), (r * 1.1, 0.3)]
    mb.lathe(base, c, 24, IRON, cap_bottom=True)
    # Fluted shaft.
    seg = 32
    h0, h1 = z0 + 0.3, z1 - (0.34 if capital else 0.05)
    rings = []
    for zz, rr in ((h0, r * 1.06), (h0 + (h1 - h0) * 0.5, r * 1.02), (h1, r * 0.95)):
        ring = []
        for j in range(seg):
            a = TAU * j / seg
            k = rr * (1 - 0.07 * (0.5 + 0.5 * math.cos(16 * a)))
            ring.append(mb.vert((x + k * math.cos(a), y + k * math.sin(a), zz)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(seg):
            q = (j + 1) % seg
            mb.face((r0[j], r0[q], r1[q], r1[j]), IRON)
    if capital:
        cap = [(r * 0.95, 0.0), (r * 1.25, 0.03), (r * 1.1, 0.06), (r * 1.15, 0.1), (r * 1.5, 0.2), (r * 1.95, 0.28), (r * 2.05, 0.3), (r * 2.05, 0.34)]
        mb.lathe(cap, (x, y, h1), 24, IRON, cap_top=True)
        # Acanthus: eight curled leaves around the bell.
        for j in range(8):
            a = TAU * j / 8
            d = V((math.cos(a), math.sin(a), 0))
            pts = [V((x, y, h1 + 0.02)) + d * r * 1.1 + V((0, 0, t * 0.26)) + d * (r * 0.9 * t * t) for t in (0, 0.3, 0.6, 0.85, 1.0)]
            pts.append(pts[-1] + d * 0.02 - V((0, 0, 0.03)))
            mb.tube(pts, 0.012, 5, IRON)
        mb.box((x, y, z1 - 0.015), (r * 4.4, r * 4.4, 0.03), mat=IRON)


def ring_tube(mb, center, radius, r, normal="y", mat=IRON, n=24):
    pts = []
    for i in range(n):
        a = TAU * i / n
        if normal == "y":
            pts.append(V(center) + V((radius * math.cos(a), 0, radius * math.sin(a))))
        elif normal == "x":
            pts.append(V(center) + V((0, radius * math.cos(a), radius * math.sin(a))))
        else:
            pts.append(V(center) + V((radius * math.cos(a), radius * math.sin(a), 0)))
    mb.tube(pts, r, 5, mat, closed=True, caps=False)


def arcade(mb, a, b, drop=0.62, crown=0.14, scroll_r=0.011):
    """Segmental arch with scroll-filled spandrels between two column tops a, b (at beam level)."""
    a, b = V(a), V(b)
    ab = b - a
    L = ab.length
    u = ab.normalized()
    up = V((0, 0, 1))

    def P(uu, vv):
        return a + u * uu + up * vv

    # Circle through (0,-drop), (L/2,-crown), (L,-drop).
    h = drop - crown
    rad = (L * L / 4 + h * h) / (2 * h)
    cy = -crown - rad

    def arch_v(uu):
        return cy + math.sqrt(max(0.0, rad * rad - (uu - L / 2) ** 2))

    a0 = math.atan2(-drop - cy, -L / 2)
    a1 = math.atan2(-drop - cy, L / 2)
    pts = [P(L / 2 + rad * math.cos(t), cy + rad * math.sin(t)) for t in [a0 + (a1 - a0) * i / 28 for i in range(29)]]
    mb.bar(pts, 0.05, 0.035, up=u.cross(up), mat=IRON)
    # Beam soffit bead.
    mb.bar([P(0, -0.02), P(L, -0.02)], 0.035, 0.04, up=u.cross(up), mat=IRON)
    for side in (0, 1):
        def S(uu, vv, side=side):
            return P(uu if side == 0 else L - uu, vv)

        uc = 0.2
        vc = arch_v(uc) * 0.5
        rr = min(uc, -vc) * 0.62
        ring = [S(uc + rr * math.cos(t), vc + rr * math.sin(t)) for t in [TAU * i / 20 for i in range(20)]]
        mb.tube(ring, scroll_r, 5, IRON, closed=True, caps=False)
        # Rosette inside the ring.
        for k in range(4):
            t = TAU * k / 4 + math.pi / 4
            mb.tube([S(uc, vc), S(uc + rr * 0.8 * math.cos(t), vc + rr * 0.8 * math.sin(t))], scroll_r * 0.8, 4, IRON, caps=False)
        # Running scroll between the ring and the crown, with a curl at every crest.
        u0, u1 = uc + rr + 0.05, L / 2 - 0.12
        if u1 - u0 < 0.2:
            continue
        lam = max(0.24, (u1 - u0) / max(1, round((u1 - u0) / 0.32)))
        wave = []
        steps = int((u1 - u0) / 0.02)
        for i in range(steps + 1):
            uu = u0 + (u1 - u0) * i / steps
            band = arch_v(uu)
            amp = -band * 0.24
            wave.append(S(uu, band * 0.5 + amp * math.sin(TAU * (uu - u0) / lam)))
        mb.tube(wave, scroll_r, 5, IRON)
        k = 0
        uu = u0 + lam * 0.25
        while uu < u1:
            band = arch_v(uu)
            amp = -band * 0.24
            sgn = 1 if k % 2 == 0 else -1
            cx, cv = uu + lam * 0.18, band * 0.5 + sgn * amp * 0.35
            sp = spiral((cx, cv), amp * 0.75, amp * 0.12, math.pi if sgn > 0 else 0.0, 1.2, 26, -sgn)
            mb.tube([S(p[0], p[1]) for p in sp], scroll_r * 0.9, 4, IRON)
            uu += lam * 0.5
            k += 1
    # Keystone rosette at the crown.
    ring_center = P(L / 2, -crown * 0.5)
    for k in range(6):
        t = TAU * k / 6
        d = u * math.cos(t) + up * math.sin(t)
        mb.tube([ring_center, ring_center + d * 0.06], 0.012, 4, IRON)
    mb.sphere(ring_center, 0.025, 10, 6, IRON)


def finial(mb, base, height=1.0, mat=GILT):
    x, y, z = base
    h = height
    prof = [(0.07 * h, 0), (0.09 * h, 0.04 * h), (0.05 * h, 0.08 * h), (0.035 * h, 0.2 * h), (0.09 * h, 0.3 * h), (0.11 * h, 0.36 * h), (0.09 * h, 0.42 * h), (0.03 * h, 0.48 * h), (0.028 * h, 0.6 * h), (0.06 * h, 0.66 * h), (0.028 * h, 0.72 * h), (0.012 * h, 0.95 * h), (0.001, h)]
    mb.lathe(prof, (x, y, z), 16, mat, cap_bottom=True)


def cresting_unit(mb, origin, along, up, w=0.3, h=0.34, r=0.009):
    """One repeat of ridge cresting: a post with a fleur, flanked by an arched scroll."""
    o, a, u = V(origin), V(along).normalized(), V(up).normalized()

    def P(x, y):
        return o + a * x + u * y

    mb.tube([P(0, 0), P(0, h)], r * 1.3, 5, IRON)
    mb.sphere(P(0, h + 0.03), 0.028, 8, 6, GILT)
    ring = [P(0.045 * math.cos(t), h * 0.55 + 0.045 * math.sin(t)) for t in [TAU * i / 16 for i in range(16)]]
    mb.tube(ring, r, 4, IRON, closed=True, caps=False)
    # Two C-scrolls meeting between posts.
    for s in (-1, 1):
        sp = spiral((s * w * 0.28, h * 0.32), h * 0.26, h * 0.05, math.pi / 2 if s > 0 else math.pi / 2, 0.9, 20, s)
        mb.tube([P(x, y) for x, y in sp], r, 4, IRON)
    mb.tube([P(-w / 2, h * 0.12), P(w / 2, h * 0.12)], r, 4, IRON)


# --------------------------------------------------------------------------
def build_nave(P):
    a_l, a_r = vault_angles()
    frames = nave_frames()
    # Frames: columns, arched ribs, tie rods with medallions.
    for k, y in enumerate(frames):
        ch = nave_chunk(y - 0.01 if k == N_BAYS else y)
        mb = P("iron", ch)
        for s in (-1, 1):
            column(mb, s * NAVE_HW, y, 0.0, EAVE + 0.02, 0.075)
            P.ivy.append(("col", V((s * NAVE_HW, y, 0.0)), EAVE))
        rib = [vault_pt(a_l + (a_r - a_l) * i / 48, y, 0.07) for i in range(49)]
        mb.bar(rib, 0.14, 0.07, up=(0, 1, 0), mat=IRON, chamfer=0.012)
        # Rib flange (T-section) on the inner edge.
        mb.bar([vault_pt(a_l + (a_r - a_l) * i / 48, y, 0.145) for i in range(49)], 0.02, 0.12, up=(0, 1, 0), mat=IRON)
        if 0 < k < N_BAYS:
            zt = EAVE + 0.12
            mb.tube([V((-NAVE_HW, y, zt)), V((NAVE_HW, y, zt))], 0.018, 6, IRON)
            ring_tube(mb, (0, y, zt), 0.17, 0.013)
            for q in range(4):
                t = TAU * q / 4
                ring_tube(mb, (0.085 * math.cos(t), y, zt + 0.085 * math.sin(t)), 0.075, 0.009, n=18)
            mb.sphere(V((0, y, zt)), 0.03, 10, 6, GILT)
            for s in (-1, 1):
                ring_tube(mb, (s * 1.9, y, zt), 0.045, 0.008, n=12)
                P.baskets.append(V((s * 1.9, y, zt - 0.045)))
            # String lights sag along the tie rod at night.
            for s in (-1, 1):
                pts = [V((s * NAVE_HW * t, y + 0.06, zt - 0.02 - 0.18 * math.sin(math.pi * t))) for t in [i / 16 for i in range(17)]]
                P.bulbs_string(pts, f"tie{k}{s}", 0.22)
        P.bulbs_string([vault_pt(a_l + (a_r - a_l) * i / 60, y + 0.08, 0.2) for i in range(61)], f"rib{k}", 0.26)

    # Eaves beams, transoms, wall glazing bars, and the arcade between columns.
    for s in (-1, 1):
        x = s * NAVE_HW
        for y0, y1 in zip(frames, frames[1:]):
            ch = nave_chunk(y0 + 0.1)
            mb = P("iron", ch)
            mb.box(((x - s * 0.04), (y0 + y1) / 2, EAVE + 0.09), (0.2, y1 - y0, 0.18), mat=IRON)
            mb.box(((x + s * 0.05), (y0 + y1) / 2, EAVE + 0.2), (0.14, y1 - y0, 0.05), mat=IRON)
            for z in (DWARF + 0.04, 2.0):
                mb.bar([V((x, y0, z)), V((x, y1, z))], 0.05, 0.06, up=(1, 0, 0), mat=IRON)
            for j in range(1, 5):
                yy = y0 + (y1 - y0) * j / 5
                mb.bar([V((x, yy, DWARF)), V((x, yy, EAVE))], 0.035, 0.05, up=(0, 0, 1), mat=IRON)
            arcade(mb, V((x - s * 0.08, y0 + 0.09, EAVE)), V((x - s * 0.08, y1 - 0.09, EAVE)))
            # Glass: two tiers per pane column.
            g = P("glass", ch)
            for j in range(5):
                ya, yb = y0 + (y1 - y0) * j / 5, y0 + (y1 - y0) * (j + 1) / 5
                for za, zb in ((DWARF + 0.04, 2.0), (2.0, EAVE)):
                    tint = pane_tint()
                    xg = x + s * 0.03
                    g.quad(V((xg, ya, za)), V((xg, yb, za)), V((xg, yb, zb)), V((xg, ya, zb)), 0, tint)
        # Ivy along the eaves.
        P.ivy.append(("line", [V((x - s * 0.15, y, EAVE + 0.02)) for y in (NAVE_Y0 + 0.5, NAVE_Y0 + BAY * 2.5)], 0))

    # Vault: glazing bars following the arc, purlins along the nave, glass panes.
    n_arc = 14
    for y0, y1 in zip(frames, frames[1:]):
        ch = nave_chunk(y0 + 0.1)
        mb = P("iron", ch)
        g = P("glass", ch)
        for j in range(1, 5):
            yy = y0 + (y1 - y0) * j / 5
            mb.bar([vault_pt(a_l + (a_r - a_l) * i / 40, yy, 0.03) for i in range(41)], 0.055, 0.03, up=(0, 1, 0), mat=IRON)
        for i in range(1, n_arc):
            a = a_l + (a_r - a_l) * i / n_arc
            mb.bar([vault_pt(a, y0, 0.035), vault_pt(a, y1, 0.035)], 0.04, 0.05, up=(math.cos(a), 0, math.sin(a)), mat=IRON)
        for j in range(5):
            ya, yb = y0 + (y1 - y0) * j / 5, y0 + (y1 - y0) * (j + 1) / 5
            for i in range(n_arc):
                aa, ab = a_l + (a_r - a_l) * i / n_arc, a_l + (a_r - a_l) * (i + 1) / n_arc
                g.quad(vault_pt(aa, ya, -0.02), vault_pt(aa, yb, -0.02), vault_pt(ab, yb, -0.02), vault_pt(ab, ya, -0.02), 0, pane_tint())
        # Ridge cresting and ridge beam.
        mb.box((0, (y0 + y1) / 2, APEX + 0.03), (0.08, y1 - y0, 0.06), mat=IRON)
        n = int((y1 - y0) / 0.3)
        for q in range(n):
            yy = y0 + (q + 0.5) * (y1 - y0) / n
            cresting_unit(mb, (0, yy, APEX + 0.06), (0, 1, 0), (0, 0, 1), w=(y1 - y0) / n)

    # Entrance gable: fan of glazing bars, fanlight, and open double doors.
    y = NAVE_Y0
    mb = P("iron", "nave0")
    g = P("glass", "nave0")
    xs = [-NAVE_HW + i * (2 * NAVE_HW) / 16 for i in range(17)]
    for x in xs[1:-1]:
        z0 = DOOR_H + 0.25 if abs(x) < DOOR_HW + 0.05 else DWARF
        mb.bar([V((x, y, z0)), V((x, y, vault_z(x) - 0.05))], 0.035, 0.05, up=(0, 0, 1), mat=IRON)
    for z in (2.0, EAVE, 5.2):
        xz = [x for x in xs if vault_z(x) > z + 0.05]
        if not xz:
            continue
        xa = -NAVE_HW if z <= EAVE else -math.sqrt(max(0, VR * VR - (z - VZ) ** 2))
        segs = [(xa, -DOOR_HW - 0.1), (DOOR_HW + 0.1, -xa)] if z < DOOR_H + 0.3 else [(xa, -xa)]
        for p0, p1 in segs:
            mb.bar([V((p0, y, z)), V((p1, y, z))], 0.05, 0.06, up=(0, 1, 0), mat=IRON)
    # Door frame + fanlight.
    for s in (-1, 1):
        mb.bar([V((s * DOOR_HW, y, 0)), V((s * DOOR_HW, y, DOOR_H))], 0.1, 0.12, up=(0, 0, 1), mat=IRON)
    fan = [V((DOOR_HW * math.cos(t), y, DOOR_H + DOOR_HW * 0.3 * math.sin(t))) for t in [math.pi * i / 24 for i in range(25)]]
    mb.bar(fan, 0.08, 0.1, up=(0, 1, 0), mat=IRON)
    mb.bar([V((-DOOR_HW, y, DOOR_H)), V((DOOR_HW, y, DOOR_H))], 0.08, 0.1, up=(0, 1, 0), mat=IRON)
    for q in range(1, 8):
        t = math.pi * q / 8
        mb.tube([V((0, y, DOOR_H)), V((DOOR_HW * 0.95 * math.cos(t), y, DOOR_H + DOOR_HW * 0.28 * math.sin(t)))], 0.012, 5, IRON)
    finial(mb, (0, y, APEX + 0.1), 1.1)
    for s in (-1, 1):
        # Door leaves swung inward, glazed in three panes.
        hinge = V((s * DOOR_HW, y - 0.05, 0))
        d = V((-s * math.cos(math.radians(112)), -math.sin(math.radians(112)), 0))
        w = DOOR_HW - 0.02
        pts = [hinge + d * w * t for t in (0, 1)]
        for zz in (0.05, 0.9, DOOR_H - 0.05):
            mb.bar([pts[0] + V((0, 0, zz)), pts[1] + V((0, 0, zz))], 0.06, 0.05, up=(0, 0, 1), mat=IRON)
        for t in (0.0, 1.0):
            p = hinge + d * w * t
            mb.bar([p, p + V((0, 0, DOOR_H - 0.05))], 0.06, 0.05, up=(0, 0, 1), mat=IRON)
        g.quad(pts[0] + V((0, 0, 0.9)), pts[1] + V((0, 0, 0.9)), pts[1] + V((0, 0, DOOR_H - 0.05)), pts[0] + V((0, 0, DOOR_H - 0.05)), 0, pane_tint())
        P("masonry", "nave0").box(tuple(hinge + d * w * 0.5 + V((0, 0, 0.47))), (w - 0.06, 0.03, 0.8), matrix=Matrix.Rotation(math.atan2(d.y, d.x), 3, "Z"), mat=WOOD)
        mb.sphere(hinge + d * w * 0.9 + V((0, 0, 1.05)), 0.025, 8, 6, GILT)
    for i in range(16):
        xa, xb = xs[i], xs[i + 1]
        za = DOOR_H + 0.25 if xa < DOOR_HW - 0.01 and xb > -DOOR_HW + 0.01 else DWARF
        g.quad(V((xa, y - 0.03, za)), V((xb, y - 0.03, za)), V((xb, y - 0.03, vault_z(xb))), V((xa, y - 0.03, vault_z(xa))), 0, pane_tint())
    # Fanlight glass.
    g.quad(V((-DOOR_HW, y - 0.02, DOOR_H)), V((DOOR_HW, y - 0.02, DOOR_H)), V((DOOR_HW, y - 0.02, DOOR_H + 0.25)), V((-DOOR_HW, y - 0.02, DOOR_H + 0.25)), 0, pane_tint())


def build_rotunda(P):
    # Columns with ivy, mid band, arcades between column heads, wall glazing.
    top = ROT_WALL
    for k in ROT_COLS:
        th = col_angle(k)
        x, y = R_ROT * math.cos(th), R_ROT * math.sin(th)
        mb = P("iron", rot_chunk(th))
        column(mb, x * 0.995, y * 0.995, 0.0, top, 0.09)
        ring_tube(mb, (x * 0.995, y * 0.995, EAVE), 0.1, 0.02, normal="z", n=20)
        if k % 2 == 0:
            P.ivy.append(("col", V((x * 0.99, y * 0.99, 0.0)), top * 0.8))
    for k in range(N_COL):
        th0, th1 = col_angle(k), col_angle(k + 1)
        mid = (th0 + th1) / 2
        ch = rot_chunk(mid)
        mb = P("iron", ch)
        g = P("glass", ch)
        a = V((R_ROT * math.cos(th0), R_ROT * math.sin(th0), top))
        b = V((R_ROT * math.cos(th1), R_ROT * math.sin(th1), top))
        inner = 0.985
        arcade(mb, V((a.x * inner, a.y * inner, top)), V((b.x * inner, b.y * inner, top)), drop=0.7, crown=0.16)
        opening = in_opening(mid)
        tiers = [DWARF + 0.04, 2.0, EAVE, 5.5, top]
        for z in tiers[:-1] if not opening else []:
            pa = V((R_ROT * math.cos(th0), R_ROT * math.sin(th0), z))
            pb = V((R_ROT * math.cos(th1), R_ROT * math.sin(th1), z))
            mb.bar([pa, pb], 0.05, 0.07, up=(0, 0, 1), mat=IRON)
        for j in range(4):
            ta, tb = th0 + (th1 - th0) * j / 4, th0 + (th1 - th0) * (j + 1) / 4
            if j > 0:
                zb = DWARF if not opening else vault_z(R_ROT * math.cos(ta)) + 0.05 if abs(R_ROT * math.cos(ta)) < NAVE_HW else DWARF
                pa = V((R_ROT * math.cos(ta), R_ROT * math.sin(ta), zb))
                mb.bar([pa, V((pa.x, pa.y, top))], 0.035, 0.05, up=(0, 0, 1), mat=IRON)
            for za, zb in zip(tiers, tiers[1:]):
                if opening:
                    xm = R_ROT * math.cos((ta + tb) / 2)
                    za = max(za, vault_z(xm) + 0.02) if abs(xm) < NAVE_HW + 0.2 else za
                    if za >= zb - 0.08:
                        continue
                rg = R_ROT + 0.03
                g.quad(V((rg * math.cos(ta), rg * math.sin(ta), za)), V((rg * math.cos(tb), rg * math.sin(tb), za)), V((rg * math.cos(tb), rg * math.sin(tb), zb)), V((rg * math.cos(ta), rg * math.sin(ta), zb)), 0, pane_tint())
    # Ring beam / gutter with cresting on top.
    for q in range(4):
        mb = P("iron", f"rot{q}")
        t0 = -math.pi / 4 + q * math.pi / 2
        n = 30
        pts = [V((R_ROT * 0.99 * math.cos(t0 + (math.pi / 2) * i / n), R_ROT * 0.99 * math.sin(t0 + (math.pi / 2) * i / n), top + 0.1)) for i in range(n + 1)]
        mb.bar(pts, 0.24, 0.2, up=(0, 0, 1), mat=IRON, chamfer=0.02)
        pts2 = [V((R_ROT * 1.02 * math.cos(t0 + (math.pi / 2) * i / n), R_ROT * 1.02 * math.sin(t0 + (math.pi / 2) * i / n), top + 0.25)) for i in range(n + 1)]
        mb.bar(pts2, 0.16, 0.06, up=(0, 0, 1), mat=IRON)
        cn = 36
        for i in range(cn):
            t = t0 + (math.pi / 2) * (i + 0.5) / cn
            o = V((R_ROT * 1.03 * math.cos(t), R_ROT * 1.03 * math.sin(t), top + 0.28))
            cresting_unit(mb, o, (-math.sin(t), math.cos(t), 0), (0, 0, 1), w=(math.pi / 2) * R_ROT / cn)
        # Rotunda string lights: festoons between column heads.
    for k in range(N_COL):
        th0, th1 = col_angle(k), col_angle(k + 1)
        pts = []
        for i in range(13):
            t = i / 12
            th = th0 + (th1 - th0) * t
            pts.append(V((R_ROT * 0.955 * math.cos(th), R_ROT * 0.955 * math.sin(th), top - 0.78 - 0.35 * math.sin(math.pi * t))))
        P.bulbs_string(pts, f"fest{k}", 0.24)
    # Junction arch where the nave meets the rotunda.
    a_l, a_r = vault_angles()
    mb = P("iron", "nave5")
    y = NAVE_Y1 - 0.02
    mb.bar([vault_pt(a_l + (a_r - a_l) * i / 48, y, 0.12) for i in range(49)], 0.26, 0.16, up=(0, 1, 0), mat=IRON, chamfer=0.02)


def build_dome(P):
    n_sub = 4
    n_rows = 9
    phis = [PHI_TOP * (i / n_rows) ** 0.9 for i in range(n_rows + 1)]
    for k in range(N_COL):
        th0 = col_angle(k)
        th1 = col_angle(k + 1)
        ch = rot_chunk((th0 + th1) / 2)
        mb = P("iron", ch)
        g = P("glass", ch)
        mer = [dome_pt(th0, PHI_TOP * i / 40, 0.08) for i in range(41)]
        mb.bar(mer, 0.15, 0.075, up=(-math.sin(th0), math.cos(th0), 0), mat=IRON, chamfer=0.012)
        mb.bar([dome_pt(th0, PHI_TOP * i / 40, 0.16) for i in range(41)], 0.02, 0.1, up=(-math.sin(th0), math.cos(th0), 0), mat=IRON)
        for j in range(1, n_sub):
            th = th0 + (th1 - th0) * j / n_sub
            mb.bar([dome_pt(th, PHI_TOP * i / 30, 0.03) for i in range(31)], 0.05, 0.03, up=(-math.sin(th), math.cos(th), 0), mat=IRON)
        for i in range(1, n_rows):
            phi = phis[i]
            pts = [dome_pt(th0 + (th1 - th0) * t / 6, phi, 0.035) for t in range(7)]
            mb.bar(pts, 0.04, 0.05, up=(0, 0, 1), mat=IRON)
        for j in range(n_sub):
            ta, tb = th0 + (th1 - th0) * j / n_sub, th0 + (th1 - th0) * (j + 1) / n_sub
            for i in range(n_rows):
                pa, pb = phis[i], phis[i + 1]
                g.quad(dome_pt(ta, pa, -0.02), dome_pt(tb, pa, -0.02), dome_pt(tb, pb, -0.02), dome_pt(ta, pb, -0.02), 0, pane_tint())
        # String lights: every other rib, from the lantern down to the ring beam.
        if k % 2 == 0:
            pts = [dome_pt(th0 + (th1 - th0) * 0.5, PHI_TOP * (1 - i / 30), 0.45 + 0.35 * math.sin(math.pi * i / 30)) for i in range(31)]
            P.bulbs_string(pts, f"dome{k}", 0.3)
    # Dome ring purlins at a few heights (full circles, chunked).
    for q in range(4):
        mb = P("iron", f"rot{q}")
        t0 = -math.pi / 4 + q * math.pi / 2
        for phi in (phis[3], phis[6]):
            pts = [dome_pt(t0 + (math.pi / 2) * i / 30, phi, 0.07) for i in range(31)]
            mb.bar(pts, 0.1, 0.07, up=(0, 0, 1), mat=IRON)
    # Lantern.
    mb = P("iron", "rot1")
    g = P("glass", "rot1")
    z0 = DOME_TOP
    ring_tube(mb, (0, 0, z0), LANT_R, 0.06, normal="z", n=48)
    ring_tube(mb, (0, 0, z0 + LANT_H), LANT_R, 0.05, normal="z", n=48)
    nl = 12
    for i in range(nl):
        t = TAU * i / nl
        column(mb, LANT_R * math.cos(t), LANT_R * math.sin(t), z0, z0 + LANT_H, 0.035, capital=False)
        t1 = TAU * (i + 1) / nl
        rg = LANT_R + 0.03
        g.quad(V((rg * math.cos(t), rg * math.sin(t), z0)), V((rg * math.cos(t1), rg * math.sin(t1), z0)), V((rg * math.cos(t1), rg * math.sin(t1), z0 + LANT_H)), V((rg * math.cos(t), rg * math.sin(t), z0 + LANT_H)), 0, pane_tint())
    cap = [(LANT_R + 0.12, 0.0), (LANT_R + 0.12, 0.06), (LANT_R * 0.98, 0.1)] + [(LANT_R * 0.98 * math.cos(a), 0.1 + 0.7 * math.sin(a)) for a in [math.pi / 2 * i / 10 for i in range(1, 11)]]
    cap[-1] = (0.02, cap[-1][1])
    mb.lathe(cap, (0, 0, z0 + LANT_H), 36, IRON, cap_bottom=True)
    for i in range(nl):
        t = TAU * i / nl
        mb.tube([V((LANT_R * 1.0 * math.cos(a) * math.cos(t), LANT_R * 1.0 * math.cos(a) * math.sin(t), z0 + LANT_H + 0.1 + 0.72 * math.sin(a))) for a in [math.pi / 2 * j / 10 for j in range(10)]], 0.018, 5, GILT)
    finial(mb, (0, 0, z0 + LANT_H + 0.78), 1.4)
    # Cresting around the lantern base.
    for i in range(30):
        t = TAU * (i + 0.5) / 30
        cresting_unit(mb, V(((LANT_R + 0.1) * math.cos(t), (LANT_R + 0.1) * math.sin(t), z0 + 0.03)), (-math.sin(t), math.cos(t), 0), (0, 0, 1), w=TAU * LANT_R / 30, h=0.24)


_rng = random.Random(7)


def pane_tint():
    g = _rng.random()
    return (0.93 + 0.07 * g, 0.97 + 0.03 * _rng.random(), 0.9 + 0.08 * g)


# --------------------------------------------------------------------------
# Masonry, floor, furniture
def dwarf_segment(P, ch, a, b, th=0.26):
    a, b = V(a), V(b)
    mb = P("masonry", ch)
    d = b - a
    L = d.length
    ang = math.atan2(d.y, d.x)
    rot = Matrix.Rotation(ang, 3, "Z")
    c = (a + b) / 2
    mb.box((c.x, c.y, DWARF / 2 - 0.02), (L + 0.02, th, DWARF - 0.04), matrix=rot, mat=BRICK)
    mb.box((c.x, c.y, DWARF - 0.01), (L + 0.04, th + 0.08, 0.06), matrix=rot, mat=STONE)


def build_masonry(P):
    # Dwarf walls.
    frames = nave_frames()
    for s in (-1, 1):
        for y0, y1 in zip(frames, frames[1:]):
            dwarf_segment(P, nave_chunk(y0 + 0.1), (s * (NAVE_HW - 0.1), y0, 0), (s * (NAVE_HW - 0.1), y1, 0))
        dwarf_segment(P, "nave0", (s * (NAVE_HW - 0.1), NAVE_Y0 + 0.1, 0), (s * (DOOR_HW + 0.04), NAVE_Y0 + 0.1, 0))
    for k in range(N_COL):
        th0, th1 = col_angle(k), col_angle(k + 1)
        if in_opening((th0 + th1) / 2):
            continue
        for j in range(4):
            ta, tb = th0 + (th1 - th0) * j / 4, th0 + (th1 - th0) * (j + 1) / 4
            r = R_ROT - 0.1
            dwarf_segment(P, rot_chunk(ta), (r * math.cos(ta), r * math.sin(ta), 0), (r * math.cos(tb), r * math.sin(tb), 0))
    # Entrance step outside the doors.
    P("masonry", "nave0").box((0, NAVE_Y0 - 0.5, -0.06), (2.6, 1.0, 0.12), mat=STONE)

    # Nave: alternate raised beds and potting benches along each side.
    for b in range(N_BAYS):
        y0 = frames[b]
        y1 = frames[b + 1]
        ch = nave_chunk(y0 + 0.1)
        for s in (-1, 1):
            kind = "bed" if (b + (0 if s < 0 else 1)) % 2 == 0 else "bench"
            if b == 0:
                kind = "bench"
            if kind == "bed":
                raised_bed(P, ch, (s * 1.25, y0 + 0.3), (s * (NAVE_HW - 0.28), y1 - 0.3), 0.55, "nave")
            else:
                potting_bench(P, ch, s, y0, y1)
    # Rotunda: central round bed and three perimeter beds, with benches in the gaps.
    round_bed(P, (0.0, 0.0), 2.4, 0.62)
    for a0, a1 in ((-50, -9), (9, 81), (99, 171), (189, 230)):
        ring_bed(P, math.radians(a0), math.radians(a1), 5.35, R_ROT - 0.28, 0.5)
    for a in (0, 90, 180):
        t = math.radians(a)
        pos = V((5.05 * math.cos(t), 5.05 * math.sin(t), 0))
        garden_bench(P, rot_chunk(t), pos, t - math.pi / 2)
        P.benches.append((pos, t - math.pi / 2, "garden"))
    # Big terracotta urns flanking the nave opening and the entrance.
    for s in (-1, 1):
        urn(P, "nave5", V((s * 1.55, NAVE_Y1 - 0.9, 0)), 0.42, 0.62)
        urn(P, "nave0", V((s * 1.45, NAVE_Y0 + 1.2, 0)), 0.36, 0.55)
    build_floor(P)


def raised_bed(P, ch, a, b, h, zone):
    mb = P("masonry", ch)
    x0, x1 = sorted((a[0], b[0]))
    y0, y1 = sorted((a[1], b[1]))
    t = 0.12
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = x1 - x0, y1 - y0
    for bx in ((cx, y0 + t / 2, w, t), (cx, y1 - t / 2, w, t), (x0 + t / 2, cy, t, d), (x1 - t / 2, cy, t, d)):
        mb.box((bx[0], bx[1], h / 2), (bx[2], bx[3], h), mat=BRICK)
    for bx in ((cx, y0 + t / 2, w + 0.06, t + 0.08), (cx, y1 - t / 2, w + 0.06, t + 0.08), (x0 + t / 2, cy, t + 0.08, d + 0.06), (x1 - t / 2, cy, t + 0.08, d + 0.06)):
        mb.box((bx[0], bx[1], h + 0.025), (bx[2], bx[3], 0.05), mat=STONE)
    soil_patch(mb, (x0 + t, y0 + t), (x1 - t, y1 - t), h - 0.06)
    P.spots[zone + "_bed"].append(((x0 + t, y0 + t, h - 0.06), (x1 - t, y1 - t, h - 0.06)))


def soil_patch(mb, a, b, z, n=10):
    """Lumpy soil surface."""
    rng = random.Random(int(a[0] * 100 + a[1] * 10))
    ids = []
    for i in range(n + 1):
        row = []
        for j in range(n + 1):
            x = a[0] + (b[0] - a[0]) * i / n
            y = a[1] + (b[1] - a[1]) * j / n
            row.append(mb.vert((x, y, z + rng.uniform(-0.015, 0.02))))
        ids.append(row)
    for i in range(n):
        for j in range(n):
            mb.face((ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]), SOIL)


def round_bed(P, c, r, h):
    mb = P("masonry", "rot0")
    mb.lathe([(r, 0), (r, h), (r + 0.05, h), (r + 0.05, h + 0.06), (r - 0.28, h + 0.06), (r - 0.28, h)], (c[0], c[1], 0), 64, BRICK)
    # Coping ring gets stone.
    mb.lathe([(r + 0.05, h), (r + 0.05, h + 0.06), (r - 0.28, h + 0.06), (r - 0.28, h)], (c[0], c[1], 0.001), 64, STONE)
    rng = random.Random(3)
    rings = []
    for i in range(9):
        rr = (r - 0.25) * (1 - i / 8)
        ring = []
        for j in range(48):
            a = TAU * j / 48
            ring.append(mb.vert((c[0] + max(rr, 0.01) * math.cos(a), c[1] + max(rr, 0.01) * math.sin(a), h - 0.08 + rng.uniform(-0.02, 0.03) + 0.06 * (i / 8))))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(48):
            q = (j + 1) % 48
            mb.face((r0[j], r0[q], r1[q], r1[j]), SOIL)
    P.spots["center_bed"].append((c, r - 0.3, h - 0.05))


def ring_bed(P, a0, a1, r0, r1, h):
    rng = random.Random(int(a0 * 1000))
    n = max(4, int((a1 - a0) * r1 / 0.35))
    for i in range(n):
        ta, tb = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
        ch = rot_chunk((ta + tb) / 2)
        mb = P("masonry", ch)
        ca, sa, cb, sb = math.cos(ta), math.sin(ta), math.cos(tb), math.sin(tb)
        # Inner brick wall + coping.
        for rr, rw in ((r0, 0.12),):
            p0, p1 = V((rr * ca, rr * sa, 0)), V((rr * cb, rr * sb, 0))
            mid = (p0 + p1) / 2
            rot = Matrix.Rotation(math.atan2(p1.y - p0.y, p1.x - p0.x), 3, "Z")
            mb.box((mid.x, mid.y, h / 2), ((p1 - p0).length + 0.01, rw, h), matrix=rot, mat=BRICK)
            mb.box((mid.x, mid.y, h + 0.025), ((p1 - p0).length + 0.02, rw + 0.08, 0.05), matrix=rot, mat=STONE)
        # Soil strip.
        v = [mb.vert((rr * c, rr * s, h - 0.06 + 0.02 * rng.random())) for rr, c, s in ((r0 + 0.06, ca, sa), (r1, ca, sa), (r1, cb, sb), (r0 + 0.06, cb, sb))]
        mb.face(v, SOIL)
    for end in (a0, a1):
        p0, p1 = V((r0 * math.cos(end), r0 * math.sin(end), 0)), V((r1 * math.cos(end), r1 * math.sin(end), 0))
        mid = (p0 + p1) / 2
        rot = Matrix.Rotation(end, 3, "Z")
        mb = P("masonry", rot_chunk(end))
        mb.box((mid.x, mid.y, h / 2), ((p1 - p0).length, 0.12, h), matrix=rot, mat=BRICK)
        mb.box((mid.x, mid.y, h + 0.025), ((p1 - p0).length + 0.04, 0.2, 0.05), matrix=rot, mat=STONE)
    P.spots["ring_bed"].append((a0, a1, r0 + 0.15, r1 - 0.1, h - 0.05))


def pot(mb, base, r, h, mat=TERRA, rim=True):
    x, y, z = base
    prof = [(r * 0.62, 0.0), (r * 0.64, 0.01), (r * 0.9, h * 0.85)]
    if rim:
        prof += [(r * 0.98, h * 0.86), (r * 1.0, h), (r * 0.88, h), (r * 0.86, h * 0.9)]
    prof += [(r * 0.8, h * 0.84), (r * 0.52, h * 0.1), (0.01, h * 0.1)]
    mb.lathe(prof, (x, y, z), 20, mat, cap_bottom=True)
    # Soil disc inside.
    mb.lathe([(r * 0.8, h * 0.78), (0.01, h * 0.8)], (x, y, z), 16, SOIL)
    return V((x, y, z + h * 0.8))


def urn(P, ch, base, r, h):
    mb = P("masonry", ch)
    x, y, z = base
    prof = [(r * 0.55, 0), (r * 0.6, 0.06), (r * 0.42, 0.12), (r * 0.34, 0.22), (r * 0.5, 0.3), (r * 0.85, 0.5), (r * 1.0, 0.72), (r * 1.02, 0.86), (r * 1.08, 0.9), (r * 1.1, 1.0), (r * 0.95, 1.0), (r * 0.9, 0.9)]
    mb.lathe([(a, b * h) for a, b in prof], (x, y, z), 32, STONE, cap_bottom=True)
    mb.lathe([(r * 0.9, h * 0.88), (0.02, h * 0.9)], (x, y, z), 20, SOIL)
    P.spots["urn"].append((V((x, y, z + h * 0.9)), r * 0.8))


def potting_bench(P, ch, s, y0, y1):
    mb = P("masonry", ch)
    ir = P("iron", ch)
    x_in, x_out = s * (NAVE_HW - 1.05), s * (NAVE_HW - 0.32)
    xa, xb = sorted((x_in, x_out))
    ya, yb = y0 + 0.3, y1 - 0.3
    top = 0.88
    for i in range(5):
        xx = xa + (xb - xa) * (i + 0.5) / 5
        mb.box((xx, (ya + yb) / 2, top), ((xb - xa) / 5 - 0.012, yb - ya, 0.035), mat=WOOD)
    mb.box((xa + 0.02, (ya + yb) / 2, top + 0.06), (0.03, yb - ya, 0.09), mat=WOOD)
    for i in range(4):
        xx = xa + (xb - xa) * (i + 0.5) / 4
        mb.box((xx, (ya + yb) / 2, 0.3), ((xb - xa) / 4 - 0.02, yb - ya - 0.08, 0.025), mat=WOOD)
    for xx in (xa + 0.04, xb - 0.04):
        for yy in (ya + 0.05, yb - 0.05):
            ir.box((xx, yy, top / 2), (0.045, 0.045, top - 0.02), mat=IRON)
        ir.box((xx, (ya + yb) / 2, 0.12), (0.03, yb - ya - 0.1, 0.03), mat=IRON)
    rng = random.Random(int(y0 * 7 + s * 3))
    # Pots on the bench top (plants go in them later).
    n = 4
    for i in range(n):
        yy = ya + (yb - ya) * (i + 0.5) / n + rng.uniform(-0.1, 0.1)
        xx = (xa + xb) / 2 + rng.uniform(-0.12, 0.12)
        r = rng.uniform(0.1, 0.16)
        soil_top = pot(mb, (xx, yy, top + 0.018), r, r * 1.6)
        P.spots["bench_pot"].append((soil_top, r, ch))
    # Stacked spare pots and a seed tray on the lower shelf.
    for i in range(3):
        yy = ya + 0.3 + i * 0.55
        for q in range(3):
            pot(mb, ((xa + xb) / 2, yy, 0.32 + q * 0.035), 0.1, 0.14, rim=True)
    mb.box(((xa + xb) / 2 + 0.05, yb - 0.45, 0.35), (0.3, 0.45, 0.05), mat=WOOD)
    soil_patch(mb, ((xa + xb) / 2 - 0.08, yb - 0.65), ((xa + xb) / 2 + 0.18, yb - 0.25), 0.37, 4)
    P.spots["tray"].append((V(((xa + xb) / 2 + 0.05, yb - 0.45, 0.375)), ch))
    P.benches.append((V(((xa + xb) / 2, (ya + yb) / 2, top + 0.02)), 0.0 if s > 0 else math.pi, "potting"))
    if (int(y0) + (s > 0)) % 2 == 0:
        P.lanterns.append((V(((xa + xb) / 2 - s * 0.05, yb - 0.25, top + 0.02)), rng.uniform(0, TAU)))


def garden_bench(P, ch, pos, yaw):
    """Victorian cast-iron garden bench: scrolled ends, wooden slats."""
    mb = P("masonry", ch)
    ir = P("iron", ch)
    rot = Matrix.Rotation(yaw, 3, "Z")
    L = 1.5

    def T(x, y, z):
        return V(pos) + rot @ V((x, y, z))

    for sx in (-L / 2 + 0.06, L / 2 - 0.06):
        # Side frame: front leg scroll, seat rail, back scroll.
        leg = [T(sx, -0.25 + 0.05 * math.sin(t * 3), 0.45 * t) for t in [i / 10 for i in range(11)]]
        ir.tube(leg, 0.022, 6, IRON)
        back = [T(sx, 0.2 + 0.08 * t + 0.03 * math.sin(t * 5), 0.9 * t) for t in [i / 14 for i in range(15)]]
        ir.tube(back, 0.022, 6, IRON)
        ir.tube([T(sx, -0.3, 0.44), T(sx, 0.24, 0.44)], 0.02, 6, IRON)
        ir.tube([T(sx, -0.22, 0.65), T(sx, 0.05, 0.62), T(sx, 0.18, 0.5)], 0.018, 6, IRON)
        for sp in (spiral((-0.25, 0.1), 0.1, 0.02, 0, 1.3, 24, 1), spiral((0.26, 0.72), 0.09, 0.02, math.pi, 1.2, 24, -1), spiral((-0.24, 0.62), 0.06, 0.015, math.pi / 2, 1.1, 20, 1)):
            ir.tube([T(sx, p[0], p[1]) for p in sp], 0.013, 5, IRON)
    for i in range(6):
        yy = -0.28 + i * 0.1
        mb.box(tuple(T(0, yy, 0.46)), (L, 0.075, 0.03), matrix=rot, mat=WOOD)
    for i in range(4):
        zz = 0.58 + i * 0.1
        mb.box(tuple(T(0, 0.23 + 0.08 * (zz / 0.9), zz)), (L - 0.04, 0.025, 0.07), matrix=rot @ Matrix.Rotation(-0.12, 3, "X"), mat=WOOD)


def build_floor(P):
    """Nave rectangle + rotunda disc, gridded so the lightmap UV is a plain XY projection."""
    step = 0.25
    x0, x1 = -R_ROT - 0.05, R_ROT + 0.05
    y0, y1 = NAVE_Y0 - 0.02, R_ROT + 0.05
    nx, ny = int(round((x1 - x0) / step)), int(round((y1 - y0) / step))
    mb = P("floor", "all")
    idx = {}

    def inside(x, y):
        return (abs(x) <= NAVE_HW + 0.01 and y <= NAVE_Y1 + 1.5) or (x * x + y * y <= (R_ROT + 0.02) ** 2)

    for i in range(nx + 1):
        for j in range(ny + 1):
            x, y = x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny
            idx[(i, j)] = (x, y)
    verts = {}
    for i in range(nx):
        for j in range(ny):
            quad = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            cx = sum(idx[q][0] for q in quad) / 4
            cy = sum(idx[q][1] for q in quad) / 4
            if not inside(cx, cy):
                continue
            ids = []
            for q in quad:
                if q not in verts:
                    x, y = idx[q]
                    # Snap the rim onto the circle so the floor meets the dwarf wall.
                    if y > NAVE_Y1 + 1.5 or abs(x) > NAVE_HW + 0.01:
                        r = math.hypot(x, y)
                        if r > R_ROT:
                            x, y = x / r * R_ROT, y / r * R_ROT
                    verts[q] = mb.vert((x, y, 0.0))
                ids.append(verts[q])
            mb.face(ids, 0)
    P.floor_bounds = (x0, y0, x1, y1)


def build_all():
    P = Parts()

    def bulbs_string(pts, sid, spacing):
        pts = resample(pts, spacing * 0.25)
        P("iron", "wires").tube(pts, 0.004, 3, WIRE, caps=False)
        acc = 0.0
        for a, b in zip(pts, pts[1:]):
            acc += (b - a).length
            if acc >= spacing:
                acc = 0.0
                P.bulbs.append((b - V((0, 0, 0.03)), sid))

    P.bulbs_string = bulbs_string
    build_nave(P)
    build_rotunda(P)
    build_dome(P)
    build_masonry(P)
    return P
