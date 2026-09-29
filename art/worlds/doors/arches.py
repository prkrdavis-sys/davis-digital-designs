"""The five themed door arches. Each builder works in door-local space:
x across the opening, y depth (the visitor stands at -y), z up, origin at the
bottom centre of the opening. Returns frame objects, the two door leaves
(hinge at the local origin of each leaf mesh), and bulb positions."""

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from ddd import geo, mat
from ddd.cli import CACHE

import classic as cl

W = 1.2  # opening half-width
H = 3.0  # spring height (top of the straight legs)
PORTAL_Y = 0.16
LEAF_Y = 0.02
LEAF_T = 0.06

TEX = CACHE / "polyhaven" / "texture"


# --------------------------------------------------------------------------
# Materials (Principled only, so the glTF exporter maps them for three.js)
_mats = {}


def M(name, **props):
    if name not in _mats:
        _mats[name] = mat.principled(name, **props)
    return _mats[name]


def materials():
    _mats.clear()
    M("iron", base=(0.025, 0.026, 0.03), metal=1.0, rough=0.42)
    M("glass", base=(0.92, 0.98, 0.96), transmission=1.0, rough=0.03, ior=1.45)
    ivy = M("ivy", base=(0.2, 0.45, 0.12), rough=0.5, sheen=0.3, subsurface=0.1)
    nt = ivy.node_tree
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], mat.bsdf_of(ivy).inputs["Base Color"])
    M("vine", base=(0.13, 0.08, 0.05), rough=0.8)
    M("steel", base=(0.64, 0.66, 0.7), metal=1.0, rough=0.28, aniso=0.6)
    M("steel_dark", base=(0.16, 0.17, 0.19), metal=1.0, rough=0.38)
    M("seam", base=(0, 0, 0), emission=cl.lin("#5cf2e0"), emission_strength=7.0, rough=1.0)
    M("lacquer", base=(0.05, 0.012, 0.09), rough=0.14, coat=1.0, coat_rough=0.04)
    M("chrome", base=(0.95, 0.95, 0.97), metal=1.0, rough=0.07)
    M("neon_pink", base=(0, 0, 0), emission=cl.lin("#ff4fa0"), emission_strength=9.0, rough=1.0)
    M("neon_cyan", base=(0, 0, 0), emission=cl.lin("#2fe6ff"), emission_strength=9.0, rough=1.0)
    M("neon_yellow", base=(0, 0, 0), emission=cl.lin("#ffd84a"), emission_strength=9.0, rough=1.0)
    M("bulb", base=(1, 0.9, 0.7), emission=(1.0, 0.78, 0.45), emission_strength=14.0, rough=0.3)
    M("ice", base=(0.82, 0.94, 1.0), transmission=1.0, rough=0.1, ior=1.31, coat=0.6, coat_rough=0.05)
    M("snow", base=(0.93, 0.96, 1.0), rough=0.62, sheen=0.6, subsurface=0.2, subsurface_scale=0.05)
    sand = TEX / "sandstone_cracks"
    ss = mat.pbr("sandstone", {k: sand / f"sandstone_cracks_{k}_1k.png" for k in ("diffuse", "rough", "normal") if (sand / f"sandstone_cracks_{k}_1k.png").exists()}, scale=0.6, normal_strength=0.8)
    # Warm the scan toward honeyed sandstone.
    b = mat.bsdf_of(ss)
    link = next((lk for lk in ss.node_tree.links if lk.to_socket == b.inputs["Base Color"]), None)
    if link:
        tint = ss.node_tree.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs["Factor"].default_value = 1.0
        tint.inputs[7].default_value = (1.0, 0.78, 0.56, 1)
        ss.node_tree.links.new(link.from_socket, tint.inputs[6])
        ss.node_tree.links.new(tint.outputs[2], b.inputs["Base Color"])
    _mats["sandstone"] = ss
    M("gold", base=(1.0, 0.71, 0.29), metal=1.0, rough=0.2)
    wal = TEX / "black_walnut_veneer_01"
    maps = {k: wal / f"black_walnut_veneer_01_{k}_1k.png" for k in ("diffuse", "rough", "normal")}
    maps = {k: v for k, v in maps.items() if v.exists()}
    w = mat.pbr("wood", maps, scale=1.0, coat=0.5, coat_rough=0.12) if maps else M("wood", base=(0.12, 0.05, 0.025), rough=0.45, coat=0.5)
    _mats["wood"] = w
    return _mats


