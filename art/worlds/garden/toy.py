"""Toy-box helpers shared by the homepage scenes (garden, bubbles).

Figma-ad inflatables: a 2D outline becomes a rounded slab (curve fill +
bevel), is voxel-remeshed into an even quad skin, and is then puffed up with
the cloth-pressure sim in ddd.inflate. Seams are pinched in afterwards and
floating pieces droop a little under their own weight.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from ddd import geo, inflate, mat


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# --------------------------------------------------------------------------
# 2D outlines (lists of (x, y), counter-clockwise, closed implicitly)
def resample(pts, step):
    """Even spacing along a closed polyline."""
    out = []
    n = len(pts)
    for i in range(n):
        a = Vector(pts[i])
        b = Vector(pts[(i + 1) % n])
        k = max(1, int(math.ceil((b - a).length / step)))
        for j in range(k):
            out.append(tuple(a.lerp(b, j / k)))
    return out


def chaikin(pts, iterations=3):
    for _ in range(iterations):
        out = []
        n = len(pts)
        for i in range(n):
            a = Vector(pts[i])
            b = Vector(pts[(i + 1) % n])
            out.append(tuple(a.lerp(b, 0.25)))
            out.append(tuple(a.lerp(b, 0.75)))
        pts = out
    return pts


def rounded(pts, radius, iterations=3):
    """Round every corner by roughly `radius`."""
    return chaikin(resample(pts, radius), iterations)


def star_outline(points=5, r_out=1.0, r_in=0.5, sharp=1.6, samples=360):
    """Soft star: tips and valleys both rounded (polar blend)."""
    out = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        k = (0.5 + 0.5 * math.cos(points * t)) ** sharp
        r = r_in + (r_out - r_in) * k
        a = t + math.pi / 2
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def superellipse(a=1.0, b=1.0, p=4.0, samples=160, cx=0.0, cy=0.0):
    out = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** (2 / p), c)
        y = b * math.copysign(abs(s) ** (2 / p), s)
        out.append((cx + x, cy + y))
    return out


def letter_d(h=1.0, w=0.82, stroke=0.3, round_r=0.06):
    """Outer contour and counter of a chunky geometric D (height h)."""

    def contour(x0, y0, x1, y1):
        # Flat left stem, straight top/bottom to the bowl, elliptical bowl on the right.
        ry = (y1 - y0) / 2
        cy = (y0 + y1) / 2
        bowl_x = x1 - ry * 0.95
        pts = [(x0, y0), (bowl_x, y0)]
        for i in range(1, 48):
            t = -math.pi / 2 + math.pi * i / 48
            pts.append((bowl_x + (x1 - bowl_x) * math.cos(t), cy + ry * math.sin(t)))
        pts += [(bowl_x, y1), (x0, y1)]
        return pts

    outer = contour(0.0, 0.0, w, h)
    inner = contour(stroke, stroke * 0.95, w - stroke * 0.92, h - stroke * 0.95)
    outer = rounded(outer, round_r)
    inner = list(reversed(rounded(inner, round_r * 0.7)))
    return outer, inner


def arch_outline(width=4.0, height=4.6, opening=2.2, open_h=3.2, samples=48):
    """Inverted U: two legs and a round crown, as one closed contour."""
    R = width / 2
    r = opening / 2
    leg_top = height - R
    in_top = open_h - r
    pts = [(-R, 0.0), (-r, 0.0), (-r, in_top)]
    for i in range(1, samples):
        t = math.pi - math.pi * i / samples
        pts.append((r * math.cos(t), in_top + r * math.sin(t)))
    pts += [(r, in_top), (r, 0.0), (R, 0.0), (R, leg_top)]
    for i in range(1, samples):
        t = math.pi * i / samples
        pts.append((R * math.cos(t), leg_top + R * math.sin(t)))
    pts.append((-R, leg_top))
    return rounded(pts, 0.14)


def heart_outline(size=1.0, samples=200):
    out = []
    for i in range(samples):
        t = 2 * math.pi * i / samples
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        out.append((x / 17 * size, y / 17 * size))
    return chaikin(out, 1)


def speech_outline(a=1.0, b=0.72, p=3.2, tail=(-0.55, -1.0), tail_at=-0.62, tail_w=0.34, samples=220):
    """Rounded bubble with a tail. tail_at is the angle (x pi) where the tail leaves the rim."""
    body = superellipse(a, b, p, samples)
    ang = [math.atan2(y / b, x / a) for x, y in body]
    c = tail_at * math.pi
    out = []
    inserted = False
    for (x, y), t in zip(body, ang):
        d = math.atan2(math.sin(t - c), math.cos(t - c))
        if abs(d) < tail_w:
            if not inserted:
                out.append((tail[0] * a, tail[1] * b))
                inserted = True
            continue
        out.append((x, y))
    return rounded(out, 0.05 * a, 3)


# --------------------------------------------------------------------------
# Solids
def slab(name, contours, thickness=0.4, bevel=0.12, resolution=6, coll=None):
    """Filled 2D contours (first = outer, rest = holes) -> rounded solid mesh in XZ (facing -Y)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = max(0.0, thickness / 2 - bevel)
    cu.bevel_depth = bevel
    cu.bevel_resolution = resolution
    cu.resolution_u = 1
    for c in contours:
        sp = cu.splines.new("POLY")
        sp.points.add(len(c) - 1)
        for p, (x, y) in zip(sp.points, c):
            p.co = (x, y, 0.0, 1.0)
        sp.use_cyclic_u = True
    tmp = bpy.data.objects.new(name + "_curve", cu)
    (coll or bpy.context.scene.collection).objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    # Stand the outline up: curve XY -> world XZ, thickness along Y.
    o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    return o


