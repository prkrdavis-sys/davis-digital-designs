"""Foliage: Poly Haven plant scans placed as linked duplicates, plus procedural
kentia palms, ivy on the ironwork, and pothos trailing from hanging baskets."""

import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from ddd.cli import CACHE, log
from gh_model import IRON, MOSS, TAU, Parts
from mesh import MeshBuilder

V = Vector
MODELS = CACHE / "polyhaven" / "model"

# Poly Haven sources: asset id -> variants (a tuple joins several objects into one plant)
SCANS = {
    "fern_02": ["fern_02_a", "fern_02_b", "fern_02_c", "fern_02_d"],
    "calathea_orbifolia_01": ["calathea_orbifolia_01_a", "calathea_orbifolia_01_b", "calathea_orbifolia_01_c", "calathea_orbifolia_01_d", "calathea_orbifolia_01_e"],
    "anthurium_botany_01": ["anthurium_botany_01_a", "anthurium_botany_01_b", "anthurium_botany_01_c", "anthurium_botany_04_d", "anthurium_botany_05_e", "anthurium_botany_06_f"],
    "pachira_aquatica_01": [("pachira_aquatica_01_leaves_a", "pachira_aquatica_01_bark_a"), ("pachira_aquatica_01_leaves_c", "pachira_aquatica_01_bark_c"), ("pachira_aquatica_01_leaves_d", "pachira_aquatica_01_bark_d")],
    "potted_plant_01": [("potted_plant_01_leaves", "potted_plant_01_stem", "potted_plant_01_pot")],
    "potted_plant_02": [("potted_plant_02_leaves", "potted_plant_02_pot")],
    "shrub_04": ["shrub_04_a_LOD1", "shrub_04_b_LOD1", "shrub_04_c_LOD1", "shrub_04_d_LOD1"],
    "Lantern_01": [("Lantern_01", "Lantern_01_glass")],
}

_src = {}


def reset():
    """Forget cached meshes (call after the Blender file is reset)."""
    _src.clear()


def load_scans():
    """Append every source once, join multi-part plants, and sit each on its own origin."""
    if _src:
        return _src
    for asset, variants in SCANS.items():
        path = MODELS / asset / "1k" / f"{asset}_1k.blend"
        with bpy.data.libraries.load(str(path), link=False) as (src, dst):
            dst.objects = [n for n in src.objects]
        objs = {o.name: o for o in dst.objects if o is not None and o.type == "MESH"}
        for v in variants:
            parts = v if isinstance(v, tuple) else (v,)
            meshes = []
            for p in parts:
                o = objs[p]
                me = o.data.copy()
                me.transform(o.matrix_world)
                meshes.append(me)
            me = meshes[0]
            if len(meshes) > 1:
                bm = bmesh.new()
                mats = []
                for m in meshes:
                    off = len(mats)
                    mats += list(m.materials)
                    tmp = bmesh.new()
                    tmp.from_mesh(m)
                    for f in tmp.faces:
                        f.material_index += off
                    t2 = bpy.data.meshes.new("_t")
                    tmp.to_mesh(t2)
                    tmp.free()
                    bm.from_mesh(t2)
                    bpy.data.meshes.remove(t2)
                me = bpy.data.meshes.new(parts[0])
                bm.to_mesh(me)
                bm.free()
                for m in mats:
                    me.materials.append(m)
            # Bottom-centre on the origin.
            co = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            lo, hi = co.min(0), co.max(0)
            me.transform(Matrix.Translation(V((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]))))
            name = parts[0].replace("_LOD1", "")
            me.name = name
            _src[name] = me
        for o in list(dst.objects):
            if o is not None:
                bpy.data.objects.remove(o, do_unlink=True)
    log("scans", len(_src), "variants")
    return _src


def height_of(me):
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    return float(co.reshape(-1, 3)[:, 2].max())