def cube_uv(obj, size=1.0):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=size)
    bpy.ops.object.mode_set(mode="OBJECT")


def with_mat(o, name):
    mat.assign(o, _mats[name])
    return o


def tube(name, pts2, y, radius, material, segments=10):
    o = geo.tube(name, [cl.to3(p, y) for p in pts2], radius=radius, segments=segments)
    geo.smooth(o, 60)
    return with_mat(o, material)


def leaf_panel(name, side, material, thick=LEAF_T, inset=None, inset_mat=None):
    """Half of the arched opening as a slab, hinge at the leaf's outer edge (local origin)."""
    x0, x1 = (-W, 0.0) if side < 0 else (0.0, W)
    p = cl.arch_panel(name, W, H, LEAF_Y, x0=x0 + (0.004 if side < 0 else 0.0), x1=x1 - (0.0 if side < 0 else 0.004), n_arc=24)
    sol = p.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = thick
    sol.offset = 1.0
    bev = p.modifiers.new("bevel", "BEVEL")
    bev.width = 0.01
    bev.segments = 2
    bev.limit_method = "ANGLE"
    geo.apply_all(p)
    with_mat(p, material)
    parts = [p]
    if inset:
        parts += inset(side)
    o = geo.join(parts, name) if len(parts) > 1 else p
    hinge = Vector((side * W, LEAF_Y, 0.0))
    o.data.transform(Matrix.Translation(-hinge))
    o["hinge"] = list(hinge)
    return o


def leaf_outline(side, offset):
    """2D outline points (x, z) around a leaf, shrunk by `offset`."""
    x_out = side * (W - offset)
    x_in = side * offset
    top = lambda x: H + math.sqrt(max(0.0, W * W - x * x))  # noqa: E731
    pts = [(x_in, offset), (x_in, top(x_in) - offset)]
    n = 14
    for i in range(1, n + 1):
        x = x_in + (x_out - x_in) * i / n
        pts.append((x, top(x) - offset * (1.0 + 0.6 * abs(x) / W)))
    pts.append((x_out, offset))
    pts.append((x_in, offset))
    return pts


