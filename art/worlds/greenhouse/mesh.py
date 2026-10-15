"""Fast mesh accumulation for procedural architecture.

Everything is appended to flat Python lists and turned into one Blender mesh
with from_pydata at the end, which is orders of magnitude faster than building
thousands of small bmesh objects and joining them.

Every primitive also records lightmap UVs in meters, one island per sweep,
lathe or box face (tubes unroll into strips; caps sample the strip ends).
pack_atlas() shelf-packs the islands of several builders into one shared
atlas, which is far tighter than Smart UV Project on thin ironwork.
"""

import math
from contextlib import contextmanager

import bpy
import numpy as np
from mathutils import Matrix, Vector


class MeshBuilder:
    def __init__(self):
        self.v = []
        self.f = []
        self.mi = []
        self.col = []  # per-vertex RGB (optional variation, 0..1)
        self.fuv = []  # per face: ((u, v), ...) per corner in meters, or None (projected later)
        self.fisl = []  # per face: lightmap island id
        self._isl = 0
        self._auto = None
        self.bake_uv = None  # per-corner atlas UVs, set by pack_atlas()

    # ---------------------------------------------------------------- basics
    def vert(self, p, c=(1.0, 1.0, 1.0)):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.col.append(c)
        return len(self.v) - 1

    def new_island(self):
        self._isl += 1
        return self._isl

    def face(self, idx, mat=0, uv=None, island=None):
        self.f.append(tuple(idx))
        self.mi.append(mat)
        if island is None:
            island = self._auto if self._auto is not None else self.new_island()
        self.fuv.append(uv)
        self.fisl.append(island)

    @contextmanager
    def island(self):
        """Faces added inside share one island, planar-projected along their mean normal (height fields)."""
        prev = self._auto
        self._auto = self.new_island()
        try:
            yield self._auto
        finally:
            self._auto = prev

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    # ------------------------------------------------------------ primitives
    def box(self, center, size, matrix=None, mat=0, c=(1, 1, 1)):
        """Axis-aligned box (optionally transformed by a 3x3/4x4 matrix around center)."""
        cx, cy, cz = center
        sx, sy, sz = (s / 2 for s in size)
        corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
        m = Matrix(matrix).to_3x3() if matrix is not None else Matrix.Identity(3)
        pts = [Vector((cx, cy, cz)) + m @ Vector(p) for p in corners]
        ids = [self.vert(p, c) for p in pts]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            e1 = (pts[q[1]] - pts[q[0]]).length
            e2 = (pts[q[3]] - pts[q[0]]).length
            self.face([ids[i] for i in q], mat, uv=((0.0, 0.0), (e1, 0.0), (e1, e2), (0.0, e2)))

    def quad(self, a, b, c, d, mat=0, col=(1, 1, 1)):
        ids = [self.vert(p, col) for p in (a, b, c, d)]
        self.face(ids, mat)

    def lathe(self, profile, center=(0, 0, 0), segments=24, mat=0, cap_top=False, cap_bottom=False, c=(1, 1, 1), phase=0.0):
        """Revolve [(r, z), ...] around the Z axis through center."""
        cx, cy, cz = center
        rings = []
        for r, z in profile:
            ring = []
            for j in range(segments):
                a = phase + 2 * math.pi * j / segments
                ring.append(self.vert((cx + r * math.cos(a), cy + r * math.sin(a), cz + z), c))
            rings.append(ring)
        circ = 2 * math.pi * max(r for r, _ in profile)
        us = [circ * j / segments for j in range(segments + 1)]
        vs = [0.0]
        for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
            vs.append(vs[-1] + math.hypot(r1 - r0, z1 - z0))
        isl = self.new_island()
        for i in range(len(rings) - 1):
            r0, r1 = rings[i], rings[i + 1]
            for j in range(segments):
                k = (j + 1) % segments
                self.face((r0[j], r0[k], r1[k], r1[j]), mat, uv=((us[j], vs[i]), (us[j + 1], vs[i]), (us[j + 1], vs[i + 1]), (us[j], vs[i + 1])), island=isl)
        if cap_bottom:
            self.face(list(reversed(rings[0])), mat, uv=tuple((us[j], vs[0]) for j in reversed(range(segments))), island=isl)
        if cap_top:
            self.face(rings[-1], mat, uv=tuple((us[j], vs[-1]) for j in range(segments)), island=isl)
        return rings

    def cylinder(self, a, b, r, segments=12, mat=0, caps=True, c=(1, 1, 1)):
        self.tube([a, b], r, segments=segments, mat=mat, caps=caps, c=c)

    def sphere(self, center, r, u=12, v=8, mat=0, c=(1, 1, 1)):
        prof = [(r * math.sin(math.pi * i / v), -r * math.cos(math.pi * i / v)) for i in range(v + 1)]
        prof[0] = (1e-4, -r)
        prof[-1] = (1e-4, r)
        self.lathe(prof, center, u, mat, c=c)

    # --------------------------------------------------------------- sweeps
    def _frames(self, pts, up=None):
        n = len(pts)
        tangents = []
        for i in range(n):
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            if t.length < 1e-9:
                t = Vector((0, 0, 1))
            tangents.append(t.normalized())
        frames = []
        if up is not None:
            up = Vector(up).normalized()
            for t in tangents:
                side = t.cross(up)
                if side.length < 1e-6:
                    side = t.cross(Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0)))
                side.normalize()
                nrm = side.cross(t).normalized()
                frames.append((t, side, nrm))
            return frames
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        side = tangents[0].cross(ref).normalized()
        for i, t in enumerate(tangents):
            if i > 0:
                axis = tangents[i - 1].cross(t)
                if axis.length > 1e-8:
                    ang = math.acos(max(-1.0, min(1.0, tangents[i - 1].dot(t))))
                    side = Matrix.Rotation(ang, 3, axis.normalized()) @ side
            nrm = side.cross(t).normalized()
            frames.append((t, side, nrm))
        return frames

    def sweep(self, points, profile, up=None, mat=0, caps=True, closed=False, scales=None, c=(1, 1, 1)):
        """Sweep a closed 2D profile [(x, y), ...] (x along side, y along normal) along a path."""
        pts = [Vector(p) for p in points]
        frames = self._frames(pts, up)
        rings = []
        for i, (p, (t, side, nrm)) in enumerate(zip(pts, frames)):
            s = scales[i] if scales else 1.0
            rings.append([self.vert(p + side * (x * s) + nrm * (y * s), c) for x, y in profile])
        m = len(profile)
        k_avg = sum(scales) / len(scales) if scales else 1.0
        us = [0.0]
        for j in range(m):
            a, b = profile[j], profile[(j + 1) % m]
            us.append(us[-1] + math.hypot(b[0] - a[0], b[1] - a[1]) * k_avg)
        vs = [0.0]
        for a, b in zip(pts, pts[1:]):
            vs.append(vs[-1] + (b - a).length)
        if closed:
            vs.append(vs[-1] + (pts[0] - pts[-1]).length)
        isl = self.new_island()
        count = len(rings) if closed else len(rings) - 1
        # Profiles run counter-clockwise in (side, normal), which is clockwise seen along the
        # tangent, so this winding is the one that faces outward.
        for i in range(count):
            r0, r1 = rings[i], rings[(i + 1) % len(rings)]
            v0, v1 = vs[i], vs[i + 1]
            for j in range(m):
                k = (j + 1) % m
                self.face((r0[j], r1[j], r1[k], r0[k]), mat, uv=((us[j], v0), (us[j], v1), (us[j + 1], v1), (us[j + 1], v0)), island=isl)
        if caps and not closed:
            self.face(rings[0], mat, uv=tuple((us[j], vs[0]) for j in range(m)), island=isl)
            self.face(list(reversed(rings[-1])), mat, uv=tuple((us[j], vs[len(rings) - 1]) for j in reversed(range(m))), island=isl)

    def tube(self, points, r=0.02, segments=8, mat=0, caps=True, closed=False, radii=None, up=None, c=(1, 1, 1)):
        prof = [(math.cos(2 * math.pi * j / segments), math.sin(2 * math.pi * j / segments)) for j in range(segments)]
        if radii is None:
            self.sweep(points, [(x * r, y * r) for x, y in prof], up=up, mat=mat, caps=caps, closed=closed, c=c)
        else:
            self.sweep(points, prof, up=up, mat=mat, caps=caps, closed=closed, scales=radii, c=c)

    def bar(self, points, w, d, up=None, mat=0, caps=True, chamfer=0.0, c=(1, 1, 1)):
        """Rectangular bar (w along side, d along normal), optionally chamfered."""
        hw, hd = w / 2, d / 2
        if chamfer > 0:
            k = min(chamfer, hw * 0.45, hd * 0.45)
            prof = [(-hw + k, -hd), (hw - k, -hd), (hw, -hd + k), (hw, hd - k), (hw - k, hd), (-hw + k, hd), (-hw, hd - k), (-hw, -hd + k)]
        else:
            prof = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        self.sweep(points, prof, up=up, mat=mat, caps=caps, c=c)

    # ------------------------------------------------------------- lightmap
    def _projected(self):
        """Per-face corner UVs (meters), projecting faces recorded without UVs island by island."""
        out = list(self.fuv)
        pending = {}
        for fi, uv in enumerate(self.fuv):
            if uv is None:
                pending.setdefault(self.fisl[fi], []).append(fi)
        for faces in pending.values():
            n = Vector()
            for fi in faces:
                p = [Vector(self.v[i]) for i in self.f[fi]]
                for a, b in zip(p[1:], p[2:]):
                    n += (a - p[0]).cross(b - p[0])
            n = n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))
            t = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
            b = n.cross(t)
            for fi in faces:
                out[fi] = tuple((Vector(self.v[i]).dot(t), Vector(self.v[i]).dot(b)) for i in self.f[fi])
        return out

    # --------------------------------------------------------------- output
    def build(self, name, materials, coll=None, smooth_angle=None, color_attr=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        if self.mi:
            me.polygons.foreach_set("material_index", self.mi)
        for m in materials:
            me.materials.append(m)
        if color_attr and self.col:
            ca = me.color_attributes.new("Col", "BYTE_COLOR", "POINT")
            flat = []
            for c in self.col:
                flat += [c[0], c[1], c[2], 1.0]
            ca.data.foreach_set("color", flat)
        if self.bake_uv is not None:
            uv = me.uv_layers.new(name="bake")
            uv.data.foreach_set("uv", self.bake_uv.ravel())
        if smooth_angle is not None:
            me.shade_smooth()
            if hasattr(me, "set_sharp_from_angle"):
                me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        o = bpy.data.objects.new(name, me)
        (coll or bpy.context.scene.collection).objects.link(o)
        return o


def pack_atlas(builders, size, margin=2, min_px=2):
    """Shelf-pack every island of `builders` into one size x size atlas.

    Sets `bake_uv` (per corner, 0..1) on each builder and returns the texel
    density in texels per meter. Islands are rotated to lie flat, sorted by
    height, and the density is the largest that still fits.
    """
    rects = []  # (builder index, island id, umin, vmin, w, h)
    per_builder = []
    for bi, mb in enumerate(builders):
        uvs = mb._projected()
        counts = np.fromiter((len(f) for f in mb.f), dtype=np.int64, count=len(mb.f))
        flat = np.array([c for uv in uvs for c in uv], dtype=np.float64).reshape(-1, 2)
        isl = np.repeat(np.asarray(mb.fisl, dtype=np.int64), counts)
        uniq, inv = np.unique(isl, return_inverse=True)
        lo = np.full((len(uniq), 2), np.inf)
        hi = np.full((len(uniq), 2), -np.inf)
        np.minimum.at(lo, inv, flat)
        np.maximum.at(hi, inv, flat)
        per_builder.append((flat, inv, lo, hi))
        for k in range(len(uniq)):
            rects.append((bi, k, lo[k, 0], lo[k, 1], hi[k, 0] - lo[k, 0], hi[k, 1] - lo[k, 1]))
    if not rects:
        return 0.0
    W = np.array([r[4] for r in rects])
    H = np.array([r[5] for r in rects])

    def place(density):
        wp = np.maximum(np.ceil(W * density), min_px) + 2 * margin
        hp = np.maximum(np.ceil(H * density), min_px) + 2 * margin
        rot = hp > wp
        rw, rh = np.where(rot, hp, wp), np.where(rot, wp, hp)
        if rw.max() > size:
            return None
        order = np.lexsort((-rw, -rh))
        pos = np.zeros((len(rects), 2))
        x = y = shelf = 0.0
        for i in order:
            if x + rw[i] > size:
                y += shelf
                x, shelf = 0.0, 0.0
            if y + rh[i] > size:
                return None
            pos[i] = (x, y)
            x += rw[i]
            shelf = max(shelf, rh[i])
        return pos, rot

    area = float(((W + 0.01) * (H + 0.01)).sum())
    hi_d = math.sqrt(size * size / max(area, 1e-9)) * 1.2
    lo_d = hi_d * 0.05
    best = None
    for _ in range(22):
        mid = (lo_d + hi_d) / 2
        got = place(mid)
        if got is None:
            hi_d = mid
        else:
            lo_d, best = mid, got
    if best is None:
        raise RuntimeError("atlas packing failed")
    density = lo_d
    pos, rot = best
    used = float((np.maximum(np.ceil(W * density), min_px) * np.maximum(np.ceil(H * density), min_px)).sum())
    pack_atlas.last = {"islands": len(rects), "fill": used / (size * size)}
    starts = np.cumsum([0] + [len(np.unique(np.asarray(mb.fisl))) for mb in builders])
    for bi, mb in enumerate(builders):
        flat, inv, lo, hi = per_builder[bi]
        idx = starts[bi] + inv
        du = (flat[:, 0] - lo[inv, 0]) * density
        dv = (flat[:, 1] - lo[inv, 1]) * density
        r = rot[idx]
        px = pos[idx, 0] + margin + np.where(r, dv, du)
        py = pos[idx, 1] + margin + np.where(r, du, dv)
        mb.bake_uv = np.stack([px / size, py / size], 1).astype(np.float32)
    return density


# ------------------------------------------------------------------ curves
def arc(center, radius, a0, a1, n, plane=("x", "z"), fixed=None):
    """Points on a circular arc in a coordinate plane. fixed = dict of the third axis value."""
    out = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        p = {"x": 0.0, "y": 0.0, "z": 0.0}
        p.update(fixed or {})
        p[plane[0]] = center[0] + radius * math.cos(a)
        p[plane[1]] = center[1] + radius * math.sin(a)
        out.append(Vector((p["x"], p["y"], p["z"])))
    return out


def spiral(center, r0, r1, a0, turns, n=40, sign=1):
    """2D logarithmic-ish spiral from radius r0 (outside) to r1 (inside)."""
    out = []
    for i in range(n + 1):
        t = i / n
        r = r0 * (r1 / r0) ** t
        a = a0 + sign * turns * 2 * math.pi * t
        out.append((center[0] + r * math.cos(a), center[1] + r * math.sin(a)))
    return out


def resample(pts, step):
    """Resample a polyline to roughly uniform spacing."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = (b - a).length
        if seg < 1e-9:
            continue
        d = step - acc
        while d <= seg:
            out.append(a.lerp(b, d / seg))
            d += step
        acc = seg - (d - step)
    if (out[-1] - pts[-1]).length > step * 0.3:
        out.append(pts[-1])
    return out