# --------------------------------------------------------------------------
# Procedural leaves
def _leaf_outline(kind):
    if kind == "ivy":
        # Five-lobed ivy leaf, base at (0,0), tip at (0,1).
        pts = [(0.0, 0.0), (0.22, 0.02), (0.5, 0.18), (0.36, 0.32), (0.46, 0.5), (0.24, 0.6), (0.14, 0.82), (0.0, 1.0)]
    elif kind == "heart":
        pts = [(0.0, 0.0), (0.18, -0.06), (0.36, 0.02), (0.44, 0.2), (0.4, 0.45), (0.28, 0.7), (0.12, 0.9), (0.0, 1.0)]
    else:
        pts = [(0.0, 0.0), (0.12, 0.2), (0.16, 0.5), (0.1, 0.8), (0.0, 1.0)]
    right = pts
    left = [(-x, y) for x, y in reversed(pts[1:-1])]
    return right + left


def leaf(mb, base, axis, normal, size, kind, color, fold=0.25, curl=0.15, mat=0):
    axis = V(axis).normalized()
    normal = (V(normal) - axis * V(normal).dot(axis)).normalized()
    side = axis.cross(normal).normalized()
    out = _leaf_outline(kind)

    def P(x, y):
        z = fold * abs(x) - curl * y * y
        return V(base) + (side * x + axis * y + normal * z) * size

    c = mb.vert(P(0.0, 0.42), color)
    ids = [mb.vert(P(x, y), tuple(min(1.0, k * (0.92 + 0.16 * abs(x))) for k in color)) for x, y in out]
    for i in range(len(ids)):
        mb.face((c, ids[i], ids[(i + 1) % len(ids)]), mat)


def jitter_color(rng, base, var=0.12):
    k = 1 + rng.uniform(-var, var)
    h = rng.uniform(-var, var) * 0.5
    return (max(0, min(1, base[0] * k + h * 0.4)), max(0, min(1, base[1] * k)), max(0, min(1, base[2] * k - h * 0.3)))


IVY = (0.13, 0.27, 0.07)
POTHOS = (0.2, 0.42, 0.1)
PALM = (0.16, 0.33, 0.1)


def ivy_column(mb, base, height, rng, r=0.11):
    """A vine spiralling up a column with alternating leaves and a few side shoots."""
    turns = rng.uniform(1.0, 1.8)
    a0 = rng.uniform(0, TAU)
    n = int(height / 0.03)
    top = height * rng.uniform(0.55, 1.0)
    pts = []
    for i in range(n + 1):
        t = i / n
        z = top * t
        a = a0 + turns * TAU * t
        rr = r + 0.012 * math.sin(t * 17)
        pts.append(V(base) + V((rr * math.cos(a), rr * math.sin(a), z)))
    mb.tube(pts, 0.005, 3, 1, caps=False, c=(0.25, 0.2, 0.1))
    for i in range(2, len(pts) - 1, 2):
        p = pts[i]
        out = (p - V((base[0], base[1], p.z))).normalized()
        axis = (out * 0.6 + V((0, 0, 0.7)) + V((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0))).normalized()
        size = rng.uniform(0.05, 0.085) * (0.7 + 0.3 * (1 - i / len(pts)))
        leaf(mb, p, axis, out, size, "ivy", jitter_color(rng, IVY), fold=0.2, curl=0.25)
    # Short tendrils hanging from the top.
    for _ in range(rng.randint(1, 3)):
        p = pts[-1] + V((0, 0, -0.02))
        tend = [p + V((rng.uniform(-0.02, 0.02) * k, rng.uniform(-0.02, 0.02) * k, -0.05 * k)) for k in range(rng.randint(4, 10))]
        mb.tube(tend, 0.004, 3, 1, caps=False, c=(0.25, 0.2, 0.1))
        for q in tend[1::1]:
            leaf(mb, q, V((rng.uniform(-1, 1), rng.uniform(-1, 1), -0.6)), V((rng.uniform(-1, 1), rng.uniform(-1, 1), 0.3)), rng.uniform(0.04, 0.07), "ivy", jitter_color(rng, IVY))