# --------------------------------------------------------------------------
def sites():
    """Wrought iron and glass, overgrown with ivy."""
    parts = []
    for y in (-0.16, 0.12):
        band = cl.arch_ring("iron_band", W, H, 0.0, 0.07, y, y + 0.05, n_arc=48)
        parts.append(with_mat(band, "iron"))
        band2 = cl.arch_ring("iron_band2", W, H, 0.34, 0.41, y, y + 0.05, n_arc=48)
        parts.append(with_mat(band2, "iron"))
    # Fanlight glass between the bands.
    glass = cl.arch_ring("fan_glass", W, H, 0.07, 0.34, -0.03, -0.015, n_arc=48)
    parts.append(with_mat(glass, "glass"))
    # Radial bars and scroll spirals in the band.
    for k in range(13):
        a = math.pi * k / 12
        r0, r1 = W + 0.03, W + 0.38
        p0 = (r0 * math.cos(a), H + r0 * math.sin(a))
        p1 = (r1 * math.cos(a), H + r1 * math.sin(a))
        parts.append(tube(f"spoke{k}", [p0, p1], -0.02, 0.014, "iron", 8))
    for k in range(12):
        a = math.pi * (k + 0.5) / 12
        cx, cz = (W + 0.205) * math.cos(a), H + (W + 0.205) * math.sin(a)
        spiral = []
        for i in range(40):
            t = i / 39
            ang = a + t * math.pi * 3.2
            rr = 0.1 * (1 - t) + 0.015
            spiral.append((cx + rr * math.cos(ang), cz + rr * math.sin(ang)))
        parts.append(tube(f"scroll{k}", spiral, -0.02, 0.009, "iron", 6))
    for s in (-1, 1):
        for x in (s * (W + 0.035), s * (W + 0.375)):
            parts.append(with_mat(cl.box("post", (0.07, 0.34, H), (x, -0.02, H / 2), bevel=0.008), "iron"))
        # Side glass lights with iron muntins.
        parts.append(with_mat(cl.box("side_glass", (0.27, 0.012, H - 0.1), (s * (W + 0.205), -0.02, H / 2), bevel=0.0), "glass"))
        for z in (0.9, 1.8, 2.7):
            parts.append(with_mat(cl.box("muntin", (0.28, 0.03, 0.025), (s * (W + 0.205), -0.02, z)), "iron"))
        # Twisted finials.
        f = cl.cylinder("finial", 0.03, 0.4, (s * (W + 0.21), -0.02, H + W + 0.62), segments=12, radius2=0.004)
        parts.append(with_mat(f, "iron"))
    top = cl.lathe("crown", [(0.0, 0), (0.06, 0.02), (0.07, 0.08), (0.03, 0.14), (0.045, 0.2), (0.0, 0.42)], 16, (0, -0.02, H + W + 0.4))
    parts.append(with_mat(top, "iron"))

    # Ivy: vines climb the left post and spill over the crown; leaves hug them.
    rnd = random.Random(11)
    anchors = []
    vines = []
    for v in range(7):
        side = -1 if v < 4 else 1
        x = side * (W + rnd.uniform(0.0, 0.42))
        z = 0.0
        pts = []
        y = -0.2
        while z < (H + W * 0.95 if side < 0 else H * rnd.uniform(0.35, 0.8)):
            pts.append((x, y, z))
            z += 0.12
            x += rnd.uniform(-0.05, 0.05)
            if z > H:
                # follow the arch over the crown
                r = W + 0.2 + rnd.uniform(-0.15, 0.15)
                a = math.acos(max(-1.0, min(1.0, x / r))) if abs(x) < r else (math.pi if x < 0 else 0.0)
                a -= 0.12
                x = r * math.cos(a)
                z = H + r * math.sin(a)
            y = -0.2 + rnd.uniform(-0.03, 0.03)
            if len(pts) > 80:
                break
        if len(pts) > 2:
            vine = geo.tube(f"vine{v}", pts, radius=0.012, segments=6)
            vines.append(with_mat(vine, "vine"))
            for p in pts:
                n = Vector((rnd.uniform(-0.4, 0.4), -1.0, rnd.uniform(-0.2, 0.5))).normalized()
                for _ in range(3):
                    anchors.append((Vector(p) + Vector((rnd.uniform(-0.12, 0.12), 0, rnd.uniform(-0.08, 0.08))), n))
    leaves = cl.scatter_leaves("ivy", anchors, 1400, size=(0.05, 0.12), seed=5)
    with_mat(leaves, "ivy")
    parts += vines + [leaves]

    def inset(side):
        out = []
        pts = leaf_outline(side, 0.05)
        out.append(tube("leaf_rim", pts, LEAF_Y - 0.005, 0.02, "iron", 8))
        for z in (1.0, 2.0, 3.0):
            out.append(tube("leaf_bar", [(side * 0.05, z), (side * (W - 0.05), z)], LEAF_Y - 0.005, 0.012, "iron", 6))
        return out

    leaf_l = leaf_panel("leaf_sites_L", -1, "glass", thick=0.02, inset=inset)
    leaf_r = leaf_panel("leaf_sites_R", 1, "glass", thick=0.02, inset=inset)
    return parts, (leaf_l, leaf_r), []


