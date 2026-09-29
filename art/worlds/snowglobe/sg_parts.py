"""Geometry and materials for the snow globe world (Blender side).

Everything is built from bmesh primitives so it rebuilds identically. Objects
are tagged with a `group` custom property: "desk", "props", "village",
"glass", "dynamic", "fx". Groups drive baking, export and Cycles layers.
"""

import math
import pathlib
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import sg_model as sm
from ddd import geo, mat

CACHE = pathlib.Path(__file__).resolve().parents[2] / ".cache"
TEX = CACHE / "polyhaven" / "texture"
FONTS = pathlib.Path("/System/Library/Fonts/Supplemental")

_mats = {}


def M(name, **props):
    """Cached Principled material; names are stable because the runtime keys on them."""
    if name not in _mats:
        _mats[name] = mat.principled(name, **props)
    return _mats[name]


def reset_cache():
    _mats.clear()


def tex_maps(tid, res):
    d = TEX / tid
    out = {}
    for k in ("diffuse", "rough", "normal"):
        p = d / f"{tid}_{k}_{res}.png"
        if p.exists():
            out[k] = p
    return out


def pbr_mat(name, tid, res="1k", normal_strength=1.0, tint=None, diffuse_res=None, **props):
    if name in _mats:
        return _mats[name]
    maps = tex_maps(tid, res)
    if diffuse_res:
        maps["diffuse"] = tex_maps(tid, diffuse_res).get("diffuse", maps.get("diffuse"))
    m = mat.principled(name, **props)
    nt = m.node_tree
    b = mat.bsdf_of(m)
    if "diffuse" in maps:
        t = mat.image_node(m, maps["diffuse"], "sRGB")
        if tint:
            mix = nt.nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 1.0
            mix.inputs[2].default_value = (*tint, 1)
            nt.links.new(t.outputs["Color"], mix.inputs[1])
            nt.links.new(mix.outputs[0], b.inputs["Base Color"])
        else:
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if "rough" in maps and "rough" not in props:
        t = mat.image_node(m, maps["rough"], "Non-Color")
        nt.links.new(t.outputs["Color"], b.inputs["Roughness"])
    if "normal" in maps and normal_strength > 0:
        t = mat.image_node(m, maps["normal"], "Non-Color")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], b.inputs["Normal"])
    _mats[name] = m
    return m


def glow(name):
    col, _, _ = sm.GLOW[name]
    return M(name, base=tuple(c * 0.6 for c in sm.lin(col)), emission=sm.lin(col), emission_strength=1.0, rough=0.4)


def set_glow_variant(variant, scale=1.0):
    for name, (col, day, night) in sm.GLOW.items():
        m = _mats.get(name)
        if m:
            mat.bsdf_of(m).inputs["Emission Strength"].default_value = (day if variant == "day" else night) * scale


# ---------------------------------------------------------------------------
# primitives


def _obj(name, bm, group, material=None):
    o = geo.obj_from_bmesh(name, bm)
    o["group"] = group
    if material is not None:
        mat.assign(o, material)
    return o


