"""Folded paper dart + its printed paper (notebook, airmail, graph, dot grid).

Plane space (Blender): nose toward +Y, up +Z, span along X, length 1.0.
UVs follow the sheet: u = 0.5 at the keel's bottom edge (the sheet's centre
fold), 0.5 +/- 0.13 at the wing root creases, 0 / 1 along the leading edges;
v = 0 at the trailing edge, 1 at the nose. The print atlas has four 1024 px
designs in a 2x2 grid; the runtime picks one per plane.
"""

import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from pl_common import lin

NOSE, TAIL = 0.55, -0.45
KEEL = 0.11
HALF_SPAN = 0.31
DIHEDRAL = 0.045
U_KEEL = KEEL / (KEEL + math.hypot(HALF_SPAN, DIHEDRAL))  # keel share of the half sheet


def root(a):
    return Vector((0.0, NOSE + (TAIL - NOSE) * a, 0.0))


def lead(a, side):
    return Vector((side * HALF_SPAN * a, NOSE + (TAIL - NOSE) * a, DIHEDRAL * a))


def wing_pt(a, w, side):
    p = root(a).lerp(lead(a, side), w)
    p.z += 0.016 * math.sin(math.pi * w) * a  # camber: the paper bows up a little
    if a > 0.88:  # up-elevators folded at the trailing edge, outer part of the wing
        p.z += (a - 0.88) / 0.12 * 0.028 * max(0.0, (w - 0.3) / 0.7)
    return p


def keel_pt(a, c, side):
    p = root(a)
    p.z -= KEEL * a * c
    p.x += side * 0.007 * c * a  # the two keel layers splay slightly at the bottom
    return p


def _uv_wing(a, w, side):
    return (0.5 + side * 0.5 * (U_KEEL + (1 - U_KEEL) * w), 1.0 - a)


def _uv_keel(a, c, side):
    return (0.5 + side * 0.5 * U_KEEL * (1 - c), 1.0 - a)


def plane_mesh(name="plane", na=16, nw=9, nk=3, coll=None):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    col = bm.loops.layers.color.new("Col")

    def patch(fn, uvfn, shade, n0, n1, side, flip):
        grid = []
        for i in range(n0 + 1):
            a = i / n0
            row = []
            for j in range(n1 + 1):
                f = j / n1
                row.append((bm.verts.new(fn(a, f, side)), uvfn(a, f, side), shade(a, f)))
            grid.append(row)
        for i in range(n0):
            for j in range(n1):
                q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
                if i == 0:
                    q = [grid[0][0], grid[1][j], grid[1][j + 1]]
                if (side < 0) != flip:
                    q = q[::-1]
                try:
                    face = bm.faces.new([v for v, _, _ in q])
                except ValueError:
                    continue
                for loop, (_, t, s) in zip(face.loops, q):
                    loop[uv].uv = t
                    loop[col] = (s, s, s, 1.0)

    for side in (-1, 1):
        # Wing: darker in the root crease and in the shadow line under the nose flap edge.
        def wing_shade(a, w):
            crease = 1.0 - 0.28 * math.exp(-w * 16.0)
            edge = 0.62 * (1 - a) + 0.02  # flap edge in (a, w) space
            flap = 1.0 - 0.18 * math.exp(-max(0.0, w - edge) * 40.0) * (1.0 if w > edge else 0.0) * min(1.0, a * 3)
            return crease * flap

        patch(wing_pt, _uv_wing, wing_shade, na, nw, side, False)
        patch(keel_pt, _uv_keel, lambda a, c: 0.72 + 0.28 * c, na, nk, side, True)

        # Nose flap: a folded layer lying on the forward part of the wing, lifted by the paper's thickness.
        def flap_pt(a, f, side=side):
            span = 0.62 * (1 - a) + 0.02
            p = wing_pt(a * 0.62, f * span * (1.0 - a * 0.0), side)
            return p + Vector((0, 0, 0.0032 + 0.002 * f))

        def flap_uv(a, f, side=side):
            u, v = _uv_wing(a * 0.62, f * (0.62 * (1 - a) + 0.02), side)
            return (1.0 - u, v)  # the back of the sheet, mirrored

        patch(flap_pt, flap_uv, lambda a, f: 1.0 - 0.1 * f, 8, 4, side, False)

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    me.shade_smooth()
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=math.radians(25))
    me.color_attributes.active_color = me.color_attributes["Col"]
    return o