def apps():
    """Brushed lab steel with fluorescent seams."""
    parts = []
    body = cl.arch_ring("steel_body", W, H, 0.0, 0.46, -0.4, 0.4, n_arc=56)
    b = body.modifiers.new("bevel", "BEVEL")
    b.width = 0.035
    b.segments = 3
    b.limit_method = "ANGLE"
    geo.apply_all(body)
    geo.smooth(body, 35)
    parts.append(with_mat(body, "steel"))
    # Recessed dark channel around the front, with the glowing seams inside it.
    ch = cl.arch_ring("channel", W, H, 0.17, 0.29, -0.415, -0.39, n_arc=56)
    parts.append(with_mat(ch, "steel_dark"))
    parts.append(tube("seam_outer", cl.arch_path(W, H, 0.23, 56, step=0.2), -0.418, 0.014, "seam", 8))
    parts.append(tube("seam_inner", cl.arch_path(W, H, 0.012, 56, step=0.2), -0.36, 0.01, "seam", 8))
    parts.append(tube("seam_back", cl.arch_path(W, H, 0.44, 56, step=0.2), 0.39, 0.01, "seam", 8))
    # Bolts.
    for p in cl.resample(cl.arch_path(W, H, 0.38, 56, step=0.1), 0.34):
        bolt = cl.cylinder("bolt", 0.022, 0.03, (0, 0, 0), segments=12)
        bolt.rotation_euler = (math.pi / 2, 0, 0)
        bolt.location = (p[0], -0.41, p[1])
        bolt.data.transform(bolt.matrix_world)
        bolt.matrix_world = Matrix.Identity(4)
        parts.append(with_mat(bolt, "chrome"))
    # Status module at the crown: a dark bezel with little lit segments.
    parts.append(with_mat(cl.box("status", (0.7, 0.08, 0.2), (0, -0.44, H + W + 0.23), bevel=0.02), "steel_dark"))
    for k in range(7):
        parts.append(with_mat(cl.box("led", (0.06, 0.02, 0.05), (-0.24 + k * 0.08, -0.485, H + W + 0.23)), "seam"))
    # Heavy feet.
    for s in (-1, 1):
        parts.append(with_mat(cl.box("foot", (0.6, 0.95, 0.22), (s * (W + 0.23), 0, 0.11), bevel=0.03), "steel_dark"))

    def inset(side):
        out = [with_mat(cl.box("leaf_seam", (0.018, 0.012, H - 0.3), (side * 0.06, LEAF_Y - 0.004, H / 2 + 0.05)), "seam")]
        for z in (0.7, 1.9):
            out.append(with_mat(cl.box("leaf_rib", (W - 0.3, 0.012, 0.03), (side * W / 2, LEAF_Y - 0.004, z)), "steel_dark"))
        return out

    return parts, (leaf_panel("leaf_apps_L", -1, "steel", inset=inset), leaf_panel("leaf_apps_R", 1, "steel", inset=inset)), []


def play():
    """Neon arcade arch with chasing marquee bulbs."""
    parts = []
    body = cl.arch_ring("arcade_body", W, H, 0.0, 0.52, -0.3, 0.3, n_arc=56)
    b = body.modifiers.new("bevel", "BEVEL")
    b.width = 0.04
    b.segments = 3
    b.limit_method = "ANGLE"
    geo.apply_all(body)
    geo.smooth(body, 35)
    parts.append(with_mat(body, "lacquer"))
    parts.append(with_mat(cl.arch_ring("lip", W, H, -0.035, 0.02, -0.33, 0.33, n_arc=56), "chrome"))
    parts.append(tube("neon_in", cl.arch_path(W, H, 0.08, 56, step=0.2, base=0.15), -0.33, 0.022, "neon_pink", 10))
    parts.append(tube("neon_out", cl.arch_path(W, H, 0.47, 56, step=0.2, base=0.15), -0.33, 0.022, "neon_cyan", 10))
    bulbs = [(p[0], -0.33, p[1]) for p in cl.resample(cl.arch_path(W, H, 0.275, 64, step=0.1, base=0.2), 0.17)]
    # Marquee sign on the crown.
    sz = H + W + 0.52 + 0.42
    parts.append(with_mat(cl.box("sign", (2.0, 0.26, 0.72), (0, -0.05, sz), bevel=0.05), "lacquer"))
    parts.append(with_mat(cl.box("sign_face", (1.84, 0.02, 0.58), (0, -0.19, sz)), "chrome"))
    for i in range(24):
        t = i / 24
        per = 2 * (1.84 + 0.58)
        d = t * per
        if d < 1.84:
            p = (-0.92 + d, sz + 0.29)
        elif d < 1.84 + 0.58:
            p = (0.92, sz + 0.29 - (d - 1.84))
        elif d < 2 * 1.84 + 0.58:
            p = (0.92 - (d - 1.84 - 0.58), sz - 0.29)
        else:
            p = (-0.92, sz - 0.29 + (d - 2 * 1.84 - 0.58))
        bulbs.append((p[0], -0.21, p[1]))
    cd = bpy.data.curves.new("play_txt", "FONT")
    cd.body = "PLAY"
    cd.size = 0.42
    cd.align_x = "CENTER"
    cd.align_y = "CENTER"
    cd.extrude = 0.012
    cd.bevel_depth = 0.012
    t = bpy.data.objects.new("play_txt", cd)
    bpy.context.scene.collection.objects.link(t)
    t.rotation_euler = (math.pi / 2, 0, 0)
    t.location = (0, -0.22, sz - 0.03)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
    txt = bpy.data.objects.new("play_sign_txt", me)
    bpy.context.scene.collection.objects.link(txt)
    txt.matrix_world = t.matrix_world.copy()
    bpy.data.objects.remove(t, do_unlink=True)
    geo.set_origin_world(txt)
    parts.append(with_mat(txt, "neon_yellow"))
    for s in (-1, 1):
        parts.append(with_mat(cl.box("post_cap", (0.64, 0.7, 0.18), (s * (W + 0.26), 0, 0.09), bevel=0.03), "chrome"))

    def inset(side):
        pts = leaf_outline(side, 0.07)
        return [tube("leaf_neon", pts, LEAF_Y - 0.01, 0.014, "neon_pink" if side < 0 else "neon_cyan", 8)]

    return parts, (leaf_panel("leaf_play_L", -1, "lacquer", inset=inset), leaf_panel("leaf_play_R", 1, "lacquer", inset=inset)), bulbs