def box(name, size, loc, group, material, rot=(0, 0, 0), bevel=0.0, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = _obj(name, bm, group, material)
    o.location = loc
    o.rotation_euler = rot
    if bevel > 0:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = seg
        m.limit_method = "NONE"
    return o


def cyl(name, r, depth, loc, group, material, rot=(0, 0, 0), seg=24, r2=None, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    o = _obj(name, bm, group, material)
    o.location = loc
    o.rotation_euler = rot
    return o


def sphere(name, r, loc, group, material, seg=16, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    o = _obj(name, bm, group, material)
    o.location = loc
    o.scale = scale
    return o


def torus(name, R, r, loc, group, material, rot=(0, 0, 0), u=32, v=10):
    o = geo.primitive("torus", name, major=R, minor=r, u=u, v=v)
    o["group"] = group
    mat.assign(o, material)
    o.location = loc
    o.rotation_euler = rot
    return o


def lathe(name, profile, group, material, seg=64, loc=(0, 0, 0)):
    """Revolve (r, z) points around Z."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = math.tau * i / seg
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in profile])
    n = len(profile)
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(n - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, group, material)
    o.location = loc
    geo.smooth(o, 35)
    return o


def text(name, body, font_file, size, loc, rot, group, material, extrude=0.0, align="CENTER", spacing=1.0, max_tris=1800):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    try:
        cu.font = bpy.data.fonts.load(str(FONTS / font_file), check_existing=True)
    except RuntimeError:
        pass
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.space_character = spacing
    cu.resolution_u = 3
    tmp = bpy.data.objects.new(name + "_c", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    tris = geo.triangle_count(o)
    if tris > max_tris:
        # Some system fonts (Chalkduster) have very noisy outlines.
        geo.decimate(o, max_tris / tris)
        geo.apply_all(o)
    o["group"] = group
    mat.assign(o, material)
    o.location = loc
    o.rotation_euler = rot
    return o


def star_cone(name, r, h, group, material, seg=14, jag=0.72, droop=0.12, bottom=0.2, rng=None, top_only=False):
    """Cone with a star-shaped base: branch tips on a pine tier."""
    bm = bmesh.new()
    apex = bm.verts.new((0, 0, h))
    ring = []
    for i in range(seg * 2):
        a = math.pi * i / seg
        tip = i % 2 == 0
        rr = r * (1.0 if tip else jag) * (1 + (rng.uniform(-0.08, 0.08) if rng else 0))
        z = -droop * h if tip else 0.0
        ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
    n = len(ring)
    for i in range(n):
        bm.faces.new((apex, ring[i], ring[(i + 1) % n]))
    if not top_only:
        c = bm.verts.new((0, 0, bottom * h))
        for i in range(n):
            bm.faces.new((c, ring[(i + 1) % n], ring[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, group, material)


def ribbon(name, pts, width, group, material, up=Vector((0, 0, 1)), uv_len=1.0, twist=None):
    """Flat strip along a 3D polyline; UV u across, v along (in units of uv_len)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    rows = []
    acc = 0.0
    for i, p in enumerate(pts):
        p = Vector(p)
        t = (Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        n = up if twist is None else twist(i, t)
        side = t.cross(n).normalized()
        if i:
            acc += (p - Vector(pts[i - 1])).length
        rows.append((bm.verts.new(p - side * width / 2), bm.verts.new(p + side * width / 2), acc / uv_len))
    for i in range(len(rows) - 1):
        a, b, va = rows[i]
        c, d, vb = rows[i + 1]
        f = bm.faces.new((a, b, d, c))
        for loop, (u, v) in zip(f.loops, ((0, va), (1, va), (1, vb), (0, vb))):
            loop[uv].uv = (u, v)
    return _obj(name, bm, group, material)


def planar_uv(o, scale=1.0, offset=(0.0, 0.0)):
    """World-XY planar UVs on the 'UVMap' layer (for tiling textures)."""
    me = o.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    mw = o.matrix_world
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co.x * scale + offset[0], co.y * scale + offset[1])


def box_uv(o, scale=1.0):
    """Triplanar-by-face-normal UVs (leather wraps, books)."""
    me = o.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            uvl.data[li].uv = (u * scale, v * scale)


def ensure_uv(o):
    if o.type == "MESH" and not o.data.uv_layers.get("UVMap"):
        if len(o.data.uv_layers):
            o.data.uv_layers[0].name = "UVMap"
        else:
            o.data.uv_layers.new(name="UVMap")


def group_objs(group):
    return [o for o in bpy.context.scene.objects if o.get("group") == group]


def parent_keep(children, parent):
    for c in children:
        c.parent = parent
        c.matrix_parent_inverse = parent.matrix_world.inverted()


def assemble(name, parts, loc, rot_z, group):
    """Join parts authored around the origin into one object placed at loc."""
    o = geo.join(parts, name)
    o["group"] = group
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    return o


def heading(face):
    """Z rotation that turns local -Y (an object's front) toward the 2D direction `face`."""
    return math.atan2(face[0], -face[1])


# ---------------------------------------------------------------------------
# village materials


def village_mats():
    snow = M("snow", base=sm.lin("#f5f8ff"), rough=0.62, sheen=0.25, subsurface=0.12, subsurface_scale=0.02)
    return {
        "snow": snow,
        "snow_path": M("snow_path", base=sm.lin("#e9e2d8"), rough=0.75),
        "ice": M("ice", base=sm.lin("#7fa9c4"), rough=0.03, coat=1.0, coat_rough=0.01, specular=0.9),
        "pine": M("pine", base=sm.lin("#2b5a3d"), rough=0.75, sheen=0.4, sheen_tint=sm.lin("#9fd8b0")),
        "pine_b": M("pine_b", base=sm.lin("#356b45"), rough=0.75, sheen=0.4),
        "bark": M("bark", base=sm.lin("#4a3326"), rough=0.85),
        "log": M("log", base=sm.lin("#8c5a36"), rough=0.7, sheen=0.2),
        "log_end": M("log_end", base=sm.lin("#c69564"), rough=0.7),
        "roof": M("roof", base=sm.lin("#5e2a27"), rough=0.6),
        "stone": M("stone", base=sm.lin("#8f8a86"), rough=0.8),
        "cream": M("cream", base=sm.lin("#efe4cb"), rough=0.5, coat=0.2),
        "cinema_red": M("cinema_red", base=sm.lin("#8a1c2a"), rough=0.45, coat=0.35),
        "teal": M("teal", base=sm.lin("#1f5f66"), rough=0.5, coat=0.2),
        "gold": M("gold", base=sm.lin("#e0b057"), metal=1.0, rough=0.28),
        "metal_dark": M("metal_dark", base=sm.lin("#2b2e35"), metal=0.8, rough=0.4),
        "black": M("black", base=sm.lin("#121316"), rough=0.35),
        "screen": M("screen", base=sm.lin("#0c0d10"), rough=0.3),
        "skin": M("skin", base=sm.lin("#e6b793"), rough=0.6, subsurface=0.2),
        "carrot": M("carrot", base=sm.lin("#ff7a1a"), rough=0.5),
        "coal": M("coal", base=sm.lin("#141414"), rough=0.6),
        "wreath": M("wreath", base=sm.lin("#1d5a33"), rough=0.7),
        "ribbon_red": M("ribbon_red", base=sm.lin("#c3242d"), rough=0.4, coat=0.4),
        "wood_light": M("wood_light", base=sm.lin("#b88958"), rough=0.6),
        "present_a": M("present_a", base=sm.lin("#d23b4a"), rough=0.35, coat=0.5),
        "present_b": M("present_b", base=sm.lin("#2f7fd6"), rough=0.35, coat=0.5),
        "present_c": M("present_c", base=sm.lin("#f2d27a"), rough=0.35, coat=0.5),
    }


# ---------------------------------------------------------------------------
# village


def ground_mesh(vm):
    """Snow mound meeting the glass, with the pond carved flat."""
    n = 150
    bm = bmesh.new()
    verts = {}
    lim = sm.VILLAGE_R + 0.02
    for i in range(n + 1):
        for j in range(n + 1):
            x = -lim + 2 * lim * i / n
            y = -lim + 2 * lim * j / n
            r = math.hypot(x, y)
            if r > lim + 2 * lim / n * 1.5:
                continue
            if r > lim:
                x, y = x / r * lim, y / r * lim
            verts[(i, j)] = bm.verts.new((x, y, sm.ground(x, y)))
    for i in range(n):
        for j in range(n):
            q = [verts.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
            if all(q):
                try:
                    bm.faces.new(q)
                except ValueError:
                    pass
            elif sum(1 for v in q if v) == 3:
                try:
                    bm.faces.new([v for v in q if v])
                except ValueError:
                    pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # The rim turns up to meet the inner glass so no gap shows from outside.
    for v in bm.verts:
        r = math.hypot(v.co.x, v.co.y)
        if r > sm.VILLAGE_R - 0.01:
            v.co.z = max(v.co.z, sm.GLOBE_C[2] - math.sqrt(max(0.0, sm.R_IN ** 2 - r * r)) + 0.004)
    o = _obj("ground", bm, "village", vm["snow"])
    geo.smooth(o, 180)
    planar_uv(o, 6.0)
    # Skirt down into the base so the seam is hidden.
    skirt = lathe("ground_skirt", [(sm.VILLAGE_R + 0.02, sm.BASE_TOP - 0.02), (sm.VILLAGE_R + 0.02, sm.BASE_TOP + 0.03)], "village", vm["snow"], seg=96)
    return [o, skirt]


def pond(vm):
    c = sm.POND["c"]
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=72, radius=1.0)
    bmesh.ops.scale(bm, vec=Vector((sm.POND["rx"] * 1.02, sm.POND["ry"] * 1.02, 1)), verts=bm.verts)
    ice = _obj("ice", bm, "village", vm["ice"])
    ice.location = (c[0], c[1], sm.POND_Z)
    planar_uv(ice, 4.0)
    return [ice]


def pine(name, x, y, h, vm, rng, big=False):
    z0 = sm.ground(x, y) - 0.004
    parts = [cyl(f"{name}_trunk", h * 0.05, h * 0.3, (0, 0, h * 0.12), "village", vm["bark"], seg=8)]
    tiers = 6 if big else (5 if h > 0.13 else 4)
    green = vm["pine"] if rng.random() < 0.6 else vm["pine_b"]
    spin = rng.random() * math.tau
    for i in range(tiers):
        t = i / tiers
        zb = h * (0.16 + 0.8 * t)
        r = h * 0.38 * (1 - t * 0.74)
        th = h * 0.36 * (1 - t * 0.35)
        seg = 12 if not big else 16
        c = star_cone(f"{name}_t{i}", r, th, "village", green, seg=seg, jag=0.7, droop=0.16, rng=rng)
        c.location = (0, 0, zb)
        c.rotation_euler = (0, 0, spin + i * 0.7)
        s = star_cone(f"{name}_s{i}", r * 0.9, th * 0.82, "village", vm["snow"], seg=seg, jag=0.66, droop=0.1, rng=rng, top_only=True)
        s.location = (0, 0, zb + th * 0.2)
        s.rotation_euler = (0, 0, spin + i * 0.7)
        parts += [c, s]
    o = assemble(name, parts, (x, y, z0), rng.random() * 0.3, "trees")
    return o


def xmas_tree(vm, rng):
    x, y = sm.XMAS_TREE["p"]
    h = sm.XMAS_TREE["h"]
    tree = pine("xmas_tree", x, y, h, vm, rng, big=True)
    z0 = sm.ground(x, y) - 0.004
    bulbs = {"glow_red": [], "glow_green": [], "glow_blue": [], "glow_bulb": []}
    keys = list(bulbs)
    k = 0
    for i in range(70):
        t = i / 70
        a = t * math.tau * 5.5
        zz = h * (0.2 + 0.72 * t)
        rr = h * 0.36 * (1 - (zz / h - 0.12) / 0.95) * 0.96 + 0.004
        rr = max(rr, 0.006)
        p = (x + rr * math.cos(a), y + rr * math.sin(a), z0 + zz)
        bulbs[keys[k % 4]].append(sphere(f"bulb{i}", 0.003, p, "village", glow(keys[k % 4]), seg=8))
        k += 1
    out = [tree]
    for key, objs in bulbs.items():
        out.append(geo.join(objs, f"xmas_{key}"))
        out[-1]["group"] = "village"
    star = cyl("star_core", 0.012, 0.006, (0, 0, 0), "village", glow("glow_star"), rot=(math.pi / 2, 0, 0), seg=5, r2=0.012)
    s2 = sphere("star_glow", 0.009, (0, 0, 0), "village", glow("glow_star"), seg=10)
    points = []
    for i in range(5):
        a = math.pi / 2 + math.tau * i / 5
        c = cyl(f"star_pt{i}", 0.007, 0.02, (math.cos(a) * 0.012, 0, math.sin(a) * 0.012), "village", glow("glow_star"), rot=(0, -a + math.pi / 2, 0), seg=4, r2=0.0005)
        points.append(c)
    st = assemble("xmas_star", [star, s2, *points], (x, y, z0 + h + 0.012), 0.4, "village")
    out.append(st)
    # Presents
    for i, (dx, dy, s, m) in enumerate([(0.05, -0.04, 0.022, "present_a"), (-0.045, -0.05, 0.018, "present_b"), (0.01, -0.07, 0.016, "present_c"), (0.06, 0.03, 0.017, "present_b")]):
        px, py = x + dx, y + dy
        pz = sm.ground(px, py) + s / 2 - 0.002
        b = box(f"present{i}", (s, s, s * 0.9), (px, py, pz), "village", vm[m], rot=(0, 0, i * 0.7), bevel=0.001)
        r1 = box(f"present{i}_r1", (s * 1.02, s * 0.2, s * 0.92), (px, py, pz), "village", vm["gold"], rot=(0, 0, i * 0.7))
        r2 = box(f"present{i}_r2", (s * 0.2, s * 1.02, s * 0.92), (px, py, pz), "village", vm["gold"], rot=(0, 0, i * 0.7))
        out += [b, r1, r2]
    return out


def cabin(vm):
    """Timber studio cabin: log walls, snowy roof with icicles, lit windows, porch with ring light and camera."""
    W, D, H = 0.17, 0.13, 0.085
    parts = []
    logs = 8
    lr = H / logs / 2
    for i in range(logs):
        z = lr + i * 2 * lr
        for sy in (-1, 1):
            parts.append(cyl(f"log_x{i}{sy}", lr, W + lr * 4, (0, sy * D / 2, z), "village", vm["log"], rot=(0, math.pi / 2, 0), seg=10))
        for sx in (-1, 1):
            parts.append(cyl(f"log_y{i}{sx}", lr, D + lr * 4, (sx * W / 2, 0, z + lr), "village", vm["log"], rot=(math.pi / 2, 0, 0), seg=10))
    parts.append(box("cabin_core", (W - lr, D - lr, H), (0, 0, H / 2), "village", vm["log_end"]))
    # Gables
    bm = bmesh.new()
    for sy in (-1, 1):
        v = [bm.verts.new((-W / 2, sy * D / 2 * 0.98, H)), bm.verts.new((W / 2, sy * D / 2 * 0.98, H)), bm.verts.new((0, sy * D / 2 * 0.98, H + 0.065))]
        bm.faces.new(v if sy < 0 else list(reversed(v)))
    parts.append(_obj("gables", bm, "village", vm["log"]))
    # Roof slabs + snow
    pitch = math.atan2(0.065, W / 2)
    slab_w = math.hypot(W / 2, 0.065) + 0.03
    for sx in (-1, 1):
        cx = sx * (slab_w / 2 - 0.012) * math.cos(pitch)
        cz = H + 0.065 - (slab_w / 2 - 0.012) * math.sin(pitch)
        parts.append(box(f"roof{sx}", (slab_w, D + 0.05, 0.008), (cx, 0, cz + 0.004), "village", vm["roof"], rot=(0, sx * pitch, 0)))
        parts.append(box(f"roofsnow{sx}", (slab_w + 0.004, D + 0.056, 0.012), (cx, 0, cz + 0.013), "village", vm["snow"], rot=(0, sx * pitch, 0), bevel=0.005, seg=3))
        # Icicles along the eave
        ex = sx * (slab_w - 0.012) * math.cos(pitch) - sx * 0.004
        ez = H + 0.065 - (slab_w - 0.012) * math.sin(pitch)
        rng = random.Random(3 + sx)
        for k in range(14):
            yy = -D / 2 - 0.02 + (D + 0.04) * (k + rng.random() * 0.5) / 14
            ln = 0.006 + rng.random() * 0.014
            parts.append(cyl(f"icicle{sx}{k}", 0.0016, ln, (ex, yy, ez - ln / 2), "village", vm["ice"], seg=5, r2=0.0001))
    # Chimney
    parts.append(box("chimney", (0.017, 0.017, 0.05), (0.045, 0.03, H + 0.052), "village", vm["stone"], bevel=0.0015))
    parts.append(box("chimney_snow", (0.021, 0.021, 0.006), (0.045, 0.03, H + 0.078), "village", vm["snow"], bevel=0.0025))
    # Front windows + door (front = -Y)
    for wx in (-0.05, 0.05):
        parts.append(box(f"win{wx}", (0.03, 0.004, 0.028), (wx, -D / 2 - lr - 0.002, H * 0.55), "village", glow("glow_window")))
        parts.append(box(f"winframe{wx}", (0.036, 0.003, 0.034), (wx, -D / 2 - lr - 0.0005, H * 0.55), "village", vm["cream"]))
        parts.append(box(f"winbar{wx}", (0.002, 0.006, 0.03), (wx, -D / 2 - lr - 0.003, H * 0.55), "village", vm["cream"]))
        parts.append(box(f"winsill{wx}", (0.04, 0.01, 0.004), (wx, -D / 2 - lr - 0.004, H * 0.55 - 0.017), "village", vm["snow"], bevel=0.0015))
    parts.append(box("door", (0.03, 0.004, 0.05), (0, -D / 2 - lr - 0.002, 0.025), "village", vm["teal"]))
    parts.append(box("doorframe", (0.036, 0.003, 0.054), (0, -D / 2 - lr - 0.0005, 0.027), "village", vm["cream"]))
    parts.append(torus("wreath", 0.008, 0.0025, (0, -D / 2 - lr - 0.005, 0.04), "village", vm["wreath"], rot=(math.pi / 2, 0, 0), u=16, v=6))
    parts.append(sphere("porch_lamp", 0.004, (0.022, -D / 2 - lr - 0.006, 0.055), "village", glow("glow_lamp"), seg=8))
    # Side window (+X)
    parts.append(box("win_side", (0.004, 0.034, 0.028), (W / 2 + lr + 0.002, 0, H * 0.55), "village", glow("glow_window")))
    parts.append(box("win_side_f", (0.003, 0.04, 0.034), (W / 2 + lr + 0.0005, 0, H * 0.55), "village", vm["cream"]))
    # Sign over the door
    parts.append(box("sign_board", (0.07, 0.004, 0.016), (0, -D / 2 - lr - 0.004, H + 0.012), "village", vm["cream"], bevel=0.001))
    parts.append(text("sign_text", "STUDIO", "DIN Condensed Bold.ttf", 0.012, (0, -D / 2 - lr - 0.0065, H + 0.011), (math.pi / 2, 0, 0), "village", vm["cinema_red"], extrude=0.0006))
    # Porch deck + steps
    parts.append(box("porch", (0.09, 0.03, 0.006), (0, -D / 2 - lr - 0.016, 0.003), "village", vm["wood_light"]))
    o = assemble("cabin", parts, (sm.CABIN["p"][0], sm.CABIN["p"][1], sm.ground(*sm.CABIN["p"]) - 0.006), heading(sm.CABIN["face"]), "village")
    # Studio kit on the snow in front of the porch: ring light and a camera on a tripod.
    kit = []
    kit.append(torus("ringlight", 0.016, 0.0022, (0, 0, 0.075), "village", glow("glow_ring"), rot=(math.pi / 2, 0, 0.3), u=28, v=8))
    kit.append(cyl("ring_stand", 0.0012, 0.06, (0, 0, 0.042), "village", vm["metal_dark"], seg=6))
    for k in range(3):
        a = k * math.tau / 3
        kit.append(cyl(f"ring_leg{k}", 0.001, 0.028, (math.cos(a) * 0.008, math.sin(a) * 0.008, 0.012), "village", vm["metal_dark"], rot=(0.5 * math.sin(a), -0.5 * math.cos(a), 0), seg=5))
    tx, ty = 0.05, -0.02
    kit.append(box("cam_body", (0.018, 0.012, 0.012), (tx, ty, 0.06), "village", vm["black"], bevel=0.0015))
    kit.append(cyl("cam_lens", 0.0045, 0.012, (tx, ty - 0.011, 0.06), "village", vm["black"], rot=(math.pi / 2, 0, 0), seg=12))
    kit.append(cyl("cam_glass", 0.0035, 0.001, (tx, ty - 0.0172, 0.06), "village", vm["ice"], rot=(math.pi / 2, 0, 0), seg=12))
    kit.append(sphere("cam_tally", 0.0012, (tx + 0.006, ty - 0.006, 0.067), "village", glow("glow_red"), seg=6))
    for k in range(3):
        a = k * math.tau / 3 + 0.4
        kit.append(cyl(f"tri_leg{k}", 0.0009, 0.058, (tx + math.cos(a) * 0.009, ty + math.sin(a) * 0.009, 0.027), "village", vm["metal_dark"], rot=(0.33 * math.sin(a), -0.33 * math.cos(a), 0), seg=5))
    kx, ky = sm.CABIN["p"][0] - 0.1, sm.CABIN["p"][1] - 0.12
    k_obj = assemble("studio_kit", kit, (kx, ky, sm.ground(kx, ky) - 0.002), heading(sm.CABIN["face"]) + 0.5, "village")
    return [o, k_obj]


def cinema(vm):
    W, D, H = 0.25, 0.16, 0.13
    parts = [box("cin_body", (W, D, H), (0, 0, H / 2), "village", vm["cinema_red"], bevel=0.002)]
    # Stepped art-deco parapet
    for k, (w, h) in enumerate([(W * 0.9, 0.022), (W * 0.6, 0.02), (W * 0.3, 0.018)]):
        z = H + sum(x[1] for x in [(W * 0.9, 0.022), (W * 0.6, 0.02), (W * 0.3, 0.018)][:k]) + h / 2
        parts.append(box(f"cin_step{k}", (w, 0.02, h), (0, -D / 2 + 0.01, z), "village", vm["cream"], bevel=0.0015))
        parts.append(box(f"cin_stepsnow{k}", (w + 0.004, 0.024, 0.005), (0, -D / 2 + 0.01, z + h / 2 + 0.002), "village", vm["snow"], bevel=0.002))
    parts.append(box("cin_roofsnow", (W + 0.006, D + 0.006, 0.01), (0, 0, H + 0.004), "village", vm["snow"], bevel=0.004, seg=3))
    parts.append(box("cin_trim", (W + 0.004, D + 0.004, 0.008), (0, 0, H - 0.004), "village", vm["cream"]))
    parts.append(box("cin_base", (W + 0.004, D + 0.004, 0.012), (0, 0, 0.006), "village", vm["stone"]))
    # Marquee canopy with the banner screen and a border of bulbs
    mz = 0.066
    parts.append(box("marquee", (0.2, 0.04, 0.012), (0, -D / 2 - 0.02, mz - 0.012), "village", vm["cream"], bevel=0.0015))
    parts.append(box("marquee_face", (0.2, 0.006, 0.05), (0, -D / 2 - 0.038, mz + 0.012), "village", vm["black"], bevel=0.0012))
    bulbs = []
    for i in range(26):
        u = i / 25
        bulbs.append(sphere(f"mb_top{i}", 0.0022, (-0.098 + 0.196 * u, -D / 2 - 0.042, mz + 0.035), "village", glow("glow_bulb"), seg=6))
        bulbs.append(sphere(f"mb_bot{i}", 0.0022, (-0.098 + 0.196 * u, -D / 2 - 0.042, mz - 0.011), "village", glow("glow_bulb"), seg=6))
    for i in range(6):
        v = i / 5
        for sx in (-1, 1):
            bulbs.append(sphere(f"mb_side{i}{sx}", 0.0022, (sx * 0.1, -D / 2 - 0.042, mz - 0.011 + 0.046 * v), "village", glow("glow_bulb"), seg=6))
    parts.append(geo.join(bulbs, "marquee_bulbs"))
    # Blade sign with letters
    parts.append(box("blade", (0.012, 0.03, 0.085), (W * 0.36, -D / 2 - 0.018, H + 0.005), "village", vm["cream"], bevel=0.002))
    for i, ch in enumerate("CINEMA"):
        parts.append(text(f"blade_{ch}{i}", ch, "DIN Condensed Bold.ttf", 0.013, (W * 0.36 - 0.0065, -D / 2 - 0.018, H + 0.04 - i * 0.0135), (math.pi / 2, 0, -math.pi / 2), "village", glow("glow_bulb"), extrude=0.0008))
    # Lobby doors (warm glow) and poster frames
    parts.append(box("lobby", (0.08, 0.004, 0.045), (0, -D / 2 - 0.001, 0.035), "village", glow("glow_lobby")))
    for dx in (-0.02, 0.0, 0.02):
        parts.append(box(f"door_bar{dx}", (0.003, 0.006, 0.045), (dx, -D / 2 - 0.003, 0.035), "village", vm["gold"]))
    for sx in (-1, 1):
        parts.append(box(f"poster_frame{sx}", (0.046, 0.004, 0.032), (sx * 0.085, -D / 2 - 0.002, 0.036), "village", vm["gold"], bevel=0.001))
    # Tall windows along the side
    for k in range(3):
        parts.append(box(f"cin_win{k}", (0.004, 0.022, 0.03), (W / 2 + 0.002, -0.045 + k * 0.045, 0.085), "village", glow("glow_window")))
    body = assemble("cinema", parts, (*sm.CINEMA["p"], sm.ground(*sm.CINEMA["p"]) - 0.008), heading(sm.CINEMA["face"]), "village")
    # Screens are separate objects with 0..1 UVs; the runtime maps covers onto them.
    screens = []
    rot = heading(sm.CINEMA["face"])
    cz = sm.ground(*sm.CINEMA["p"]) - 0.008
    for name, (lx, ly, lz), (w, h) in (
        ("screen_marquee", (0, -D / 2 - 0.0415, mz + 0.012), (0.18, 0.18 * 378 / 1600)),
        ("screen_poster", (-0.085, -D / 2 - 0.0045, 0.036), (0.04, 0.025)),
        ("screen_poster_b", (0.085, -D / 2 - 0.0045, 0.036), (0.04, 0.025)),
    ):
        s = screen_plane(name, w, h, vm)
        c, sn = math.cos(rot), math.sin(rot)
        s.location = (sm.CINEMA["p"][0] + lx * c - ly * sn, sm.CINEMA["p"][1] + lx * sn + ly * c, cz + lz)
        s.rotation_euler = (0, 0, rot)
        screens.append(s)
    return [body], screens


def screen_plane(name, w, h, vm):
    """Upright quad in the XZ plane facing -Y, UVs 0..1 (cover images map straight on)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    v = [bm.verts.new((-w / 2, 0, -h / 2)), bm.verts.new((w / 2, 0, -h / 2)), bm.verts.new((w / 2, 0, h / 2)), bm.verts.new((-w / 2, 0, h / 2))]
    f = bm.faces.new(v)
    for loop, c in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = c
    return _obj(name, bm, "dynamic", vm["screen"])


def billboard(spec, name, cover_aspect, vm, lamps=True):
    w = spec["w"]
    h = w * cover_aspect
    post_h = 0.07 if h > 0.1 else 0.05
    parts = []
    for sx in (-1, 1):
        parts.append(cyl(f"{name}_post{sx}", 0.003, post_h + h, (sx * w * 0.38, 0.004, (post_h + h) / 2), "village", vm["metal_dark"], seg=8))
    parts.append(box(f"{name}_frame", (w + 0.012, 0.008, h + 0.012), (0, 0.003, post_h + h / 2), "village", vm["cream"], bevel=0.0015))
    parts.append(box(f"{name}_snow", (w + 0.016, 0.014, 0.006), (0, 0.003, post_h + h + 0.008), "village", vm["snow"], bevel=0.003))
    if lamps:
        for k in range(3):
            lx = -w * 0.33 + k * w * 0.33
            parts.append(cyl(f"{name}_arm{k}", 0.0012, 0.02, (lx, -0.008, post_h + h + 0.004), "village", vm["metal_dark"], rot=(math.pi / 2, 0, 0), seg=6))
            parts.append(cyl(f"{name}_lamp{k}", 0.0035, 0.006, (lx, -0.018, post_h + h + 0.002), "village", vm["metal_dark"], rot=(0.5, 0, 0), seg=10))
            parts.append(cyl(f"{name}_lampg{k}", 0.003, 0.001, (lx, -0.0195, post_h + h - 0.001), "village", glow("glow_lamp"), rot=(0.5, 0, 0), seg=10))
    x, y = spec["p"]
    z = sm.ground(x, y) - 0.006
    rot = heading(spec["face"])
    body = assemble(name, parts, (x, y, z), rot, "village")
    s = screen_plane(f"screen_{name}", w, h, vm)
    c, sn = math.cos(rot), math.sin(rot)
    ly = -0.0015
    s.location = (x - ly * sn, y + ly * c, z + post_h + h / 2)
    s.rotation_euler = (0, 0, rot)
    return [body], [s]


def cottage(spec, vm):
    """Painted clapboard cottage with a steep snowy roof and warm windows."""
    wall = M(f"wall_{spec['wall']}", base=sm.lin(spec["wall"]), rough=0.55, coat=0.15)
    trim = M(f"trim_{spec['trim']}", base=sm.lin(spec["trim"]), rough=0.5)
    roof = M(f"roof_{spec['roof']}", base=sm.lin(spec["roof"]), rough=0.55)
    W, D, H = 0.1, 0.085, 0.07
    parts = [box("c_body", (W, D, H), (0, 0, H / 2), "village", wall)]
    # Clapboard lines
    for k in range(7):
        z = 0.006 + k * H / 7
        parts.append(box(f"c_board{k}", (W + 0.002, D + 0.002, 0.0015), (0, 0, z), "village", wall))
    bm = bmesh.new()
    for sy in (-1, 1):
        v = [bm.verts.new((-W / 2, sy * D / 2, H)), bm.verts.new((W / 2, sy * D / 2, H)), bm.verts.new((0, sy * D / 2, H + 0.055))]
        bm.faces.new(v if sy < 0 else list(reversed(v)))
    parts.append(_obj("c_gable", bm, "village", wall))
    pitch = math.atan2(0.055, W / 2)
    sl = math.hypot(W / 2, 0.055) + 0.016
    for sx in (-1, 1):
        cx = sx * (sl / 2 - 0.008) * math.cos(pitch)
        cz = H + 0.055 - (sl / 2 - 0.008) * math.sin(pitch)
        parts.append(box(f"c_roof{sx}", (sl, D + 0.03, 0.006), (cx, 0, cz + 0.003), "village", roof, rot=(0, sx * pitch, 0)))
        parts.append(box(f"c_snow{sx}", (sl + 0.004, D + 0.034, 0.011), (cx, 0, cz + 0.01), "village", vm["snow"], rot=(0, sx * pitch, 0), bevel=0.004, seg=3))
    parts.append(box("c_chim", (0.016, 0.016, 0.05), (-0.025, 0.02, H + 0.045), "village", vm["stone"]))
    parts.append(box("c_chim_snow", (0.02, 0.02, 0.006), (-0.025, 0.02, H + 0.072), "village", vm["snow"], bevel=0.0025))
    for wx in (-0.028, 0.028):
        parts.append(box(f"c_win{wx}", (0.02, 0.003, 0.022), (wx, -D / 2 - 0.0015, H * 0.55), "village", glow("glow_window")))
        parts.append(box(f"c_winf{wx}", (0.025, 0.002, 0.027), (wx, -D / 2 - 0.0005, H * 0.55), "village", trim))
        parts.append(box(f"c_shut{wx}", (0.006, 0.003, 0.026), (wx + (0.016 if wx > 0 else -0.016), -D / 2 - 0.001, H * 0.55), "village", roof))
    parts.append(box("c_door", (0.02, 0.003, 0.036), (0, -D / 2 - 0.0015, 0.018), "village", roof))
    parts.append(sphere("c_knob", 0.0012, (0.006, -D / 2 - 0.0035, 0.018), "village", vm["gold"], seg=6))
    parts.append(box("c_gwin", (0.016, 0.003, 0.016), (0, -D / 2 - 0.0015, H + 0.02), "village", glow("glow_window")))
    parts.append(torus("c_wreath", 0.0055, 0.0018, (0, -D / 2 - 0.004, 0.042), "village", vm["wreath"], rot=(math.pi / 2, 0, 0), u=14, v=6))
    parts.append(box("c_step", (0.03, 0.012, 0.004), (0, -D / 2 - 0.006, 0.002), "village", vm["stone"]))
    x, y = spec["p"]
    return assemble("cottage", parts, (x, y, sm.ground(x, y) - 0.006), heading(spec["face"]), "village")


def film_set(vm):
    """A tiny film shoot in the square: director's chair, a spotlight on a stand, a boom mic."""
    parts = []
    # Director's chair
    canvas = M("canvas", base=sm.lin("#1c1c20"), rough=0.8, sheen=0.4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl(f"dc_leg{sx}{sy}", 0.0009, 0.03, (sx * 0.007, sy * 0.006, 0.015), "village", vm["wood_light"], rot=(sy * 0.25, 0, 0), seg=5))
    parts.append(box("dc_seat", (0.017, 0.013, 0.0015), (0, 0, 0.022), "village", canvas))
    parts.append(box("dc_back", (0.017, 0.0015, 0.007), (0, 0.007, 0.036), "village", canvas))
    for sx in (-1, 1):
        parts.append(cyl(f"dc_post{sx}", 0.0008, 0.02, (sx * 0.0085, 0.007, 0.03), "village", vm["wood_light"], seg=5))
    # Spotlight on a tripod stand, aimed across the square
    parts.append(cyl("sp_pole", 0.001, 0.06, (0.05, 0.02, 0.03), "village", vm["metal_dark"], seg=6))
    for k in range(3):
        a = k * math.tau / 3
        parts.append(cyl(f"sp_leg{k}", 0.0008, 0.024, (0.05 + math.cos(a) * 0.007, 0.02 + math.sin(a) * 0.007, 0.01), "village", vm["metal_dark"], rot=(0.5 * math.sin(a), -0.5 * math.cos(a), 0), seg=5))
    parts.append(cyl("sp_can", 0.006, 0.014, (0.05, 0.015, 0.064), "village", vm["black"], rot=(1.3, 0, 0), seg=14))
    parts.append(cyl("sp_lens", 0.005, 0.001, (0.05, 0.008, 0.062), "village", glow("glow_ring"), rot=(1.3, 0, 0), seg=14))
    for k in range(4):
        a = k * math.pi / 2
        parts.append(box(f"sp_door{k}", (0.008, 0.0006, 0.004), (0.05 + math.cos(a) * 0.006, 0.006, 0.062 + math.sin(a) * 0.006), "village", vm["black"], rot=(1.3, a, 0)))
    # Boom mic
    parts.append(cyl("boom", 0.0006, 0.07, (-0.03, 0.0, 0.05), "village", vm["metal_dark"], rot=(0, 1.0, 0), seg=5))
    parts.append(cyl("boom_mic", 0.0022, 0.012, (-0.058, 0.0, 0.068), "village", M("fluffy", base=sm.lin("#6e6a66"), rough=1.0, sheen=1.0), rot=(0, math.pi / 2, 0), seg=10))
    parts.append(cyl("boom_stand", 0.0007, 0.035, (-0.004, 0.0, 0.0175), "village", vm["metal_dark"], seg=5))
    # Tiny crew: one person at the camera spot
    x, y = sm.FILM_SET["p"]
    return [assemble("film_set", parts, (x, y, sm.ground(x, y) - 0.002), heading(sm.FILM_SET["face"]), "village")]


def shrubs(vm, seed=21):
    """Snow-covered bushes and rocks tucked around buildings and along the rim."""
    rng = random.Random(seed)
    out = []
    spots = [(sm.CABIN["p"][0] + 0.09, sm.CABIN["p"][1] - 0.08), (sm.CINEMA["p"][0] - 0.15, sm.CINEMA["p"][1] - 0.06), (sm.BILLBOARD["p"][0] + 0.16, sm.BILLBOARD["p"][1] - 0.02)]
    for c in sm.COTTAGES:
        spots.append((c["p"][0] + 0.07, c["p"][1] - 0.06))
    for _ in range(18):
        a = rng.random() * math.tau
        r = 0.45 + rng.random() * 0.28
        spots.append((math.cos(a) * r, math.sin(a) * r))
    for i, (x, y) in enumerate(spots):
        if sm.pond_mask(x, y) > 0.1:
            continue
        s = 0.012 + rng.random() * 0.014
        z = sm.ground(x, y)
        if rng.random() < 0.6:
            b = sphere(f"bush{i}", s, (x, y, z + s * 0.3), "village", vm["pine_b"], seg=10, scale=(1.2, 1.0, 0.8))
            cap = sphere(f"bushcap{i}", s * 0.95, (x, y, z + s * 0.55), "village", vm["snow"], seg=10, scale=(1.15, 0.95, 0.55))
            out += [b, cap]
        else:
            r_ = sphere(f"rock{i}", s * 0.8, (x, y, z), "village", vm["stone"], seg=8, scale=(1.3, 1.0, 0.7))
            cap = sphere(f"rockcap{i}", s * 0.78, (x, y, z + s * 0.3), "village", vm["snow"], seg=8, scale=(1.25, 0.95, 0.45))
            out += [r_, cap]
    o = geo.join(out, "shrubs")
    o["group"] = "trees"
    return [o]


def lamp_post(i, x, y, vm):
    z = sm.ground(x, y) - 0.004
    parts = [
        cyl("lp_pole", 0.0022, 0.075, (0, 0, 0.0375), "village", vm["metal_dark"], seg=8),
        cyl("lp_base", 0.0045, 0.008, (0, 0, 0.004), "village", vm["metal_dark"], seg=10),
        box("lp_head", (0.012, 0.012, 0.014), (0, 0, 0.082), "village", vm["metal_dark"]),
        box("lp_glass", (0.0105, 0.0105, 0.012), (0, 0, 0.082), "village", glow("glow_lamp")),
        cyl("lp_cap", 0.0105, 0.007, (0, 0, 0.0925), "village", vm["metal_dark"], seg=4, r2=0.002, rot=(0, 0, math.pi / 4)),
        cyl("lp_snow", 0.0085, 0.004, (0, 0, 0.096), "village", vm["snow"], seg=10, r2=0.003),
    ]
    return assemble(f"lamp{i}", parts, (x, y, z), 0, "village")


def path_mesh(vm):
    out = []
    for k, pts2 in enumerate((sm.PATH, sm.PATH_B)):
        pts = sm.path_points(pts2, 0.006)
        p3 = [(x, y, sm.ground(x, y) + 0.0012) for x, y in pts]
        r = ribbon(f"path{k}", p3, 0.05 if k == 0 else 0.04, "village", vm["snow_path"], uv_len=0.2)
        # Conform each vertex to the ground.
        for v in r.data.vertices:
            v.co.z = sm.ground(v.co.x, v.co.y) + 0.0012
        geo.smooth(r, 180)
        out.append(r)
    # Stepping stones and little fence posts
    rng = random.Random(11)
    pts = sm.path_points(sm.PATH, 0.02)
    posts = []
    for i in range(0, len(pts) - 1, 2):
        x, y = pts[i]
        nx, ny = pts[i + 1][0] - x, pts[i + 1][1] - y
        L = math.hypot(nx, ny) or 1
        for side in (-1, 1):
            if (i // 2 + (side > 0)) % 3 == 0 or y > -0.1:
                continue
            px, py = x - ny / L * 0.035 * side, y + nx / L * 0.035 * side
            posts.append(cyl(f"fp{i}{side}", 0.0018, 0.022, (px, py, sm.ground(px, py) + 0.008), "village", vm["wood_light"], seg=6))
            posts.append(sphere(f"fps{i}{side}", 0.0026, (px, py, sm.ground(px, py) + 0.02), "village", vm["snow"], seg=6, scale=(1, 1, 0.6)))
    if posts:
        f = geo.join(posts, "fence")
        f["group"] = "village"
        out.append(f)
    return out


def snowman(vm):
    x, y = sm.SNOWMAN["p"]
    parts = [
        sphere("sm_b", 0.022, (0, 0, 0.018), "village", vm["snow"], seg=20),
        sphere("sm_m", 0.016, (0, 0, 0.048), "village", vm["snow"], seg=18),
        sphere("sm_h", 0.011, (0, 0, 0.07), "village", vm["snow"], seg=16),
        cyl("sm_hat", 0.008, 0.012, (0, 0, 0.085), "village", vm["black"], seg=14),
        cyl("sm_brim", 0.012, 0.0015, (0, 0, 0.0795), "village", vm["black"], seg=16),
        cyl("sm_band", 0.0082, 0.003, (0, 0, 0.082), "village", vm["ribbon_red"], seg=14),
        cyl("sm_nose", 0.0022, 0.012, (0, -0.016, 0.07), "village", vm["carrot"], rot=(math.pi / 2, 0, 0), seg=8, r2=0.0002),
        torus("sm_scarf", 0.0115, 0.003, (0, 0, 0.06), "village", vm["ribbon_red"], u=18, v=6),
        box("sm_scarf_tail", (0.004, 0.003, 0.016), (0.006, -0.011, 0.052), "village", vm["ribbon_red"], rot=(0.2, 0, 0.3)),
    ]
    for k, (ex, ez) in enumerate([(-0.004, 0.074), (0.004, 0.074), (0, 0.052), (0, 0.044), (0, 0.036)]):
        parts.append(sphere(f"sm_coal{k}", 0.0016, (ex, -0.0105 if ez > 0.06 else -0.0155, ez), "village", vm["coal"], seg=6))
    for sx in (-1, 1):
        parts.append(cyl(f"sm_arm{sx}", 0.0011, 0.03, (sx * 0.024, 0, 0.052), "village", vm["bark"], rot=(0, sx * 1.1, 0), seg=5))
    # A little sled leaning beside it
    parts.append(box("sled_deck", (0.03, 0.014, 0.003), (0.04, 0.01, 0.009), "village", vm["cinema_red"], bevel=0.001))
    for sy in (-1, 1):
        parts.append(box(f"sled_run{sy}", (0.034, 0.0015, 0.0025), (0.04, 0.01 + sy * 0.006, 0.004), "village", vm["gold"]))
    return assemble("snowman", parts, (x, y, sm.ground(x, y) - 0.003), 0.35, "village")


def benches(vm):
    out = []
    for i, (x, y, rot) in enumerate([(-0.1, -0.02, 2.2), (-0.12, -0.34, 0.9)]):
        parts = []
        for k in range(3):
            parts.append(box(f"slat{k}", (0.04, 0.004, 0.002), (0, -0.004 + k * 0.004, 0.012), "village", vm["wood_light"]))
        for k in range(2):
            parts.append(box(f"back{k}", (0.04, 0.002, 0.004), (0, 0.007, 0.018 + k * 0.006), "village", vm["wood_light"]))
        for sx in (-1, 1):
            parts.append(box(f"leg{sx}", (0.002, 0.012, 0.012), (sx * 0.017, 0.001, 0.006), "village", vm["metal_dark"]))
        parts.append(box("bench_snow", (0.042, 0.012, 0.003), (0, 0, 0.0145), "village", vm["snow"], bevel=0.0012))
        out.append(assemble(f"bench{i}", parts, (x, y, sm.ground(x, y) - 0.002), rot, "village"))
    return out


def fairy_string(vm):
    """Strings of warm bulbs from the big tree to the cabin and the cinema."""
    tx, ty = sm.XMAS_TREE["p"]
    top = Vector((tx, ty, sm.ground(tx, ty) + sm.XMAS_TREE["h"] * 0.8))
    ends = [
        Vector((sm.CABIN["p"][0] - 0.05, sm.CABIN["p"][1] - 0.02, sm.ground(*sm.CABIN["p"]) + 0.1)),
        Vector((sm.CINEMA["p"][0] + 0.09, sm.CINEMA["p"][1] - 0.07, sm.ground(*sm.CINEMA["p"]) + 0.12)),
        Vector((0.12, -0.2, sm.ground(0.12, -0.2) + 0.085)),
    ]
    wires, bulbs = [], []
    for k, e in enumerate(ends):
        pts = []
        for i in range(41):
            t = i / 40
            p = top.lerp(e, t)
            p.z -= math.sin(t * math.pi) * 0.035
            pts.append(p)
        wires.append(geo.tube(f"wire{k}", pts, radius=0.0006, segments=5))
        for i in range(2, 40, 3):
            bulbs.append(sphere(f"fb{k}_{i}", 0.0024, pts[i] - Vector((0, 0, 0.002)), "village", glow("glow_fairy"), seg=6))
    w = geo.join(wires, "fairy_wire")
    w["group"] = "village"
    mat.assign(w, vm["black"])
    b = geo.join(bulbs, "fairy_bulbs")
    b["group"] = "village"
    # A lamp post at the far end of the third string
    return [w, b]


def skater(k, vm):
    coat = M(f"coat{k}", base=sm.lin(sm.SKATERS[k][3]), rough=0.6, sheen=0.5)
    hat = M(f"hat{k}", base=sm.lin(["#f2f2f2", "#f0b43c", "#2a5bd7", "#d83b3b", "#2aa89a"][k % 5]), rough=0.8, sheen=0.6)
    parts = [
        cyl("legs", 0.0035, 0.016, (0, 0, 0.009), "dynamic", vm["black"], seg=8, r2=0.004),
        cyl("body", 0.0055, 0.016, (0, 0, 0.024), "dynamic", coat, seg=10, r2=0.0045),
        sphere("head", 0.0042, (0, 0, 0.037), "dynamic", vm["skin"], seg=10),
        sphere("hat", 0.0045, (0, 0, 0.039), "dynamic", hat, seg=10, scale=(1, 1, 0.8)),
        sphere("pom", 0.0018, (0, 0, 0.0435), "dynamic", hat, seg=6),
        torus("scarf", 0.0042, 0.0014, (0, 0, 0.032), "dynamic", vm["ribbon_red"], u=12, v=5),
        box("blade", (0.009, 0.001, 0.0012), (0, 0, 0.0006), "dynamic", vm["gold"]),
    ]
    for sx in (-1, 1):
        parts.append(cyl(f"arm{sx}", 0.0014, 0.012, (sx * 0.0065, 0, 0.025), "dynamic", coat, rot=(0, sx * 0.9, 0), seg=6))
    o = geo.join(parts, f"skater_{k}")
    o["group"] = "dynamic"
    return o


def build_village():
    vm = village_mats()
    rng = random.Random(5)
    objs = []
    objs += ground_mesh(vm)
    objs += pond(vm)
    objs += path_mesh(vm)
    for i, (x, y, h) in enumerate(sm.tree_spots()):
        objs.append(pine(f"pine{i}", x, y, h, vm, rng))
    objs += xmas_tree(vm, rng)
    objs += cabin(vm)
    body, screens = cinema(vm)
    objs += body
    b1, s1 = billboard(sm.BILLBOARD, "billboard", 1000 / 1600, vm)
    b2, s2 = billboard(sm.SIGN, "sign", 378 / 1600, vm, lamps=False)
    objs += b1 + b2
    screens += s1 + s2
    for i, (x, y) in enumerate(sm.lamp_spots()):
        objs.append(lamp_post(i, x, y, vm))
    objs.append(snowman(vm))
    for c in sm.COTTAGES:
        objs.append(cottage(c, vm))
    objs += film_set(vm)
    objs += shrubs(vm)
    objs += benches(vm)
    objs += fairy_string(vm)
    skaters = [skater(k, vm) for k in range(len(sm.SKATERS))]
    for o in objs + screens + skaters:
        ensure_uv(o)
    return {"static": objs, "screens": screens, "skaters": skaters}


def pose_skaters(skaters, t):
    for k, o in enumerate(skaters):
        x, y, hd = sm.skater_pose(k, t)
        o.location = (x, y, sm.POND_Z)
        o.rotation_euler = (0, 0, hd)


# ---------------------------------------------------------------------------
# desk, props and the globe base


def film_texture(path):
    """35mm film strip: dark base, sprocket holes (alpha), faint frames."""
    W, H = 128, 512
    img = np.zeros((H, W, 4), np.float32)
    img[..., :3] = (0.09, 0.055, 0.03)
    img[..., 3] = 0.92
    for y0 in range(0, H, 64):
        # Frames: slightly lighter, warm amber exposures.
        img[y0 + 6 : y0 + 58, 24:104, :3] = (0.34, 0.2, 0.09)
        img[y0 + 10 : y0 + 54, 28:100, :3] = (0.55, 0.36, 0.17)
    for y0 in range(0, H, 16):
        for x0 in (6, W - 16):
            img[y0 + 4 : y0 + 12, x0 : x0 + 10, 3] = 0.0
    im = bpy.data.images.new("film_tex", W, H, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    return path


def stripe_texture(path):
    W, H = 256, 32
    img = np.ones((H, W, 4), np.float32)
    xs = np.arange(W)[None, :] + np.arange(H)[:, None]
    black = ((xs // 32) % 2) == 0
    img[black, :3] = 0.02
    img[~black, :3] = 0.9
    im = bpy.data.images.new("stripe_tex", W, H, alpha=True)
    im.pixels.foreach_set(img[::-1].ravel())
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    return path


def textured(name, path, **props):
    if name in _mats:
        return _mats[name]
    m = mat.principled(name, **props)
    t = mat.image_node(m, path, "sRGB")
    b = mat.bsdf_of(m)
    m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if "alpha" in props or name == "film":
        m.node_tree.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "DITHERED"
    _mats[name] = m
    return m


def desk_mats(out_dir):
    return {
        "desk": pbr_mat("desk_wood", "wood_table_001", "1k", diffuse_res="2k", normal_strength=0.6, rough=0.42, coat=0.25, coat_rough=0.25),
        "walnut": pbr_mat("walnut", "black_walnut_veneer_01", "1k", normal_strength=0.0, tint=sm.lin("#6b4630"), coat=1.0, coat_rough=0.04, rough=0.35),
        "brass": M("brass", base=sm.lin("#d6ab55"), metal=1.0, rough=0.2),
        "brass_dark": M("brass_engrave", base=sm.lin("#2a1d0c"), rough=0.5),
        "leather": pbr_mat("leather", "fabric_leather_02", "1k", normal_strength=0.8, tint=sm.lin("#3a2a22"), rough=0.55, sheen=0.3),
        "chrome": M("chrome", base=sm.lin("#dfe2e6"), metal=1.0, rough=0.1),
        "satin": M("satin_metal", base=sm.lin("#a9adb3"), metal=1.0, rough=0.3),
        "lens": M("lens_glass", base=sm.lin("#0a0f16"), rough=0.02, coat=1.0, coat_rough=0.0, specular=0.8),
        "black": M("black_paint", base=sm.lin("#141416"), rough=0.35, coat=0.4),
        "film": textured("film", film_texture(out_dir / "film.png"), rough=0.15, coat=0.6),
        "film_roll": M("film_roll", base=sm.lin("#2a1a10"), rough=0.12, coat=0.7),
        "slate": M("slate", base=sm.lin("#17181b"), rough=0.75),
        "chalk": M("chalk", base=sm.lin("#e9e9e4"), rough=0.95),
        "stripes": textured("stripes", stripe_texture(out_dir / "stripes.png"), rough=0.4, coat=0.3),
        "glaze": M("glaze", base=sm.lin("#efe7d8"), rough=0.12, coat=0.6, coat_rough=0.05),
        "glaze_band": M("glaze_band", base=sm.lin("#b8453a"), rough=0.15, coat=0.6),
        "coffee": M("coffee", base=sm.lin("#2b140a"), rough=0.04, coat=1.0),
        "cover": M("notebook_cover", base=sm.lin("#34465c"), rough=0.55, sheen=0.4),
        "pages": M("pages", base=sm.lin("#f1eadb"), rough=0.85),
        "elastic": M("elastic", base=sm.lin("#8a1f28"), rough=0.6, sheen=0.4),
        "pencil": M("pencil", base=sm.lin("#f2bf45"), rough=0.35, coat=0.5),
        "pencil_wood": M("pencil_wood", base=sm.lin("#e0bf92"), rough=0.7),
        "graphite": M("graphite", base=sm.lin("#2d2d30"), metal=0.3, rough=0.4),
        "eraser": M("eraser", base=sm.lin("#e98c8a"), rough=0.8),
        "book_a": M("book_a", base=sm.lin("#6d2b2b"), rough=0.6, sheen=0.3),
        "book_b": M("book_b", base=sm.lin("#2f4a3a"), rough=0.6, sheen=0.3),
        "book_c": M("book_c", base=sm.lin("#c7a46a"), rough=0.6, sheen=0.3),
        "wire": M("wire_green", base=sm.lin("#1d2b20"), rough=0.5),
    }


def desk_surface(dm):
    top = box("desk", (28.0, 22.0, 0.8), (0, 3.5, -0.4), "desk", dm["desk"], bevel=0.12, seg=4)
    geo.apply_all(top)
    # Only the top and the front edge are ever seen; the lightmap goes to them.
    bm = bmesh.new()
    bm.from_mesh(top.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.5 or (f.normal.y > 0.5 and f.calc_center_median().z < -0.05) or (abs(f.normal.x) > 0.5 and f.calc_center_median().z < -0.05)], context="FACES")
    bm.to_mesh(top.data)
    bm.free()
    planar_uv(top, 0.075, (0.2, 0.1))
    return [top]


def globe_base(dm):
    prof = [(0.0, 0.0), (0.96, 0.0), (0.99, 0.012), (1.0, 0.04), (0.995, 0.07), (0.975, 0.085), (0.95, 0.11), (0.92, 0.2), (0.895, 0.32), (0.88, 0.42), (0.872, 0.46), (0.86, 0.48)]
    base = lathe("globe_base", prof, "props", dm["walnut"], seg=96)
    ring = lathe("globe_ring", [(0.86, 0.478), (0.885, 0.49), (0.89, 0.52), (0.88, 0.55), (0.85, 0.575), (0.83, sm.BASE_TOP + 0.005), (0.0, sm.BASE_TOP + 0.005)], "props", dm["brass"], seg=96)
    # Cylindrical UVs for the veneer
    me = base.data
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = ((math.atan2(co.y, co.x) / math.tau) * 3.0, co.z * 1.6 + math.hypot(co.x, co.y) * 0.5)
    felt = cyl("globe_felt", 0.95, 0.01, (0, 0, 0.004), "props", M("felt", base=sm.lin("#2a3a2e"), rough=1.0, sheen=1.0), seg=64)
    # Brass plaque on the sloped front, engraved DAVIS DIGITAL
    tilt = math.atan2(0.97 - 0.88, 0.42 - 0.085)
    zc = 0.26
    rc = 0.955 - (zc - 0.085) * (0.97 - 0.88) / (0.42 - 0.085) + 0.012
    plaque = box("plaque", (0.66, 0.02, 0.15), (0, -rc, zc), "props", dm["brass"], rot=(-tilt, 0, 0), bevel=0.01, seg=3)
    t1 = text("plaque_text", "DAVIS DIGITAL", "BigCaslon.ttf", 0.078, (0, -rc - 0.0105, zc + 0.012), (math.pi / 2 - tilt, 0, 0), "props", dm["brass_dark"], extrude=0.0015, spacing=1.15)
    t2 = text("plaque_sub", "STORIES IN A TINY, PERFECT WORLD", "BigCaslon.ttf", 0.024, (0, -rc - 0.0105 + 0.001, zc - 0.042), (math.pi / 2 - tilt, 0, 0), "props", dm["brass_dark"], extrude=0.001, spacing=1.2)
    screws = [cyl(f"screw{sx}", 0.012, 0.01, (sx * 0.29, -rc - 0.012, zc + 0.0), "props", dm["brass"], rot=(math.pi / 2 - tilt, 0, 0), seg=12) for sx in (-1, 1)]
    return [base, ring, felt, plaque, t1, t2, *screws]


def film_camera(dm):
    """A clockwork 16mm cine camera: leather body, chrome plates, three-lens turret."""
    parts = []
    W, L, Hh = 1.35, 2.3, 1.9
    body = box("cam_body", (W, L, Hh), (0, 0, Hh / 2 + 0.02), "props", dm["leather"], bevel=0.14, seg=4)
    geo.apply_all(body)
    box_uv(body, 0.9)
    parts.append(body)
    for sx in (-1, 1):
        plate = box(f"cam_plate{sx}", (0.03, L * 0.86, Hh * 0.82), (sx * (W / 2 + 0.005), 0, Hh / 2 + 0.02), "props", dm["chrome"], bevel=0.05)
        parts.append(plate)
    parts.append(box("cam_top", (W * 0.92, L * 0.9, 0.06), (0, 0, Hh + 0.04), "props", dm["chrome"], bevel=0.03))
    parts.append(box("cam_front", (W * 0.94, 0.06, Hh * 0.9), (0, -L / 2 - 0.01, Hh / 2 + 0.02), "props", dm["chrome"], bevel=0.04))
    # Turret with three lenses
    tz = Hh * 0.52
    parts.append(cyl("turret", 0.56, 0.1, (0, -L / 2 - 0.09, tz), "props", dm["black"], rot=(math.pi / 2, 0, 0), seg=48))
    parts.append(cyl("turret_rim", 0.58, 0.04, (0, -L / 2 - 0.05, tz), "props", dm["chrome"], rot=(math.pi / 2, 0, 0), seg=48))
    for k, (ln, rr) in enumerate([(0.95, 0.26), (0.5, 0.2), (0.3, 0.17)]):
        a = math.pi / 2 + k * math.tau / 3
        cx, cz = math.cos(a) * 0.3, tz + math.sin(a) * 0.3
        y0 = -L / 2 - 0.14
        parts.append(cyl(f"lens{k}", rr, ln, (cx, y0 - ln / 2, cz), "props", dm["black"], rot=(math.pi / 2, 0, 0), seg=32))
        for j in range(3):
            parts.append(cyl(f"lens{k}_ring{j}", rr + 0.012, 0.035, (cx, y0 - ln * (0.2 + 0.3 * j), cz), "props", dm["chrome"] if j != 1 else dm["satin"], rot=(math.pi / 2, 0, 0), seg=32))
        parts.append(cyl(f"lens{k}_glass", rr * 0.8, 0.02, (cx, y0 - ln - 0.005, cz), "props", dm["lens"], rot=(math.pi / 2, 0, 0), seg=32))
    # Crank, wind key, viewfinder, handle
    parts.append(cyl("wind_key", 0.26, 0.05, (W / 2 + 0.05, 0.25, Hh * 0.55), "props", dm["chrome"], rot=(0, math.pi / 2, 0), seg=32))
    parts.append(box("crank_arm", (0.05, 0.08, 0.5), (W / 2 + 0.09, 0.25, Hh * 0.55 - 0.2), "props", dm["chrome"], bevel=0.02))
    parts.append(cyl("crank_knob", 0.07, 0.18, (W / 2 + 0.18, 0.25, Hh * 0.55 - 0.42), "props", dm["black"], rot=(0, math.pi / 2, 0), seg=16))
    parts.append(cyl("finder", 0.13, 0.9, (-W / 2 + 0.18, 0.1, Hh + 0.2), "props", dm["black"], rot=(math.pi / 2, 0, 0), seg=24))
    parts.append(cyl("finder_eye", 0.18, 0.2, (-W / 2 + 0.18, 0.6, Hh + 0.2), "props", dm["black"], rot=(math.pi / 2, 0, 0), seg=24, r2=0.14))
    parts.append(cyl("finder_glass", 0.1, 0.01, (-W / 2 + 0.18, -0.36, Hh + 0.2), "props", dm["lens"], rot=(math.pi / 2, 0, 0), seg=16))
    hpts = [(0.12, -0.7, Hh + 0.06), (0.12, -0.6, Hh + 0.34), (0.12, -0.2, Hh + 0.5), (0.12, 0.3, Hh + 0.5), (0.12, 0.65, Hh + 0.32), (0.12, 0.72, Hh + 0.06)]
    hcurve = [(0.12, y, z) for y, z in sm.path_points([(p[1], p[2]) for p in hpts], 0.05)]
    handle = geo.tube("handle", hcurve, radius=0.08, segments=12)
    handle["group"] = "props"
    mat.assign(handle, dm["leather"])
    box_uv(handle, 0.9)
    parts.append(handle)
    parts.append(text("cam_badge", "DDD-16", "DIN Condensed Bold.ttf", 0.16, (-W / 2 - 0.02, -0.4, Hh * 0.85), (math.pi / 2, 0, -math.pi / 2), "props", dm["chrome"], extrude=0.01))
    return assemble("film_camera", parts, (3.35, 1.55, 0.0), math.radians(-38), "props")


def film_reel(name, loc, rot, dm, filled=0.75):
    R = 1.45
    parts = []
    for sy in (-1, 1):
        fl = cyl(f"{name}_flange{sy}", R, 0.03, (0, sy * 0.1, 0), "props", dm["satin"], rot=(math.pi / 2, 0, 0), seg=64)
        # Six windows cut through each flange
        for k in range(6):
            a = k * math.tau / 6
            hole = cyl(f"{name}_hole{sy}{k}", 0.34, 0.2, (math.cos(a) * 0.78, sy * 0.1, math.sin(a) * 0.78), "props", dm["satin"], rot=(math.pi / 2, 0, 0), seg=24)
            m = fl.modifiers.new("hole", "BOOLEAN")
            m.object = hole
            m.operation = "DIFFERENCE"
            geo.apply_all(fl)
            bpy.data.objects.remove(hole, do_unlink=True)
        parts.append(fl)
    parts.append(cyl(f"{name}_hub", 0.22, 0.22, (0, 0, 0), "props", dm["satin"], rot=(math.pi / 2, 0, 0), seg=24))
    parts.append(cyl(f"{name}_roll", 0.25 + (R - 0.3) * filled, 0.17, (0, 0, 0), "props", dm["film_roll"], rot=(math.pi / 2, 0, 0), seg=64))
    o = assemble(name, parts, loc, 0, "props")
    o.rotation_euler = rot
    return o


def clapperboard(dm):
    parts = []
    W, H, T = 2.9, 2.3, 0.08
    parts.append(box("slate", (W, T, H), (0, 0, H / 2), "props", dm["slate"], bevel=0.03))
    stick = box("clap_base", (W, T * 1.1, 0.34), (0, 0, H + 0.17), "props", dm["stripes"], bevel=0.02)
    geo.apply_all(stick)
    box_uv(stick, 1.0 / W)
    parts.append(stick)
    arm = box("clap_arm", (W, T * 1.1, 0.34), (W / 2, 0, 0.17), "props", dm["stripes"], bevel=0.02)
    geo.apply_all(arm)
    box_uv(arm, 1.0 / W)
    arm.data.transform(Matrix.Translation((-W / 2, 0, 0)))
    arm.location = (-W / 2, 0, H + 0.36)
    arm.rotation_euler = (0, -math.radians(24), 0)
    parts.append(arm)
    parts.append(cyl("hinge", 0.06, 0.16, (-W / 2 + 0.05, 0, H + 0.34), "props", dm["chrome"], rot=(math.pi / 2, 0, 0), seg=12))
    y = -T / 2 - 0.004
    lines = [(0, H * 0.62), (0, H * 0.36)]
    for k, (lx, lz) in enumerate(lines):
        parts.append(box(f"chalk_line{k}", (W * 0.9, 0.004, 0.018), (lx, y, lz), "props", dm["chalk"]))
    parts.append(box("chalk_v", (0.018, 0.004, H * 0.26), (0, y, H * 0.49), "props", dm["chalk"]))
    parts.append(text("clap_title", "DAVIS DIGITAL", "Chalkduster.ttf", 0.3, (0, y - 0.002, H * 0.8), (math.pi / 2, 0, 0), "props", dm["chalk"], extrude=0.002))
    parts.append(text("clap_scene", "SCENE 01", "Chalkduster.ttf", 0.2, (-W * 0.24, y - 0.002, H * 0.49), (math.pi / 2, 0, 0), "props", dm["chalk"], extrude=0.002))
    parts.append(text("clap_take", "TAKE 03", "Chalkduster.ttf", 0.2, (W * 0.24, y - 0.002, H * 0.49), (math.pi / 2, 0, 0), "props", dm["chalk"], extrude=0.002))
    parts.append(text("clap_dir", "DIR. P. DAVIS", "Chalkduster.ttf", 0.16, (0, y - 0.002, H * 0.2), (math.pi / 2, 0, 0), "props", dm["chalk"], extrude=0.002))
    o = assemble("clapperboard", parts, (0, 0, 0), 0, "props")
    return o


def books(dm):
    out = []
    z = 0.0
    for k, (w, d, h, m, rot) in enumerate([(3.6, 2.6, 0.42, "book_a", 0.08), (3.3, 2.4, 0.36, "book_b", -0.12), (3.0, 2.2, 0.3, "book_c", 0.2)]):
        cover = box(f"book{k}", (w, d, h), (0, 0, z + h / 2), "props", dm[m], rot=(0, 0, rot), bevel=0.03)
        pages = box(f"pages{k}", (w * 0.97, d * 0.96, h * 0.8), (0.04 * math.cos(rot), 0.04 * math.sin(rot), z + h / 2), "props", dm["pages"], rot=(0, 0, rot))
        out += [cover, pages]
        z += h
    return assemble("books", out, (-5.1, 4.1, 0), math.radians(-24), "props"), z


def mug(dm):
    prof_out = [(0.0, 0.0), (0.46, 0.0), (0.5, 0.02), (0.53, 0.1), (0.55, 0.6), (0.56, 1.12), (0.55, 1.16)]
    prof_in = [(0.51, 1.16), (0.5, 1.1), (0.48, 0.2), (0.0, 0.16)]
    body = lathe("mug_body", prof_out + prof_in, "props", dm["glaze"], seg=64)
    band = lathe("mug_band", [(0.557, 0.78), (0.562, 0.8), (0.562, 0.92), (0.557, 0.94)], "props", dm["glaze_band"], seg=64)
    coffee = cyl("coffee", 0.495, 0.01, (0, 0, 0.98), "props", dm["coffee"], seg=48)
    hpts = [(0.52 + 0.3 * math.sin(t * math.pi), 0.0, 0.3 + 0.62 * t) for t in [i / 16 for i in range(17)]]
    handle = geo.tube("mug_handle", hpts, radius=0.075, segments=14)
    handle["group"] = "props"
    mat.assign(handle, dm["glaze"])
    return assemble("mug", [body, band, coffee, handle], (2.55, -2.35, 0), math.radians(-60), "props")


def notebook(dm):
    parts = []
    W, D = 2.6, 3.6
    parts.append(box("nb_back", (W, D, 0.06), (0, 0, 0.03), "props", dm["cover"], bevel=0.02))
    parts.append(box("nb_pages", (W * 0.97, D * 0.97, 0.2), (0.02, 0, 0.16), "props", dm["pages"]))
    parts.append(box("nb_front", (W, D, 0.06), (0, 0, 0.29), "props", dm["cover"], bevel=0.02))
    parts.append(box("nb_elastic", (0.1, D + 0.02, 0.33), (W * 0.36, 0, 0.165), "props", dm["elastic"]))
    parts.append(cyl("pencil", 0.07, 3.0, (0, 0, 0.39), "props", dm["pencil"], rot=(math.pi / 2, 0, 0.5), seg=6))
    ax, ay = -math.sin(0.5), math.cos(0.5)
    parts.append(cyl("pencil_tip", 0.07, 0.3, (-ax * 1.65, -ay * 1.65, 0.39), "props", dm["pencil_wood"], rot=(-math.pi / 2, 0, 0.5), seg=6, r2=0.012))
    parts.append(cyl("pencil_fer", 0.074, 0.14, (ax * 1.57, ay * 1.57, 0.39), "props", dm["brass"], rot=(math.pi / 2, 0, 0.5), seg=12))
    parts.append(cyl("pencil_eraser", 0.07, 0.16, (ax * 1.72, ay * 1.72, 0.39), "props", dm["eraser"], rot=(math.pi / 2, 0, 0.5), seg=12))
    return assemble("notebook", parts, (-4.3, -3.4, 0), math.radians(14), "props")


def film_strip(dm):
    """Film unspooling from the flat reel, across the desk, with one loop standing up."""
    pts = []
    for i in range(160):
        t = i / 159
        x = -4.6 + 6.0 * t
        y = -0.5 - 2.6 * t + 0.5 * math.sin(t * 6.0)
        z = 0.012 + 0.9 * math.exp(-((t - 0.55) / 0.08) ** 2)
        pts.append((x, y, z))

    def twist(i, t):
        k = math.exp(-((i / 159 - 0.55) / 0.1) ** 2)
        side = Vector((0, 0, 1)).cross(t).normalized()
        return Vector((0, 0, 1)).lerp(-side, k * 0.95).normalized()

    return ribbon("film_strip", pts, 0.47, "props", dm["film"], uv_len=1.9, twist=twist)


def fairy_desk():
    """A warm string of bulbs snaking behind the globe (bokeh in close-ups)."""
    pts = []
    for i in range(120):
        t = i / 119
        a = math.pi * (0.15 + 0.75 * t)
        r = 2.0 + 0.35 * math.sin(t * 9.0)
        pts.append((math.cos(a) * r * 1.4 + 0.3, math.sin(a) * r * 0.8 + 2.2, 0.06))
    w = geo.tube("desk_wire", pts, radius=0.03, segments=6)
    w["group"] = "props"
    mat.assign(w, M("wire_green", base=sm.lin("#1d2b20"), rough=0.5))
    bulbs = []
    for i in range(3, 120, 5):
        p = Vector(pts[i])
        bulbs.append(sphere(f"db{i}", 0.05, p + Vector((0, 0, 0.06)), "props", glow("glow_fairy"), seg=10, scale=(1, 1, 1.4)))
    b = geo.join(bulbs, "desk_bulbs")
    b["group"] = "props"
    return [w, b]


def build_desk(out_dir):
    dm = desk_mats(out_dir)
    objs = desk_surface(dm)
    objs += globe_base(dm)
    objs.append(film_camera(dm))
    objs.append(film_reel("reel_stand", (4.6, 4.3, 1.44), (math.radians(-6), 0.0, math.radians(28)), dm))
    objs.append(film_reel("reel_flat", (-5.7, -0.5, 0.14), (math.pi / 2, 0, 0.4), dm, filled=0.55))
    bk, top = books(dm)
    objs.append(bk)
    clap = clapperboard(dm)
    clap.location = (-4.6, 2.35, 0.0)
    clap.rotation_euler = (math.radians(-14), 0, math.radians(-24))
    objs.append(clap)
    objs.append(mug(dm))
    objs.append(notebook(dm))
    objs.append(film_strip(dm))
    objs += fairy_desk()
    for o in objs:
        ensure_uv(o)
    return objs


# ---------------------------------------------------------------------------
# Cycles-only pieces: glass, snowfall, aurora


def glass_material(name="globe_glass"):
    """Transmissive glass whose shadows pass light (no caustics in Cycles)."""
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    g = nt.nodes.new("ShaderNodeBsdfPrincipled")
    g.inputs["Base Color"].default_value = (*sm.lin("#eef8ff"), 1)
    g.inputs["Transmission Weight"].default_value = 1.0
    g.inputs["Roughness"].default_value = 0.0
    g.inputs["IOR"].default_value = 1.45
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    nt.links.new(lp.outputs["Is Shadow Ray"], mx.inputs[0])
    nt.links.new(lp.outputs["Is Diffuse Ray"], mx.inputs[1])
    nt.links.new(mx.outputs[0], mix.inputs[0])
    nt.links.new(g.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def build_glass():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=sm.R_OUT)
    inner = bmesh.new()
    bmesh.ops.create_uvsphere(inner, u_segments=128, v_segments=64, radius=sm.R_IN)
    bmesh.ops.reverse_faces(inner, faces=inner.faces)
    me_in = bpy.data.meshes.new("_in")
    inner.to_mesh(me_in)
    inner.free()
    bm.from_mesh(me_in)
    bpy.data.meshes.remove(me_in)
    # Drop the part buried in the base.
    zc = sm.GLOBE_C[2]
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z + zc < sm.BASE_TOP - 0.03], context="VERTS")
    o = _obj("globe_glass", bm, "glass", glass_material())
    o.location = sm.GLOBE_C
    geo.smooth(o, 180)
    return o


def build_snow(t=0.0, shake=0.0, seed=3, count=2600):
    """Snowflakes as Cycles point spheres inside the globe."""
    rng = np.random.default_rng(seed)
    c = np.array(sm.GLOBE_C)
    pts = []
    radii = []
    while len(pts) < count:
        p = rng.uniform(-1, 1, 3) * sm.R_IN * 0.96
        if np.linalg.norm(p) > sm.R_IN * 0.95:
            continue
        w = p + c
        if w[2] < sm.ground(w[0], w[1]) + 0.004:
            continue
        # Fewer flakes high in the dome when settled; evenly spread when shaken.
        if rng.random() > 0.55 + 0.45 * shake + 0.45 * (1 - (p[2] + 1) / 2):
            continue
        pts.append(tuple(w))
        radii.append(0.0022 + 0.0035 * rng.random() ** 2)
    me = bpy.data.meshes.new("snowfall")
    me.from_pydata(pts, [], [])
    a = me.attributes.new("radius", "FLOAT", "POINT")
    a.data.foreach_set("value", np.array(radii, np.float32))
    o = bpy.data.objects.new("snowfall", me)
    bpy.context.scene.collection.objects.link(o)
    o["group"] = "fx"
    ng = bpy.data.node_groups.new("snow_points", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = ng.nodes.new("NodeGroupInput")
    go = ng.nodes.new("NodeGroupOutput")
    m2p = ng.nodes.new("GeometryNodeMeshToPoints")
    rad = ng.nodes.new("GeometryNodeInputNamedAttribute")
    rad.data_type = "FLOAT"
    rad.inputs["Name"].default_value = "radius"
    setmat = ng.nodes.new("GeometryNodeSetMaterial")
    setmat.inputs["Material"].default_value = M("flake", base=(1, 1, 1), rough=0.4, subsurface=0.5, subsurface_scale=0.01, emission=(0.8, 0.9, 1.0), emission_strength=0.05)
    ng.links.new(gi.outputs[0], m2p.inputs["Mesh"])
    ng.links.new(rad.outputs["Attribute"], m2p.inputs["Radius"])
    ng.links.new(m2p.outputs[0], setmat.inputs["Geometry"])
    ng.links.new(setmat.outputs[0], go.inputs[0])
    o.modifiers.new("points", "NODES").node_group = ng
    return o


def aurora_material():
    m = bpy.data.materials.new("aurora")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    uv = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv.outputs["UV"], sep.inputs[0])
    # Vertical curtains: noise stretched along V.
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (7.0, 0.35, 1.0)
    nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.5
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    curt = nt.nodes.new("ShaderNodeValToRGB")
    curt.color_ramp.elements[0].position = 0.42
    curt.color_ramp.elements[0].color = (0, 0, 0, 1)
    curt.color_ramp.elements[1].position = 0.72
    curt.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(nz.outputs["Fac"], curt.inputs["Fac"])
    col = nt.nodes.new("ShaderNodeValToRGB")
    col.color_ramp.elements[0].position = 0.0
    col.color_ramp.elements[0].color = (*sm.lin("#2dffa8"), 1)
    col.color_ramp.elements[1].position = 1.0
    col.color_ramp.elements[1].color = (*sm.lin("#8a5cff"), 1)
    mid = col.color_ramp.elements.new(0.55)
    mid.color = (*sm.lin("#3fd6ff"), 1)
    nt.links.new(sep.outputs["Y"], col.inputs["Fac"])
    fade = nt.nodes.new("ShaderNodeValToRGB")
    fade.color_ramp.elements[0].position = 0.0
    fade.color_ramp.elements[0].color = (0, 0, 0, 1)
    fade.color_ramp.elements[1].position = 1.0
    fade.color_ramp.elements[1].color = (0, 0, 0, 1)
    e = fade.color_ramp.elements.new(0.18)
    e.color = (1, 1, 1, 1)
    e2 = fade.color_ramp.elements.new(0.6)
    e2.color = (0.5, 0.5, 0.5, 1)
    nt.links.new(sep.outputs["Y"], fade.inputs["Fac"])
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    nt.links.new(curt.outputs["Color"], mul.inputs[0])
    nt.links.new(fade.outputs["Color"], mul.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 3.0
    nt.links.new(col.outputs["Color"], em.inputs["Color"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(tr.outputs[0], add.inputs[1])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(mul.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(add.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def build_aurora():
    """A curtain arcing across the back of the dome (night only)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    cols = 90
    rows = 12
    grid = []
    for i in range(cols + 1):
        u = i / cols
        a = math.radians(-10 + 200 * u)
        rr = 0.66 + 0.08 * math.sin(u * 9.0)
        col = []
        for j in range(rows + 1):
            v = j / rows
            z = 1.28 + 0.62 * v + 0.06 * math.sin(u * 6.0 + 1.0)
            r2 = rr * (1 - 0.35 * v)
            col.append(bm.verts.new((math.cos(a) * r2, math.sin(a) * r2 + 0.05, z)))
        grid.append(col)
    for i in range(cols):
        for j in range(rows):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for loop, (du, dv) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv].uv = ((i + du) / cols, (j + dv) / rows)
    o = _obj("aurora", bm, "fx", aurora_material())
    o.visible_shadow = False
    return o