def trailing_vine(mb, start, out, length, rng, kind="heart", color=POTHOS, spacing=0.07, sizes=(0.06, 0.1)):
    """A vine that spills outward and hangs, leaves alternating along it."""
    pts = [V(start)]
    d = (V(out).normalized() * 0.8 + V((0, 0, 0.3))).normalized()
    step = 0.03
    wob = V((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.08
    for i in range(int(length / step)):
        d = (d + V((0, 0, -0.12)) + wob * 0.3).normalized()
        if d.z < -0.97:
            d = V((d.x, d.y, -0.97)).normalized()
        pts.append(pts[-1] + d * step)
    mb.tube(pts, 0.004, 3, 1, caps=False, c=(0.3, 0.4, 0.15))
    k = int(spacing / step)
    for i in range(1, len(pts) - 1, max(1, k)):
        p = pts[i]
        tang = (pts[i + 1] - pts[i - 1]).normalized()
        side = tang.cross(V((0, 0, 1)))
        if side.length < 1e-3:
            side = V((1, 0, 0))
        side.normalize()
        sgn = 1 if (i // max(1, k)) % 2 == 0 else -1
        axis = (side * sgn * 0.8 + V(out).normalized() * 0.5 + V((0, 0, -0.3))).normalized()
        nrm = (V(out).normalized() + V((0, 0, 0.4))).normalized()
        t = i / len(pts)
        size = rng.uniform(*sizes) * (1.0 - 0.45 * t)
        col = jitter_color(rng, color)
        if kind == "heart" and rng.random() < 0.35:
            col = (min(1, col[0] * 1.8 + 0.08), min(1, col[1] * 1.3 + 0.05), col[2])
        leaf(mb, p, axis, nrm, size, kind, col, fold=0.12, curl=0.2)


def palm(mb, base, height, rng, fronds=13):
    """Kentia palm: ringed trunk and a crown of arching pinnate fronds."""
    lean = V((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 1.0)).normalized()
    pts = [V(base) + lean * height * t + V((0.12 * math.sin(t * 2.3), 0.08 * math.sin(t * 1.7), 0)) * t for t in [i / 30 for i in range(31)]]
    radii = [0.12 - 0.04 * (i / 30) + 0.012 * (1 if i % 2 == 0 else -0.4) for i in range(31)]
    mb.tube(pts, 0.1, 12, 2, radii=radii, c=(1, 1, 1))
    crown = pts[-1]
    for f in range(fronds):
        yaw = TAU * f / fronds + rng.uniform(-0.2, 0.2)
        age = f / fronds
        elev = math.radians(rng.uniform(55, 70) - age * 80)
        L = rng.uniform(1.9, 2.6) * (0.8 + 0.2 * (1 - abs(age - 0.5)))
        d0 = V((math.cos(yaw) * math.cos(elev), math.sin(yaw) * math.cos(elev), math.sin(elev)))
        horiz = V((math.cos(yaw), math.sin(yaw), 0))
        rach = []
        n = 24
        for i in range(n + 1):
            t = i / n
            p = crown + d0 * L * t + horiz * L * 0.25 * t * t - V((0, 0, 1)) * L * (0.55 + 0.3 * age) * t * t
            rach.append(p)
        mb.tube(rach, 0.012, 5, 1, radii=[0.02 * (1 - 0.8 * i / n) + 0.003 for i in range(n + 1)], c=(0.45, 0.5, 0.25))
        base_col = jitter_color(rng, PALM, 0.1)
        if age > 0.75:
            base_col = (base_col[0] * 1.5 + 0.06, base_col[1] * 1.1 + 0.03, base_col[2] * 0.8)
        nl = 34
        for i in range(2, nl):
            t = i / nl
            idx = t * n
            j = int(idx)
            p = rach[j].lerp(rach[min(j + 1, n)], idx - j)
            tang = (rach[min(j + 1, n)] - rach[max(j - 1, 0)]).normalized()
            side = tang.cross(V((0, 0, 1)))
            if side.length < 1e-3:
                side = V((1, 0, 0))
            side.normalize()
            ll = 0.62 * math.sin(math.pi * min(1, t * 1.05)) ** 0.7 + 0.08
            for sgn in (-1, 1):
                droop = math.radians(rng.uniform(25, 45))
                dl = (side * sgn * math.cos(droop) + tang * 0.35 - V((0, 0, 1)) * math.sin(droop)).normalized()
                nrm = dl.cross(tang).normalized() * sgn
                if nrm.z < 0:
                    nrm = -nrm
                segs = 3
                w = 0.028
                row = []
                for s in range(segs + 1):
                    u = s / segs
                    q = p + dl * ll * u - V((0, 0, 1)) * ll * 0.25 * u * u
                    ww = w * math.sin(math.pi * min(0.98, u * 0.9 + 0.06))
                    side2 = dl.cross(nrm).normalized()
                    col = tuple(min(1, c * (0.9 + 0.3 * u)) for c in base_col)
                    row.append((mb.vert(q - side2 * ww, col), mb.vert(q + nrm * ww * 0.35, col), mb.vert(q + side2 * ww, col)))
                for s in range(segs):
                    a, b = row[s], row[s + 1]
                    mb.face((a[0], b[0], b[1], a[1]), 0)
                    mb.face((a[1], b[1], b[2], a[2]), 0)


def basket(iron_mb, moss_mb, hook, rng, chain=0.75, r=0.27):
    """Wire basket on three chains with a moss liner; returns the rim centre."""
    rim = V(hook) - V((0, 0, chain))
    for k in range(3):
        a = TAU * k / 3 + 0.3
        iron_mb.tube([V(hook), rim + V((r * math.cos(a), r * math.sin(a), 0))], 0.005, 4, IRON)
    for k in range(10):
        a = TAU * k / 10
        pts = [rim + V((r * math.cos(a) * math.cos(b), r * math.sin(a) * math.cos(b), -r * 0.85 * math.sin(b))) for b in [math.pi / 2 * i / 8 for i in range(9)]]
        iron_mb.tube(pts, 0.005, 4, IRON)
    for zz, rr in ((0.0, r), (-0.12, r * 0.82)):
        pts = [rim + V((rr * math.cos(a), rr * math.sin(a), zz)) for a in [TAU * i / 24 for i in range(24)]]
        iron_mb.tube(pts, 0.006, 4, IRON, closed=True, caps=False)
    prof = [(r * 0.96 * math.cos(b), -r * 0.82 * math.sin(b)) for b in [math.pi / 2 * i / 6 for i in range(7)]]
    prof[-1] = (0.01, prof[-1][1])
    moss_mb.lathe(prof, tuple(rim + V((0, 0, 0.01))), 16, MOSS)
    moss_mb.lathe([(r * 0.95, 0.02), (0.01, 0.05)], tuple(rim), 16, MOSS)
    return rim


# --------------------------------------------------------------------------
def build_foliage(P: Parts, seed=11):
    """Procedural foliage meshes + basket hardware. Returns {name: MeshBuilder}."""
    rng = random.Random(seed)
    out = {"ivy": MeshBuilder(), "pothos": MeshBuilder(), "palms": MeshBuilder(), "seedlings": MeshBuilder()}
    for item in P.ivy:
        if item[0] == "col" and rng.random() < 0.8:
            _, base, h = item
            ivy_column(out["ivy"], base, h, rng, r=0.1 if h < 5 else 0.12)
        elif item[0] == "line":
            a, b = item[1]
            n = int((b - a).length / 0.25)
            for i in range(n):
                if rng.random() < 0.55:
                    p = a.lerp(b, (i + rng.random()) / n)
                    trailing_vine(out["ivy"], p, V((-p.x, 0, 0)), rng.uniform(0.2, 0.9), rng, "ivy", IVY, 0.06, (0.045, 0.075))
    for hook in P.baskets:
        ch = "nave" + str(min(5, max(0, int((hook.y + 22.0) // ((-5.663 + 22.0) / 6)))))
        rim = basket(P("iron", ch), P("masonry", ch), hook, rng)
        P.spots["basket"].append(rim)
        for k in range(rng.randint(6, 9)):
            a = TAU * k / 8 + rng.uniform(-0.3, 0.3)
            d = V((math.cos(a), math.sin(a), 0))
            trailing_vine(out["pothos"], rim + d * 0.24 + V((0, 0, 0.02)), d, rng.uniform(0.5, 1.5), rng)
    # Rotunda baskets hang from the dome ribs.
    for k in range(6):
        a = TAU * k / 6 + math.radians(9)
        hook = V((4.3 * math.cos(a), 4.3 * math.sin(a), 11.0))
        rim = basket(P("iron", "wires"), P("masonry", "rot1"), hook, rng, chain=3.0, r=0.32)
        P.spots["basket"].append(rim)
        for q in range(rng.randint(8, 11)):
            b = TAU * q / 10 + rng.uniform(-0.3, 0.3)
            d = V((math.cos(b), math.sin(b), 0))
            trailing_vine(out["pothos"], rim + d * 0.3 + V((0, 0, 0.02)), d, rng.uniform(0.8, 2.2), rng)
    for c, r, h in P.spots["center_bed"]:
        for (dx, dy, hh) in ((0.7, 0.9, 5.4), (-0.9, 0.3, 4.3), (0.3, -0.8, 3.4)):
            palm(out["palms"], (c[0] + dx, c[1] + dy, h), hh, rng)
    for p, ch in P.spots["tray"]:
        for i in range(4):
            for j in range(5):
                q = p + V((-0.1 + i * 0.065, -0.17 + j * 0.085, 0))
                hgt = rng.uniform(0.03, 0.07)
                out["seedlings"].tube([q, q + V((0, 0, hgt))], 0.002, 3, 1, caps=False, c=(0.5, 0.6, 0.3))
                for s in (-1, 1):
                    leaf(out["seedlings"], q + V((0, 0, hgt)), V((s, rng.uniform(-0.3, 0.3), 0.4)), V((0, 0, 1)), rng.uniform(0.018, 0.03), "blade", jitter_color(rng, (0.3, 0.55, 0.15)))
    for k, mb in out.items():
        log("foliage", k, mb.tris, "tris")
    return out


# --------------------------------------------------------------------------
def scatter(rng, a, b, n, min_d, existing=None):
    pts = list(existing or [])
    out = []
    tries = 0
    while len(out) < n and tries < n * 40:
        tries += 1
        p = V((rng.uniform(a[0], b[0]), rng.uniform(a[1], b[1]), a[2]))
        if all((p - q).length >= min_d for q in pts):
            pts.append(p)
            out.append(p)
    return out


def place_scans(P: Parts, seed=5):
    """Instances of the Poly Haven scans: list of (mesh name, matrix)."""
    src = load_scans()
    rng = random.Random(seed)
    inst = []

    def put(name, pos, scale=1.0, yaw=None, tilt=0.0):
        yaw = rng.uniform(0, TAU) if yaw is None else yaw
        m = Matrix.Translation(V(pos)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Scale(scale, 4)
        inst.append((name, m))

    ferns = [f"fern_02_{c}" for c in "abcd"]
    cal = [f"calathea_orbifolia_01_{c}" for c in "abcde"]
    anth = ["anthurium_botany_01_a", "anthurium_botany_01_b", "anthurium_botany_01_c", "anthurium_botany_04_d", "anthurium_botany_05_e", "anthurium_botany_06_f"]
    pach = ["pachira_aquatica_01_leaves_a", "pachira_aquatica_01_leaves_c", "pachira_aquatica_01_leaves_d"]
    shrubs = [f"shrub_04_{c}" for c in "abcd"]

    for a, b in P.spots["nave_bed"]:
        x_in, x_out = (a[0], b[0]) if abs(a[0]) < abs(b[0]) else (b[0], a[0])
        big = V(((x_in + x_out) / 2 + (x_out - x_in) * 0.22, (a[1] + b[1]) / 2 + rng.uniform(-0.3, 0.3), a[2]))
        put(rng.choice(pach), big, rng.uniform(1.05, 1.4))
        taken = [big]
        for p in scatter(rng, (min(a[0], b[0]) + 0.1, a[1] + 0.15, a[2]), (max(a[0], b[0]) - 0.1, b[1] - 0.15), 3, 0.45, taken):
            put(rng.choice(cal + anth), p, rng.uniform(0.9, 1.4))
            taken.append(p)
        # Ferns spill over the aisle-side coping.
        for i in range(4):
            y = a[1] + (b[1] - a[1]) * (i + 0.5) / 4 + rng.uniform(-0.1, 0.1)
            p = V((x_in + (0.12 if x_out > x_in else -0.12), y, a[2]))
            put(rng.choice(ferns), p, rng.uniform(0.8, 1.15), tilt=0.0)
    for soil_top, r, ch in P.spots["bench_pot"]:
        pick = rng.random()
        if pick < 0.35:
            put(rng.choice(["anthurium_botany_05_e", "anthurium_botany_06_f", "anthurium_botany_04_d"]), soil_top, r * 3.2)
        elif pick < 0.6:
            put(rng.choice(["calathea_orbifolia_01_d", "calathea_orbifolia_01_e"]), soil_top, r * 4.5)
        elif pick < 0.85:
            put(rng.choice(["fern_02_a", "fern_02_d"]), soil_top, r * 2.4)
        else:
            put(rng.choice(shrubs), soil_top, r * 6)
    for pos, r in P.spots["urn"]:
        put(rng.choice(["fern_02_b", "fern_02_c"]), pos, 1.3)
    for c, r, h in P.spots["center_bed"]:
        n = 16
        for i in range(n):
            a = TAU * i / n + rng.uniform(-0.1, 0.1)
            rr = r * rng.uniform(0.75, 0.95)
            put(rng.choice(ferns + cal), (c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), h), rng.uniform(0.9, 1.3))
        for i in range(5):
            a = TAU * i / 5 + 0.4
            put(rng.choice(anth[:3] + cal[:2]), (c[0] + r * 0.45 * math.cos(a), c[1] + r * 0.45 * math.sin(a), h), rng.uniform(1.1, 1.5))
    for a0, a1, r0, r1, h in P.spots["ring_bed"]:
        n = max(2, int((a1 - a0) * (r0 + r1) / 2 / 0.7))
        for i in range(n):
            a = a0 + (a1 - a0) * (i + 0.5) / n + rng.uniform(-0.05, 0.05)
            back = V((r1 * 0.98 * math.cos(a), r1 * 0.98 * math.sin(a), h))
            front = V((r0 * 1.02 * math.cos(a), r0 * 1.02 * math.sin(a), h))
            if i % 3 == 0:
                put(rng.choice(pach), back.lerp(front, 0.3), rng.uniform(1.2, 1.6))
            else:
                put(rng.choice(anth[:3] + cal[:3]), back.lerp(front, 0.4), rng.uniform(1.1, 1.6))
            put(rng.choice(ferns), front.lerp(back, 0.1) + V((0.0, 0.0, 0.0)), rng.uniform(0.9, 1.2))
    for rim in P.spots["basket"]:
        put(rng.choice(["fern_02_b", "fern_02_c"]), rim + V((0, 0, 0.03)), 0.75)
    # Potted plants on the floor by the entrance and along the aisle.
    for s in (-1, 1):
        put("potted_plant_01_leaves", (s * 2.9, -21.0, 0), 1.35)
        put("potted_plant_02_leaves", (s * 1.25, -6.9, 0), 1.25)
        put("potted_plant_02_leaves", (s * 3.1, -3.4 + s * 0.2, 0), 1.2)
    lanterns = []
    for pos, yaw in P.lanterns:
        lanterns.append(("Lantern_01", Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Scale(1.6, 4)))
    for pos, yaw, kind in P.benches:
        if kind == "garden":
            p = pos + Matrix.Rotation(yaw, 3, "Z") @ V((0.55, -0.1, 0.475))
            lanterns.append(("Lantern_01", Matrix.Translation(p) @ Matrix.Rotation(rng.uniform(0, TAU), 4, "Z") @ Matrix.Scale(1.4, 4)))
    log("scan instances", len(inst), "lanterns", len(lanterns))
    return inst, lanterns


def link_instances(inst, coll=None):
    src = load_scans()
    objs = []
    for i, (name, m) in enumerate(inst):
        o = bpy.data.objects.new(f"{name}.{i:03d}", src[name])
        o.matrix_world = m
        (coll or bpy.context.scene.collection).objects.link(o)
        objs.append(o)
    return objs