def arc_band(name, r0, r1, y0, y1, a0, a1, n=40):
    bm = bmesh.new()
    rows = []
    for rad, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1)):
        rows.append([bm.verts.new((rad * math.cos(a0 + (a1 - a0) * i / n), y, H + rad * math.sin(a0 + (a1 - a0) * i / n))) for i in range(n + 1)])
    for k in range(4):
        A, B = rows[k], rows[(k + 1) % 4]
        for i in range(n):
            bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
    bm.faces.new([rows[k][0] for k in range(4)])
    bm.faces.new([rows[k][n] for k in reversed(range(4))])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return geo.obj_from_bmesh(name, bm)


def create():
    """Carved ice with frost and icicles."""
    parts = []
    ice = cl.voussoirs("ice_arch", W, H, 0.0, 0.5, -0.3, 0.3, count=9, gap=0.01, key_scale=1.22, legs=3, jitter=0.012, seed=4)
    parts.append(with_mat(ice, "ice"))
    rnd = random.Random(8)
    icicles = []
    for i in range(46):
        a = rnd.uniform(0.12, math.pi - 0.12)
        r = W - 0.005
        x, z = r * math.cos(a), H + r * math.sin(a)
        y = rnd.uniform(-0.28, 0.28) if rnd.random() < 0.6 else -0.28
        ln = rnd.uniform(0.08, 0.34) * (0.5 + 0.5 * math.sin(a))
        c = cl.cylinder("icicle", rnd.uniform(0.014, 0.03), ln, (x, y, z - ln / 2), segments=8, radius2=0.001)
        c.data.transform(Matrix.Translation((x, y, z - ln / 2)) @ Matrix.Rotation(math.pi, 4, "X") @ Matrix.Translation((-x, -y, -(z - ln / 2))))
        icicles.append(c)
    # Front-edge icicles off the extrados too, like meltwater frozen mid-drip.
    for i in range(18):
        a = rnd.uniform(0.3, math.pi - 0.3)
        r = W + 0.5
        x, z = r * math.cos(a), H + r * math.sin(a)
        ln = rnd.uniform(0.05, 0.18)
        c = cl.cylinder("icicle_o", 0.018, ln, (x, -0.3, z - ln / 2 - 0.02), segments=8, radius2=0.001)
        c.data.transform(Matrix.Translation((x, -0.3, z - ln / 2 - 0.02)) @ Matrix.Rotation(math.pi, 4, "X") @ Matrix.Translation((-x, 0.3, -(z - ln / 2 - 0.02))))
        icicles.append(c)
    ic = geo.join(icicles, "icicles")
    geo.smooth(ic, 50)
    parts.append(with_mat(ic, "ice"))
    snow = arc_band("snow_cap", W + 0.49, W + 0.6, -0.33, 0.33, 0.2, math.pi - 0.2, n=48)
    geo.subsurf(snow, 2)
    geo.displace_noise(snow, strength=0.05, scale=0.12, detail=2)
    geo.apply_all(snow)
    geo.smooth(snow, 60)
    parts.append(with_mat(snow, "snow"))
    for s in (-1, 1):
        drift = cl.box("drift", (0.8, 0.9, 0.16), (s * (W + 0.25), 0, 0.05))
        geo.subsurf(drift, 3)
        geo.displace_noise(drift, strength=0.06, scale=0.2, detail=2)
        geo.apply_all(drift)
        geo.smooth(drift, 60)
        parts.append(with_mat(drift, "snow"))

    def inset(side):
        pts = leaf_outline(side, 0.08)
        return [tube("leaf_frost", pts, LEAF_Y - 0.004, 0.012, "snow", 6)]

    return parts, (leaf_panel("leaf_create_L", -1, "ice", thick=0.07, inset=inset), leaf_panel("leaf_create_R", 1, "ice", thick=0.07, inset=inset)), []