def remesh(obj, voxel):
    m = obj.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.adaptivity = 0.0
    if hasattr(m, "use_smooth_shade"):
        m.use_smooth_shade = True
    geo.apply_all(obj)
    return obj


def puff(obj, voxel, pressure=5.0, frames=30, stiffness=10.0, shrink=0.0):
    """Even skin + cloth-pressure inflation (ddd.inflate)."""
    remesh(obj, voxel)
    inflate.inflate(obj, pressure=pressure, frames=frames, stiffness=stiffness, shrink=shrink)
    geo.smooth(obj, 180)
    return obj


def relax(obj, iterations=4, factor=0.5):
    m = obj.modifiers.new("relax", "SMOOTH")
    m.factor = factor
    m.iterations = iterations
    geo.apply_all(obj)
    return obj


def seam(obj, depth=0.03, width=0.035, axis=1, center=None):
    """Pinch a welded seam where the two halves meet (plane axis = const)."""
    me = obj.data
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    c = center if center is not None else sum((v.co[axis] for v in me.vertices), 0.0) / max(1, len(me.vertices))
    for v in me.vertices:
        d = (v.co[axis] - c) / width
        k = math.exp(-d * d)
        if k > 1e-3:
            n = Vector(v.normal)
            n[axis] = 0.0
            if n.length > 1e-6:
                v.co -= n.normalized() * depth * k
    me.update()
    return obj


def ring_seam(obj, depth=0.02, width=0.03, radius_fn=None):
    """Seam around a torus-like ring at the outer equator (z = 0)."""
    return seam(obj, depth=depth, width=width, axis=2, center=0.0)


def droop(obj, amount=0.1, span=None, axis=0):
    """Sag the ends of a floating inflatable (quadratic in distance from its middle)."""
    me = obj.data
    xs = [v.co[axis] for v in me.vertices]
    mid = (max(xs) + min(xs)) / 2
    half = span or max(1e-6, (max(xs) - min(xs)) / 2)
    for v in me.vertices:
        d = (v.co[axis] - mid) / half
        v.co.z -= amount * d * d
    me.update()
    return obj


def ground(obj):
    """Move the mesh so its lowest point sits on z = 0 and it's centred in x/y."""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zmin = min(v.co.z for v in me.vertices)
    me.transform(Matrix.Translation((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, -zmin)))
    return obj


def center(obj):
    me = obj.data
    lo = Vector([min(v.co[i] for v in me.vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in me.vertices) for i in range(3)])
    me.transform(Matrix.Translation(-(lo + hi) / 2))
    return obj


def decimate_to(obj, tris):
    now = geo.triangle_count(obj)
    if now > tris * 1.05:
        geo.decimate(obj, tris / now)
        geo.apply_all(obj)
    geo.smooth(obj, 180)
    return obj


