"""Fast mesh accumulation for procedural architecture.

Everything is appended to flat Python lists and turned into one Blender mesh
with from_pydata at the end, which is orders of magnitude faster than building
thousands of small bmesh objects and joining them.
"""

import math

import bpy
from mathutils import Matrix, Vector


class MeshBuilder:
    def __init__(self):
        self.v = []
        self.f = []
        self.mi = []
        self.col = []  # per-vertex RGB (optional variation, 0..1)

    # ---------------------------------------------------------------- basics
    def vert(self, p, c=(1.0, 1.0, 1.0)):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        self.col.append(c)
        return len(self.v) - 1

    def face(self, idx, mat=0):
        self.f.append(tuple(idx))
        self.mi.append(mat)

    def extend(self, other, matrix=None, mat_offset=0):
        base = len(self.v)
        if matrix is None:
            self.v.extend(other.v)
        else:
            m = Matrix(matrix)
            self.v.extend(tuple(m @ Vector(p)) for p in other.v)
        self.col.extend(other.col)
        self.f.extend(tuple(i + base for i in f) for f in other.f)
        self.mi.extend(m + mat_offset for m in other.mi)

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
        ids = [self.vert(Vector((cx, cy, cz)) + m @ Vector(p), c) for p in corners]
        for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.face([ids[i] for i in q], mat)

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
        for i in range(len(rings) - 1):
            r0, r1 = rings[i], rings[i + 1]
            for j in range(segments):
                k = (j + 1) % segments
                self.face((r0[j], r0[k], r1[k], r1[j]), mat)
        if cap_bottom:
            self.face(list(reversed(rings[0])), mat)
        if cap_top:
            self.face(rings[-1], mat)
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
        count = len(rings) if closed else len(rings) - 1
        for i in range(count):
            r0, r1 = rings[i], rings[(i + 1) % len(rings)]
            for j in range(m):
                k = (j + 1) % m
                self.face((r0[j], r0[k], r1[k], r1[j]), mat)
        if caps and not closed:
            self.face(list(reversed(rings[0])), mat)
            self.face(rings[-1], mat)

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
        if smooth_angle is not None:
            me.shade_smooth()
            if hasattr(me, "set_sharp_from_angle"):
                me.set_sharp_from_angle(angle=math.radians(smooth_angle))
        o = bpy.data.objects.new(name, me)
        (coll or bpy.context.scene.collection).objects.link(o)
        return o


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
