"""2D outlines and the meshes built from them (prisms, bands, walls, text)."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from ddd import geo


# --- 2D outlines ----------------------------------------------------------
def area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def ccw(pts):
    pts = [tuple(p[:2]) for p in pts]
    return pts if area(pts) > 0 else pts[::-1]


def circle(cx, cy, r, n=32, a0=0.0):
    return [(cx + r * math.cos(a0 + 2 * math.pi * k / n), cy + r * math.sin(a0 + 2 * math.pi * k / n)) for k in range(n)]


def arc(cx, cy, r, a0_deg, a1_deg, n=32):
    return [(cx + r * math.cos(math.radians(a0_deg + (a1_deg - a0_deg) * k / n)), cy + r * math.sin(math.radians(a0_deg + (a1_deg - a0_deg) * k / n))) for k in range(n + 1)]


def transform(pts, x=0.0, y=0.0, rot_deg=0.0, scale=1.0):
    c, s = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    return [(x + (px * c - py * s) * scale, y + (px * s + py * c) * scale) for px, py in pts]


def fillet(pts, r, n=5):
    """Round every corner of a closed polygon."""
    out = []
    N = len(pts)
    for i in range(N):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % N])
        d1, d2 = (p0 - p1), (p2 - p1)
        l1, l2 = d1.length, d2.length
        d1.normalize()
        d2.normalize()
        ang = math.acos(max(-1.0, min(1.0, d1.dot(d2))))
        if ang < 1e-3 or ang > math.pi - 1e-3:
            out.append(tuple(p1))
            continue
        t = min(r / math.tan(ang / 2), l1 * 0.45, l2 * 0.45)
        rr = t * math.tan(ang / 2)
        a, b = p1 + d1 * t, p1 + d2 * t
        c = p1 + (d1 + d2).normalized() * (rr / math.sin(ang / 2))
        a0 = math.atan2(a.y - c.y, a.x - c.x)
        a1 = math.atan2(b.y - c.y, b.x - c.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for k in range(n + 1):
            u = a0 + da * k / n
            out.append((c.x + rr * math.cos(u), c.y + rr * math.sin(u)))
    return out


def offset(pts, d, closed=True):
    """Miter offset; d > 0 grows a CCW polygon."""
    N = len(pts)
    out = []
    for i in range(N):
        if closed:
            a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % N])
        else:
            a = Vector(pts[max(0, i - 1)]) if i > 0 else Vector(pts[i]) * 2 - Vector(pts[i + 1])
            b = Vector(pts[i])
            c = Vector(pts[i + 1]) if i < N - 1 else Vector(pts[i]) * 2 - Vector(pts[i - 1])
        e1, e2 = (b - a).normalized(), (c - b).normalized()
        n1, n2 = Vector((e1.y, -e1.x)), Vector((e2.y, -e2.x))
        m = n1 + n2
        m = n1 if m.length < 1e-6 else m.normalized()
        k = d / max(0.35, m.dot(n1))
        out.append(tuple(b + m * k))
    return out


def ribbon(line, width):
    """Closed outline of a polyline thickened to `width`."""
    left = offset(line, width / 2, closed=False)
    right = offset(line, -width / 2, closed=False)
    return ccw(left + right[::-1])


def hull2(c1, r1, c2, r2, n=16):
    """Rounded bar between two circles (flipper bats, lane guides)."""
    a = math.atan2(c2[1] - c1[1], c2[0] - c1[0])
    pts = []
    for k in range(n + 1):
        u = a + math.pi / 2 + math.pi * k / n
        pts.append((c1[0] + r1 * math.cos(u), c1[1] + r1 * math.sin(u)))
    for k in range(n + 1):
        u = a - math.pi / 2 + math.pi * k / n
        pts.append((c2[0] + r2 * math.cos(u), c2[1] + r2 * math.sin(u)))
    return ccw(pts)


def star(cx, cy, r_out, r_in, points=5, rot_deg=90.0):
    pts = []
    for k in range(points * 2):
        r = r_out if k % 2 == 0 else r_in
        a = math.radians(rot_deg) + math.pi * k / points
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def insert_shape(kind, s):
    """Unit insert outlines, pointing +y, sized by `s` (overall height)."""
    if kind == "circle":
        return circle(0, 0, s / 2, 28)
    if kind == "oval":
        return [(p[0] * 1.7, p[1]) for p in circle(0, 0, s / 2, 32)]
    if kind == "arrow":
        return [(0, s * 0.55), (s * 0.42, s * 0.08), (s * 0.18, s * 0.08), (s * 0.18, -s * 0.45), (-s * 0.18, -s * 0.45), (-s * 0.18, s * 0.08), (-s * 0.42, s * 0.08)]
    if kind == "triangle":
        return [(0, s * 0.55), (s * 0.52, -s * 0.35), (-s * 0.52, -s * 0.35)]
    if kind == "rect":
        return [(-s * 0.3, -s * 0.5), (s * 0.3, -s * 0.5), (s * 0.3, s * 0.5), (-s * 0.3, s * 0.5)]
    if kind == "star":
        return star(0, 0, s * 0.55, s * 0.24)
    if kind == "chevron":
        return [(-0.5 * s, -0.3 * s), (0, 0.18 * s), (0.5 * s, -0.3 * s), (0.5 * s, -0.04 * s), (0, 0.45 * s), (-0.5 * s, -0.04 * s)]
    if kind == "diamond":
        return [(0, s * 0.5), (s * 0.34, 0), (0, -s * 0.5), (-s * 0.34, 0)]
    raise ValueError(kind)


# --- meshes ---------------------------------------------------------------
def flat(name, pts, z=0.0, coll=None):
    """A single upward-facing polygon."""
    pts = ccw(pts)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x, y in pts]
    bm.faces.new(vs)
    return geo.obj_from_bmesh(name, bm, coll)


def band(name, outer, inner, z=0.0, coll=None):
    """Flat ring between two closed outlines with equal point counts."""
    bm = bmesh.new()
    vo = [bm.verts.new((x, y, z)) for x, y in outer]
    vi = [bm.verts.new((x, y, z)) for x, y in inner]
    n = len(vo)
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((vo[i], vo[j], vi[j], vi[i]))
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    return geo.obj_from_bmesh(name, bm, coll)


def prism(name, pts, z0, z1, bevel=0.0, segments=2, coll=None, smooth_deg=40):
    pts = ccw(pts)
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, z0)) for x, y in pts]
    vt = [bm.verts.new((x, y, z1)) for x, y in pts]
    bm.faces.new(vt)
    bm.faces.new(vb[::-1])
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    o = geo.obj_from_bmesh(name, bm, coll)
    if bevel > 0:
        m = geo.modifier(o, "BEVEL", width=bevel, segments=segments, limit_method="ANGLE")
        m.angle_limit = math.radians(50)
        m.harden_normals = False
        geo.apply_all(o)
    geo.smooth(o, smooth_deg)
    return o


def cylinder(name, x, y, z0, z1, r, segments=24, r_top=None, coll=None, bevel=0.0):
    o = geo.primitive("cylinder", name, coll, radius=r, radius2=r if r_top is None else r_top, depth=z1 - z0, segments=segments)
    o.data.transform(Matrix.Translation((x, y, (z0 + z1) / 2)))
    if bevel > 0:
        m = geo.modifier(o, "BEVEL", width=bevel, segments=2, limit_method="ANGLE")
        m.angle_limit = math.radians(50)
        geo.apply_all(o)
    geo.smooth(o, 45)
    return o


def sphere(name, p, r, u=32, v=16, coll=None):
    o = geo.primitive("sphere", name, coll, radius=r, u=u, v=v)
    o.data.transform(Matrix.Translation(p))
    geo.smooth(o, 180)
    return o


def box(name, x0, x1, y0, y1, z0, z1, bevel=0.0, coll=None):
    return prism(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, bevel=bevel, coll=coll)


def tube(name, pts, r, segments=10, closed=False, coll=None):
    o = geo.tube(name, pts, radius=r, segments=segments, closed=closed, coll=coll)
    geo.smooth(o, 180)
    return o


_fonts = {}


def font(path):
    f = _fonts.get(path)
    try:
        f = f if f is not None and f.name else None
    except ReferenceError:
        f = None
    if f is None:
        f = _fonts[path] = bpy.data.fonts.load(str(path), check_existing=True)
    return f


def text(name, body, font_path, size, x, y, z=0.0, rot_deg=0.0, align="CENTER", offset_=0.0, shear=0.0, spacing=1.0, extrude=0.0, coll=None, valign="CENTER"):
    """Text as a flat (or extruded) mesh, centred on (x, y) by default."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = font(font_path)
    cu.size = size
    cu.align_x = align
    cu.align_y = valign
    cu.offset = offset_
    cu.shear = shear
    cu.space_character = spacing
    cu.extrude = extrude
    cu.resolution_u = 6
    tmp = bpy.data.objects.new(name + "_crv", cu)
    bpy.context.scene.collection.objects.link(tmp)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    me.transform(Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(rot_deg), 4, "Z"))
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o