# --------------------------------------------------------------------------
# Print atlas (numpy). Cells: 0 notebook, 1 airmail, 2 graph, 3 dot grid.
def _hex(h):
    return np.array([int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


def _fiber(path, n):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    g = px.reshape(h, w, 4)[..., :3].mean(-1)
    g = (g - g.mean()) / (g.std() + 1e-6)
    return np.tile(g, (int(math.ceil(n / h)), int(math.ceil(n / w))))[:n, :n]


def _line(coord, spacing, width_px, n, offset=0.0):
    """Anti-aliased periodic lines (coord in 0..1, width in pixels of an n-px cell)."""
    d = np.abs(((coord - offset) / spacing + 0.5) % 1.0 - 0.5) * spacing * n
    return np.clip(width_px * 0.5 + 0.5 - d, 0, 1)


def print_atlas(fiber_path, n=1024):
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    u = (xs + 0.5) / n
    v = 1.0 - (ys + 0.5) / n  # image rows top -> bottom; v = 1 at the nose
    fiber = _fiber(fiber_path, n)
    side = np.abs(u - 0.5)
    wing = side > 0.5 * U_KEEL
    cells = []

    def paper(base, amount=0.035):
        c = np.ones((n, n, 3), dtype=np.float32) * _hex(base)
        return c * (1.0 + fiber[..., None] * amount)

    def ink(c, mask, color, alpha=1.0):
        m = np.clip(mask, 0, 1)[..., None] * alpha
        return c * (1 - m) + _hex(color) * m

    # 0 notebook: ruled blue lines across the wings, one red margin.
    c = paper("#fbf6ec")
    c = ink(c, _line(v, 0.034, 2.2, n, 0.012) * wing * (v < 0.93), "#8fb1e8", 0.6)
    c = ink(c, _line(u, 1.0, 2.4, n, 0.2) * (u < 0.5), "#ef7d86", 0.75)
    cells.append(c)

    # 1 airmail: red/blue diagonal border along the leading and trailing edges + a stamp.
    c = paper("#fffaf3")
    diag = ((xs + ys) / (n * 0.028)) % 3.0
    stripe_col = np.where(diag < 1.0, 0, np.where(diag < 2.0, 1, 2))
    band = ((side > 0.445) | ((v < 0.055) & wing)) & wing
    red = (stripe_col == 0) & band
    blue = (stripe_col == 1) & band
    c = ink(c, red.astype(np.float32), "#e2474b", 0.92)
    c = ink(c, blue.astype(np.float32), "#3860c8", 0.92)
    # Stamp on the right wing: perforated frame, sun over clouds.
    su0, su1, sv0, sv1 = 0.70, 0.84, 0.12, 0.30
    inside = (u > su0) & (u < su1) & (v > sv0) & (v < sv1)
    perf = (np.abs(((u - su0) / 0.012) % 1 - 0.5) < 0.25) & ((np.abs(v - sv0) < 0.004) | (np.abs(v - sv1) < 0.004))
    perf |= (np.abs(((v - sv0) / 0.012) % 1 - 0.5) < 0.25) & ((np.abs(u - su0) < 0.004) | (np.abs(u - su1) < 0.004))
    c = ink(c, inside.astype(np.float32), "#ffe2c4", 1.0)
    inner = (u > su0 + 0.012) & (u < su1 - 0.012) & (v > sv0 + 0.012) & (v < sv1 - 0.012)
    c = ink(c, inner.astype(np.float32), "#ffc7a0", 1.0)
    sun = np.hypot((u - (su0 + su1) / 2) * 1.0, (v - (sv0 + sv1) / 2 - 0.02) * 0.75) < 0.028
    c = ink(c, (sun & inner).astype(np.float32), "#ff8a4c", 1.0)
    wave = (v - sv0 - 0.035 - 0.012 * np.sin((u - su0) * 90.0)) < 0.0
    c = ink(c, (wave & inner).astype(np.float32), "#fff4e6", 1.0)
    c = ink(c, perf.astype(np.float32), "#fffaf3", 1.0)
    # Postmark rings half over the stamp.
    r = np.hypot(u - su0 + 0.01, (v - sv1 + 0.02) * 0.8)
    rings = (np.abs(r - 0.055) < 0.0025) | (np.abs(r - 0.042) < 0.0018)
    waves = (np.abs(v - sv1 + 0.02 - 0.006 * np.sin(u * 160)) % 0.018 < 0.0025) & (u > su0 - 0.2) & (u < su0 - 0.06) & (np.abs(v - sv1 + 0.02) < 0.03)
    c = ink(c, (rings | waves).astype(np.float32), "#3f4a66", 0.45)
    cells.append(c)

    # 2 graph paper, peach.
    c = paper("#ffe6d6", 0.03)
    c = ink(c, np.maximum(_line(u, 0.025, 1.4, n), _line(v, 0.025, 1.4, n)), "#f2b196", 0.55)
    c = ink(c, np.maximum(_line(u, 0.125, 2.4, n), _line(v, 0.125, 2.4, n)), "#e8977a", 0.6)
    cells.append(c)

    # 3 lavender dot grid.
    c = paper("#ece4ff", 0.03)
    dots = (np.hypot(((u / 0.03) % 1 - 0.5) * 0.03 * n, ((v / 0.03) % 1 - 0.5) * 0.03 * n) < 2.0).astype(np.float32)
    c = ink(c, dots, "#a99be0", 0.7)
    cells.append(c)

    atlas = np.zeros((2 * n, 2 * n, 3), dtype=np.float32)
    atlas[:n, :n] = cells[0]
    atlas[:n, n:] = cells[1]
    atlas[n:, :n] = cells[2]
    atlas[n:, n:] = cells[3]
    return np.clip(atlas, 0, 1), cells


def save_png(rgb, path, name="img"):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([rgb, np.ones((h, w, 1), dtype=np.float32)], axis=-1)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    return img


def paper_material(name, image_path, cell=None, translucency=0.35):
    """Cycles paper: printed base color, fiber bump, a little light through the sheet."""
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.72
    bsdf.inputs["Sheen Weight"].default_value = 0.25
    uvn = N.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    vec = uvn.outputs[0]
    if cell is not None:
        mp = N.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (0.5, 0.5, 1)
        mp.inputs["Location"].default_value = ((cell % 2) * 0.5, (1 - cell // 2) * 0.5, 0)
        L.new(vec, mp.inputs["Vector"])
        vec = mp.outputs[0]
    tex = N.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
    tex.interpolation = "Cubic"
    L.new(vec, tex.inputs["Vector"])
    vc = N.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mul = N.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    L.new(tex.outputs["Color"], mul.inputs["A"])
    L.new(vc.outputs["Color"], mul.inputs["B"])
    L.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    tr = N.new("ShaderNodeBsdfTranslucent")
    L.new(tex.outputs["Color"], tr.inputs["Color"])
    mix = N.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = translucency
    L.new(bsdf.outputs[0], mix.inputs[1])
    L.new(tr.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs["Surface"])
    return m


def lantern(name, color="#ffb35c", strength=40.0, coll=None):
    """Tiny glowing paper lantern (night variant)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.05)
    for v in bm.verts:
        v.co.z *= 1.25
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Emission Color"].default_value = (*lin(color), 1)
    b.inputs["Emission Strength"].default_value = strength
    me.materials.append(m)
    return o