def capsule(name, radius=0.5, length=1.4, u=48, v=24):
    """Capsule along X."""
    bm = bmesh.new()
    rings = []
    half = length / 2 - radius
    for j in range(v + 1):
        t = math.pi * j / v
        # Hemisphere rings with a duplicated equator (cylinder section).
        for side in ((0,) if j != v // 2 else (0, 1)):
            x = -math.cos(t) * radius + (half if (j > v // 2 or (j == v // 2 and side)) else -half)
            r = math.sin(t) * radius
            ring = [bm.verts.new((x, r * math.cos(2 * math.pi * i / u), r * math.sin(2 * math.pi * i / u))) for i in range(u)]
            rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(u):
            bm.faces.new((a[i], a[(i + 1) % u], b[(i + 1) % u], b[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return geo.obj_from_bmesh(name, bm)


def rounded_box(name, size=(1, 1, 1), radius=0.1, segments=4):
    o = geo.primitive("cube", name, size=1.0)
    o.data.transform(Matrix.Diagonal((*size, 1.0)))
    m = geo.bevel(o, width=radius, segments=segments, angle_deg=30)
    m.limit_method = "NONE"
    geo.apply_all(o)
    geo.smooth(o, 35)
    return o


def plinth(name, radius=1.0, height=0.8, steps=1, step_in=0.14, segments=96, bevel=0.03):
    """Round clay plinth with optional stepped base; base at z = 0 (continues 0.6 below the waterline)."""
    parts = []
    below = 0.25
    for k in range(steps):
        r = radius + step_in * (steps - 1 - k)
        h = height * (k + 1) / steps
        c = geo.primitive("cylinder", f"{name}_{k}", radius=r, depth=h + below, segments=segments)
        c.location.z = (h - below) / 2
        m = geo.bevel(c, width=bevel, segments=3, angle_deg=40)
        m.limit_method = "ANGLE"
        parts.append(c)
    o = geo.join(parts, name) if len(parts) > 1 else parts[0]
    geo.apply_all(o)
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    geo.smooth(o, 40)
    return o


# --------------------------------------------------------------------------
# Cycles materials
def _link(m, a, b):
    m.node_tree.links.new(a, b)


def vinyl(name, color, rough=0.3, coat=1.0, sheen=0.25, night_rim=None, rim_strength=6.0, inner=None, inner_strength=0.0):
    """Glossy inflatable vinyl. Optional neon rim (fresnel emission) and inner glow (facing emission)."""
    m = mat.principled(name, base=color, rough=rough, coat=coat, coat_rough=0.05, sheen=sheen, sheen_rough=0.35, specular=0.55, subsurface=0.06, subsurface_scale=0.15)
    b = mat.bsdf_of(m)
    b.inputs["Subsurface Radius"].default_value = (1.0, 0.5, 0.35)
    if night_rim is not None or inner is not None:
        nt = m.node_tree
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.22
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        pw = nt.nodes.new("ShaderNodeMath")
        pw.operation = "POWER"
        pw.inputs[1].default_value = 3.0
        _link(m, lw.outputs["Facing"], pw.inputs[0])
        _link(m, pw.outputs[0], mix.inputs["Factor"])
        mix.inputs["A"].default_value = (*(inner or (0, 0, 0)), 1)
        mix.inputs["B"].default_value = (*(night_rim or (0, 0, 0)), 1)
        _link(m, mix.outputs["Result"], b.inputs["Emission Color"])
        # Strength: rim end uses rim_strength, centre uses inner_strength.
        st = nt.nodes.new("ShaderNodeMapRange")
        st.inputs["To Min"].default_value = inner_strength
        st.inputs["To Max"].default_value = rim_strength
        _link(m, pw.outputs[0], st.inputs["Value"])
        _link(m, st.outputs["Result"], b.inputs["Emission Strength"])
    return m


def clay(name, color, rough=0.72, bump=0.12):
    m = mat.principled(name, base=color, rough=rough, sheen=0.35, sheen_rough=0.5, specular=0.35)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 60.0
    nz.inputs["Detail"].default_value = 6.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.004
    _link(m, tc.outputs["Object"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], bp.inputs["Height"])
    _link(m, bp.outputs["Normal"], mat.bsdf_of(m).inputs["Normal"])
    return m


def frosted(name, tint=(1, 1, 1), rough=0.26, glow=None, glow_strength=0.0):
    m = mat.principled(name, base=tint, transmission=1.0, rough=rough, ior=1.45, specular=0.5)
    if glow is not None:
        b = mat.bsdf_of(m)
        b.inputs["Emission Color"].default_value = (*glow, 1)
        b.inputs["Emission Strength"].default_value = glow_strength
    return m


def chrome(name, tint=(0.96, 0.96, 0.98), rough=0.04):
    return mat.principled(name, base=tint, metal=1.0, rough=rough)


def neon(name, color, strength=12.0):
    return mat.emission(name, color, strength)


def water(name, tint, rough=0.015, ripple=0.04, scale=3.0):
    """Mirror-still pool: dielectric with a deep tint and a whisper of ripple bump."""
    m = mat.principled(name, base=tint, rough=rough, ior=1.5, specular=1.0, coat=0.0)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 3.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = ripple
    bp.inputs["Distance"].default_value = 0.02
    _link(m, tc.outputs["Object"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], bp.inputs["Height"])
    _link(m, bp.outputs["Normal"], mat.bsdf_of(m).inputs["Normal"])
    return m


# --------------------------------------------------------------------------
# World: a vertical pastel gradient (what the camera and reflections see),
# optionally with stars and a studio HDRI that only lights glossy bounces.
def gradient_world(stops, strength=1.0, stars=0.0, hdri=None, hdri_strength=0.4, hdri_rot=0.0):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[1][0], (*stops[1][1], 1)
    for pos, col in stops[2:]:
        e = els.new(pos)
        e.color = (*col, 1)
    # Map z in [-1, 1] -> [0, 1].
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    col = ramp.outputs["Color"]
    if stars > 0:
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.feature = "DISTANCE_TO_EDGE" if False else "F1"
        vor.inputs["Scale"].default_value = 260.0
        nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
        st = nt.nodes.new("ShaderNodeMapRange")
        st.inputs["From Min"].default_value = 0.06
        st.inputs["From Max"].default_value = 0.0
        st.inputs["To Max"].default_value = stars
        nt.links.new(vor.outputs["Distance"], st.inputs["Value"])
        # Only above the horizon.
        up = nt.nodes.new("ShaderNodeMapRange")
        up.inputs["From Min"].default_value = 0.02
        up.inputs["From Max"].default_value = 0.3
        nt.links.new(sep.outputs["Z"], up.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(st.outputs["Result"], mul.inputs[0])
        nt.links.new(up.outputs["Result"], mul.inputs[1])
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "MULTIPLY"
        nt.links.new(mul.outputs[0], rnd.inputs[0])
        nt.links.new(vor.outputs["Color"], rnd.inputs[1])
        add = nt.nodes.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = 1.0
        nt.links.new(col, add.inputs["A"])
        nt.links.new(rnd.outputs[0], add.inputs["B"])
        col = add.outputs["Result"]
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(col, bg.inputs["Color"])
    shader = bg.outputs[0]
    if hdri is not None:
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value[2] = math.radians(hdri_rot)
        nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(str(hdri), check_existing=True)
        nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
        hb = nt.nodes.new("ShaderNodeBackground")
        hb.inputs["Strength"].default_value = hdri_strength
        nt.links.new(env.outputs["Color"], hb.inputs["Color"])
        # Glossy bounces off objects see the studio; camera rays and the pool's
        # mirror (singular rays) keep the clean gradient.
        lp = nt.nodes.new("ShaderNodeLightPath")
        mx = nt.nodes.new("ShaderNodeMath")
        mx.operation = "SUBTRACT"
        nt.links.new(lp.outputs["Is Glossy Ray"], mx.inputs[0])
        nt.links.new(lp.outputs["Is Singular Ray"], mx.inputs[1])
        cl = nt.nodes.new("ShaderNodeMath")
        cl.operation = "MAXIMUM"
        cl.inputs[1].default_value = 0.0
        nt.links.new(mx.outputs[0], cl.inputs[0])
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(shader, add.inputs[0])
        nt.links.new(hb.outputs[0], add.inputs[1])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(cl.outputs[0], mix.inputs[0])
        nt.links.new(shader, mix.inputs[1])
        nt.links.new(add.outputs[0], mix.inputs[2])
        shader = mix.outputs[0]
    nt.links.new(shader, out.inputs[0])
    return w


def set_ray_visibility(obj, camera=True, glossy=True, diffuse=True, shadow=True, transmission=True):
    obj.visible_camera = camera
    obj.visible_glossy = glossy
    obj.visible_diffuse = diffuse
    obj.visible_shadow = shadow
    obj.visible_transmission = transmission