def shop():
    """Warm sandstone voussoirs with gold inlay."""
    parts = []
    st = cl.voussoirs("sand_arch", W, H, 0.0, 0.56, -0.36, 0.36, count=13, gap=0.012, key_scale=1.32, legs=4, seed=2)
    cube_uv(st, 1.2)
    parts.append(with_mat(st, "sandstone"))
    for s in (-1, 1):
        imp = cl.box("impost", (0.78, 0.86, 0.16), (s * (W + 0.28), 0, H + 0.02), bevel=0.02)
        cube_uv(imp, 1.2)
        parts.append(with_mat(imp, "sandstone"))
        base = cl.box("base", (0.82, 0.9, 0.26), (s * (W + 0.28), 0, 0.13), bevel=0.02)
        cube_uv(base, 1.2)
        parts.append(with_mat(base, "sandstone"))
    parts.append(tube("inlay_in", cl.arch_path(W, H, 0.09, 64, step=0.15, base=0.3), -0.365, 0.011, "gold", 6))
    parts.append(tube("inlay_out", cl.arch_path(W, H, 0.47, 64, step=0.15, base=0.3), -0.365, 0.011, "gold", 6))
    # Sun medallion on the keystone.
    cz = H + W + 0.34
    disc = cl.cylinder("sun", 0.12, 0.03, (0, 0, 0), segments=32)
    disc.rotation_euler = (math.pi / 2, 0, 0)
    disc.location = (0, -0.37, cz)
    disc.data.transform(disc.matrix_world)
    disc.matrix_world = Matrix.Identity(4)
    parts.append(with_mat(disc, "gold"))
    for k in range(16):
        a = 2 * math.pi * k / 16
        r0, r1 = 0.14, 0.22 if k % 2 == 0 else 0.18
        parts.append(tube("ray", [(r0 * math.cos(a), cz + r0 * math.sin(a)), (r1 * math.cos(a), cz + r1 * math.sin(a))], -0.37, 0.008, "gold", 5))
    # Gold studs on the leg blocks.
    for s in (-1, 1):
        for z in (0.55, 1.3, 2.05, 2.8):
            st_ = cl.lathe("stud", [(0.0, 0), (0.03, 0.0), (0.026, 0.012), (0.0, 0.02)], 12, (0, 0, 0))
            st_.rotation_euler = (math.pi / 2, 0, 0)
            st_.location = (s * (W + 0.28), -0.36, z)
            st_.data.transform(st_.matrix_world)
            st_.matrix_world = Matrix.Identity(4)
            parts.append(with_mat(st_, "gold"))

    def inset(side):
        out = []
        for z in (0.5, 1.2, 1.9, 2.6, 3.3):
            for x in (0.25, 0.6, 0.95):
                if z > 3.0 and x > 0.8:
                    continue
                d = cl.lathe("leaf_stud", [(0.0, 0), (0.028, 0.0), (0.024, 0.014), (0.0, 0.022)], 10, (0, 0, 0))
                d.rotation_euler = (math.pi / 2, 0, 0)
                d.location = (side * x, LEAF_Y - 0.001, z)
                d.data.transform(d.matrix_world)
                d.matrix_world = Matrix.Identity(4)
                out.append(with_mat(d, "gold"))
        return out

    wl = leaf_panel("leaf_shop_L", -1, "wood", inset=inset)
    wr = leaf_panel("leaf_shop_R", 1, "wood", inset=inset)
    for o in (wl, wr):
        cube_uv(o, 1.0)
    return parts, (wl, wr), []


BUILDERS = {"sites": sites, "apps": apps, "play": play, "create": create, "shop": shop}
