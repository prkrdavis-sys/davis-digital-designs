"""Classical architecture kit shared by the doors corridor and the museum hall:
fluted columns, round-arch outlines, voussoir arches, stepped plinths,
coffers, and a few material builders. Blender units are meters, Z up."""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from ddd import geo, mat


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# --------------------------------------------------------------------------
# Solids
def box(name, size, loc=(0, 0, 0), bevel=0.0, segments=2, coll=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    o = geo.obj_from_bmesh(name, bm, coll)
    if bevel > 0:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = segments
        m.limit_method = "ANGLE"
        geo.apply_all(o)
    return o


def cylinder(name, radius, depth, loc=(0, 0, 0), segments=48, radius2=None, caps=True, coll=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segments, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return geo.obj_from_bmesh(name, bm, coll)


def lathe(name, profile, segments=48, loc=(0, 0, 0), coll=None):
    """Revolve a (radius, z) profile around Z. Profile runs bottom -> top."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            ring.append(bm.verts.new((loc[0] + r * math.cos(a), loc[1] + r * math.sin(a), loc[2] + z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(segments):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % segments], rings[i + 1][(j + 1) % segments], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm, coll)
    geo.smooth(o, 35)
    return o


def column(name, height, radius, loc=(0, 0, 0), flutes=20, order="doric", coll=None):
    """Fluted column with torus base, square plinth and capital. Returns one joined object."""
    x, y, z = loc
    parts = []
    plinth_h = radius * 0.45
    parts.append(box(f"{name}_plinth", (radius * 2.7, radius * 2.7, plinth_h), (x, y, z + plinth_h / 2), bevel=0.012))
    base = [(radius * 1.25, 0), (radius * 1.3, radius * 0.08), (radius * 1.28, radius * 0.2), (radius * 1.12, radius * 0.3), (radius * 1.06, radius * 0.36), (radius * 1.15, radius * 0.46), (radius * 1.1, radius * 0.56), (radius * 1.02, radius * 0.62)]
    parts.append(lathe(f"{name}_base", base, 48, (x, y, z + plinth_h)))
    shaft_z0 = z + plinth_h + radius * 0.62
    cap_h = radius * (1.2 if order == "ionic" else 0.9)
    shaft_h = height - (shaft_z0 - z) - cap_h
    # Shaft: entasis (gentle taper) and flutes carved by modulating the radius.
    seg = flutes * 4
    rings = 10
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        t = i / rings
        rr = radius * (1.0 - 0.12 * t * t)
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            k = (j % 4) / 4
            flute = 1.0 - 0.055 * math.sin(math.pi * k) ** 0.8
            ring.append(bm.verts.new((x + rr * flute * math.cos(a), y + rr * flute * math.sin(a), shaft_z0 + shaft_h * t)))
        grid.append(ring)
    for i in range(rings):
        for j in range(seg):
            bm.faces.new((grid[i][j], grid[i][(j + 1) % seg], grid[i + 1][(j + 1) % seg], grid[i + 1][j]))
    shaft = geo.obj_from_bmesh(f"{name}_shaft", bm)
    geo.smooth(shaft, 50)
    parts.append(shaft)
    top_r = radius * 0.88
    cz = shaft_z0 + shaft_h
    if order == "ionic":
        cap = [(top_r, 0), (top_r * 1.08, cap_h * 0.1), (top_r * 1.02, cap_h * 0.18), (top_r * 1.2, cap_h * 0.35), (top_r * 1.28, cap_h * 0.55), (top_r * 1.2, cap_h * 0.62)]
        parts.append(lathe(f"{name}_echinus", cap, 48, (x, y, cz)))
        # Volutes: a pair of scroll cylinders under the abacus.
        for s in (-1, 1):
            v = cylinder(f"{name}_vol{s}", radius * 0.32, radius * 2.2, (0, 0, 0), segments=32)
            v.rotation_euler = (0, math.pi / 2, 0)
            v.location = (x, y + s * radius * 0.95, cz + cap_h * 0.55)
            v.data.transform(v.matrix_world)
            v.matrix_world = Matrix.Identity(4)
            geo.smooth(v, 40)
            parts.append(v)
        parts.append(box(f"{name}_abacus", (radius * 2.5, radius * 2.5, cap_h * 0.3), (x, y, cz + cap_h * 0.85), bevel=0.01))
    else:
        cap = [(top_r, 0), (top_r * 1.06, cap_h * 0.08), (top_r, cap_h * 0.16), (top_r * 1.05, cap_h * 0.22), (top_r * 1.35, cap_h * 0.55), (top_r * 1.42, cap_h * 0.66)]
        parts.append(lathe(f"{name}_echinus", cap, 48, (x, y, cz)))
        parts.append(box(f"{name}_abacus", (radius * 2.8, radius * 2.8, cap_h * 0.34), (x, y, cz + cap_h * 0.83), bevel=0.01))
    return geo.join(parts, name)


def moulding(name, length, profile, loc=(0, 0, 0), axis="Y", coll=None):
    """Extrude a 2D (out, up) profile along an axis. `out` points +X for axis Y."""
    bm = bmesh.new()
    rows = []
    for t in (0.0, 1.0):
        row = []
        for u, v in profile:
            if axis == "Y":
                p = (loc[0] + u, loc[1] + length * t, loc[2] + v)
            else:
                p = (loc[0] + length * t, loc[1] + u, loc[2] + v)
            row.append(bm.verts.new(p))
        rows.append(row)
    n = len(profile)
    for j in range(n - 1):
        bm.faces.new((rows[0][j], rows[0][j + 1], rows[1][j + 1], rows[1][j]))
    bm.faces.new(list(reversed(rows[0])))
    bm.faces.new(rows[1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm, coll)
    geo.smooth(o, 30)
    return o


def steps(name, width, depth, count, rise, run, loc=(0, 0, 0), bevel=0.01):
    """Stacked slabs, largest at the bottom, centred on loc (XY) sitting on loc.z."""
    parts = []
    for i in range(count):
        w = width + (count - 1 - i) * run * 2
        d = depth + (count - 1 - i) * run * 2
        parts.append(box(f"{name}_{i}", (w, d, rise), (loc[0], loc[1], loc[2] + rise * (i + 0.5)), bevel=bevel))
    return geo.join(parts, name)


# --------------------------------------------------------------------------
# Round arches. Local 2D: x across, z up, opening half-width w, spring height h.
def arch_outline(w, h, offset=0.0, n_arc=32, base=0.0):
    """Points from bottom-left, up, over the semicircle, down to bottom-right."""
    r = w + offset
    pts = [(-r, base)]
    for i in range(n_arc + 1):
        a = math.pi - math.pi * i / n_arc
        pts.append((r * math.cos(a), h + r * math.sin(a)))
    pts.append((r, base))
    return pts


def arch_path(w, h, offset=0.0, n_arc=32, base=0.0, step=None):
    """Like arch_outline but with the straight legs subdivided (for tubes, bulbs, scatter)."""
    r = w + offset
    pts = []
    legs = max(2, int((h - base) / (step or 0.25)))
    for i in range(legs):
        pts.append((-r, base + (h - base) * i / legs))
    for i in range(n_arc + 1):
        a = math.pi - math.pi * i / n_arc
        pts.append((r * math.cos(a), h + r * math.sin(a)))
    for i in range(1, legs + 1):
        pts.append((r, h - (h - base) * i / legs))
    return pts


def resample(pts, spacing):
    """Evenly spaced points along a 2D polyline."""
    out = [pts[0]]
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.dist(a, b)
        while acc + seg >= spacing:
            t = (spacing - acc) / seg
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out.append(a)
            seg = math.dist(a, b)
            acc = 0.0
        acc += seg
    return out


def to3(p2, y=0.0):
    return (p2[0], y, p2[1])


def arch_ring(name, w, h, t0, t1, y0, y1, n_arc=40, base=0.0, coll=None):
    """Solid arch frame between offsets t0 (inner) and t1 (outer), depth y0..y1 (front = y0)."""
    inner = arch_outline(w, h, t0, n_arc, base)
    outer = arch_outline(w, h, t1, n_arc, base)
    bm = bmesh.new()
    vi0 = [bm.verts.new(to3(p, y0)) for p in inner]
    vo0 = [bm.verts.new(to3(p, y0)) for p in outer]
    vi1 = [bm.verts.new(to3(p, y1)) for p in inner]
    vo1 = [bm.verts.new(to3(p, y1)) for p in outer]
    n = len(inner)
    for i in range(n - 1):
        bm.faces.new((vi0[i], vo0[i], vo0[i + 1], vi0[i + 1]))  # front
        bm.faces.new((vi1[i + 1], vo1[i + 1], vo1[i], vi1[i]))  # back
        bm.faces.new((vi0[i + 1], vi1[i + 1], vi1[i], vi0[i]))  # intrados
        bm.faces.new((vo0[i], vo1[i], vo1[i + 1], vo0[i + 1]))  # extrados
    for k in (0, n - 1):
        bm.faces.new((vi0[k], vi1[k], vo1[k], vo0[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm, coll)
    return o


def voussoirs(name, w, h, r0, r1, y0, y1, count=11, gap=0.012, key_scale=1.25, legs=3, leg_width=None, jitter=0.0, seed=1):
    """Wedge blocks over the semicircle plus stacked ashlar blocks down each leg."""
    rnd = random.Random(seed)
    parts = []
    R0, R1 = w + r0, w + r1
    for i in range(count):
        a0 = math.pi * i / count + gap / R0
        a1 = math.pi * (i + 1) / count - gap / R0
        outer = R1 * (key_scale if i == count // 2 else 1.0)
        bm = bmesh.new()
        segs = 5
        # Inner arc points first, then the outer arc, both from a0 to a1.
        ring = []
        for rad in (R0, outer):
            for k in range(segs + 1):
                a = a0 + (a1 - a0) * k / segs
                ring.append((rad * math.cos(a), h + rad * math.sin(a)))
        n = segs + 1
        vf = [bm.verts.new(to3(p, y0)) for p in ring]
        vb = [bm.verts.new(to3(p, y1)) for p in ring]
        for k in range(segs):
            bm.faces.new((vf[k], vf[k + 1], vf[n + k + 1], vf[n + k]))
            bm.faces.new((vb[n + k], vb[n + k + 1], vb[k + 1], vb[k]))
            bm.faces.new((vf[k + 1], vf[k], vb[k], vb[k + 1]))
            bm.faces.new((vf[n + k], vf[n + k + 1], vb[n + k + 1], vb[n + k]))
        bm.faces.new((vf[0], vf[n], vb[n], vb[0]))
        bm.faces.new((vf[n + segs], vf[segs], vb[segs], vb[n + segs]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = geo.obj_from_bmesh(f"{name}_v{i}", bm)
        if jitter:
            o.location = (rnd.uniform(-jitter, jitter), rnd.uniform(-jitter, jitter) * 2, rnd.uniform(-jitter, jitter))
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = min(0.03, (R1 - R0) * 0.06)
        m.segments = 2
        geo.apply_all(o)
        parts.append(o)
    lw = leg_width or (R1 - R0)
    for s in (-1, 1):
        for k in range(legs):
            z0 = h * k / legs + gap
            z1 = h * (k + 1) / legs - gap
            wide = lw * (1.0 if k % 2 == 0 else 0.82)
            cx = s * (R0 + wide / 2)
            b = box(f"{name}_leg{s}_{k}", (wide, (y1 - y0), z1 - z0), (cx, (y0 + y1) / 2, (z0 + z1) / 2), bevel=min(0.03, wide * 0.05))
            if jitter:
                b.location = (rnd.uniform(-jitter, jitter), rnd.uniform(-jitter, jitter) * 2, 0)
            parts.append(b)
    return geo.join(parts, name)


def arch_panel(name, w, h, y, x0=None, x1=None, n_arc=40, base=0.0):
    """Flat arch-shaped surface (the door opening) at depth y, optionally clipped to x0..x1.
    UV = (x, z) in meters so shaders can compute the arch SDF."""
    x0 = -w if x0 is None else x0
    x1 = w if x1 is None else x1
    cols = max(2, int(round((x1 - x0) / (2 * w) * n_arc)))
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    top = lambda x: h + math.sqrt(max(0.0, w * w - x * x))  # noqa: E731
    rows = 8
    grid = []
    for i in range(cols + 1):
        x = x0 + (x1 - x0) * i / cols
        zt = top(x)
        col = []
        for j in range(rows + 1):
            z = base + (zt - base) * j / rows
            col.append(bm.verts.new((x, y, z)))
        grid.append(col)
    for i in range(cols):
        for j in range(rows):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop in f.loops:
                loop[uv_layer].uv = (loop.vert.co.x, loop.vert.co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return geo.obj_from_bmesh(name, bm)


def place(obj, loc, yaw_deg=0.0):
    """Bake a local-space object into world space at loc rotated about Z."""
    m = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
    obj.data.transform(m @ obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    return obj


# --------------------------------------------------------------------------
# Cycles materials (the corridor/hall shells are baked, so procedural is fine there).
def _nt(name):
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def marble(name, base, vein, scale=1.2, rough=0.18, coat=0.0, vein_amount=0.55):
    """Principled marble: warped noise veins mixed over a base color."""
    m, nt, out = _nt(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    warp = nt.nodes.new("ShaderNodeTexNoise")
    warp.inputs["Scale"].default_value = scale * 1.6
    warp.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], warp.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 9.0
    wave.inputs["Detail"].default_value = 6
    wave.inputs["Detail Scale"].default_value = 1.4
    mix_v = nt.nodes.new("ShaderNodeMix")
    mix_v.data_type = "VECTOR"
    mix_v.inputs["Factor"].default_value = 0.35
    nt.links.new(tc.outputs["Object"], mix_v.inputs[4])
    nt.links.new(warp.outputs["Color"], mix_v.inputs[5])
    nt.links.new(mix_v.outputs[1], wave.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (*vein, 1)
    els[1].position = 0.18
    els[1].color = (*base, 1)
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["Factor"].default_value = vein_amount
    mix.inputs[6].default_value = (*base, 1)
    nt.links.new(ramp.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Coat Weight"].default_value = coat
    return m


def plaster(name, color, variation=0.06, scale=3.0, rough=0.85):
    m, nt, out = _nt(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 8
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (*[c * (1 - variation) for c in color], 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*[min(1.0, c * (1 + variation)) for c in color], 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    return m


def floor_tiles(name, a, b, inlay, tile=1.6, rough=0.08, vein=None):
    """Polished checker of two marbles with thin inlay joints (Cycles stills only;
    the runtime floor re-creates this pattern in its shader)."""
    m, nt, out = _nt(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeMapping")
    sep.inputs["Scale"].default_value = (1 / tile, 1 / tile, 1)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 1.0
    chk.inputs["Color1"].default_value = (*a, 1)
    chk.inputs["Color2"].default_value = (*b, 1)
    # Checker node samples at scale 1 over [0,1] -> 2 cells per unit, so halve.
    half = nt.nodes.new("ShaderNodeMapping")
    half.inputs["Scale"].default_value = (0.5, 0.5, 0.5)
    nt.links.new(sep.outputs[0], half.inputs["Vector"])
    nt.links.new(half.outputs[0], chk.inputs["Vector"])
    brick = nt.nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.0
    brick.squash = 1.0
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Mortar Size"].default_value = 0.012
    brick.inputs["Brick Width"].default_value = 1.0
    brick.inputs["Row Height"].default_value = 1.0
    brick.inputs["Color1"].default_value = (1, 1, 1, 1)
    brick.inputs["Color2"].default_value = (1, 1, 1, 1)
    brick.inputs["Mortar"].default_value = (0, 0, 0, 1)
    nt.links.new(sep.outputs[0], brick.inputs["Vector"])
    # Veins
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 0.6
    wave.inputs["Distortion"].default_value = 10.0
    wave.inputs["Detail"].default_value = 5
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    vr = nt.nodes.new("ShaderNodeValToRGB")
    vr.color_ramp.elements[0].position = 0.0
    vr.color_ramp.elements[0].color = (*(vein or [c * 0.7 for c in a]), 1)
    vr.color_ramp.elements[1].position = 0.12
    vr.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(wave.outputs["Fac"], vr.inputs["Fac"])
    mv = nt.nodes.new("ShaderNodeMix")
    mv.data_type = "RGBA"
    mv.blend_type = "MULTIPLY"
    mv.inputs["Factor"].default_value = 0.6
    nt.links.new(chk.outputs["Color"], mv.inputs[6])
    nt.links.new(vr.outputs["Color"], mv.inputs[7])
    mj = nt.nodes.new("ShaderNodeMix")
    mj.data_type = "RGBA"
    mj.inputs[7].default_value = (*inlay, 1)
    # Brick Fac is the mortar mask (1 in the joints).
    nt.links.new(brick.outputs["Fac"], mj.inputs["Factor"])
    nt.links.new(mv.outputs[2], mj.inputs[6])
    nt.links.new(mj.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Coat Weight"].default_value = 0.4
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    return m


def emissive_gradient(name, colors, strength=2.0, axis="Z", lo=0.0, hi=1.0):
    """Emission ramp along a generated axis (portal fallbacks, glow cards)."""
    m, nt, out = _nt(name)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    nt.links.new(sep.outputs[axis], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].color = (*colors[0], 1)
    els[1].color = (*colors[-1], 1)
    for k, c in enumerate(colors[1:-1], start=1):
        e = els.new(k / (len(colors) - 1))
        e.color = (*c, 1)
    nt.links.new(mr.outputs[0], ramp.inputs["Fac"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def scatter_leaves(name, anchors, count, size=(0.05, 0.11), seed=3, colors=None):
    """Heart-shaped ivy leaves around anchor points [(pos, normal)]. Vertex colors vary the green."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    col_layer = bm.loops.layers.color.new("Col")
    uv = bm.loops.layers.uv.new("UVMap")
    shape = [(0.0, 0.0), (0.45, 0.35), (0.5, 0.75), (0.25, 1.0), (0.0, 0.85), (-0.25, 1.0), (-0.5, 0.75), (-0.45, 0.35)]
    greens = colors or [(0.05, 0.22, 0.04), (0.09, 0.3, 0.05), (0.14, 0.36, 0.07), (0.04, 0.16, 0.05), (0.2, 0.4, 0.1)]
    for _ in range(count):
        p, n = anchors[rnd.randrange(len(anchors))]
        n = Vector(n).normalized()
        t = n.orthogonal().normalized()
        t.rotate(Matrix.Rotation(rnd.uniform(0, 2 * math.pi), 3, n))
        b = n.cross(t)
        s = rnd.uniform(*size)
        c = Vector(p) + n * rnd.uniform(0.0, 0.05) + t * rnd.uniform(-0.06, 0.06) + b * rnd.uniform(-0.06, 0.06)
        tilt = rnd.uniform(0.2, 0.9)
        verts = []
        for x, y in shape:
            q = c + t * x * s + (b * math.cos(tilt) + n * math.sin(tilt)) * y * s
            # cup the leaf a little
            q += n * (abs(x) * 0.25 * s)
            verts.append(bm.verts.new(q))
        try:
            f = bm.faces.new(verts)
        except ValueError:
            continue
        g = greens[rnd.randrange(len(greens))]
        for loop in f.loops:
            loop[col_layer] = (*g, 1.0)
            loop[uv].uv = (0.5, 0.5)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm)
    return o
