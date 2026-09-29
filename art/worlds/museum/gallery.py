"""Gallery furniture for the marble hall: swept picture frames, picture
lights, benches, stanchions with velvet rope, plinths, placards, and the
Poly Haven sculptures. Blender units are meters, Z up."""

import math
import pathlib
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from ddd import geo, mat
from ddd.cli import CACHE

import classic as cl

MODELS = CACHE / "polyhaven" / "model"


def lin(h):
    return cl.lin(h)


_m = {}


def M(name, **props):
    if name not in _m:
        _m[name] = mat.principled(name, **props)
    return _m[name]


def materials():
    _m.clear()
    M("gilt", base=(1.0, 0.74, 0.36), metal=1.0, rough=0.24)
    M("gilt_dark", base=(0.62, 0.42, 0.18), metal=1.0, rough=0.4)
    M("liner", base=lin("#efe6d6"), rough=0.85, sheen=0.4)
    M("frame_black", base=(0.02, 0.02, 0.022), rough=0.35, coat=0.3)
    M("frame_oak", base=lin("#b88a5a"), rough=0.5, coat=0.2)
    M("mat_board", base=lin("#f6f3ee"), rough=0.9)
    M("brass", base=(0.95, 0.72, 0.42), metal=1.0, rough=0.18)
    M("lamp", base=(1, 0.95, 0.85), emission=(1.0, 0.86, 0.66), emission_strength=6.0, rough=0.4)
    M("velvet", base=lin("#8a0f1e"), rough=0.75, sheen=1.0, sheen_rough=0.35)
    M("plaque", base=lin("#1c1a1e"), rough=0.35, coat=0.4)
    M("can", base=(0.03, 0.03, 0.035), metal=0.6, rough=0.35)
    return _m


def ring_sweep(name, hw, hh, profile, material):
    """Mitred rectangular frame from a (out, depth) profile swept around the sight edge.
    Profile runs from the sight edge (out=0) to the back of the outer edge."""
    bm = bmesh.new()
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    rings = []
    for sx, sy in corners:
        ring = []
        for u, v in profile:
            ring.append(bm.verts.new((sx * (hw + u), -v, sy * (hh + u))))
        rings.append(ring)
    n = len(profile)
    for c in range(4):
        a, b = rings[c], rings[(c + 1) % 4]
        for j in range(n - 1):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm)
    geo.smooth(o, 32)
    mat.assign(o, _m[material])
    return o


def gilded_frame(name, cw, ch):
    """Ornate gilded frame around a cw x ch canvas, facing -Y (canvas at y=0).
    Returns (objects, outer half-width, outer half-height)."""
    hw, hh = cw / 2, ch / 2
    parts = []
    # Linen liner, then gilt: sight bead, cove, ogee crown, outer bead, back edge.
    liner = [(-0.004, 0.0), (0.0, 0.012), (0.06, 0.016), (0.075, 0.03)]
    parts.append(ring_sweep(f"{name}_liner", hw, hh, liner, "liner"))
    prof = []
    for k in range(9):
        a = math.pi * k / 8
        prof.append((0.075 + 0.02 * (1 - math.cos(a)), 0.03 + 0.03 * math.sin(a)))
    for k in range(1, 9):
        t = k / 8
        prof.append((0.115 + 0.08 * t, 0.03 + 0.05 * t - 0.035 * math.sin(math.pi * t)))
    for k in range(1, 11):
        t = k / 10
        prof.append((0.195 + 0.07 * t, 0.08 + 0.035 * math.sin(math.pi * t * 1.3) - 0.05 * t))
    for k in range(1, 9):
        a = math.pi * k / 8
        prof.append((0.265 + 0.018 * (1 - math.cos(a)), 0.045 + 0.022 * math.sin(a)))
    prof.append((0.3, 0.02))
    prof.append((0.3, -0.03))
    parts.append(ring_sweep(f"{name}_gilt", hw, hh, prof, "gilt"))
    # Corner cartouches: little shells of gilt on the crown.
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        sh = cl.lathe(f"{name}_shell", [(0.0, 0.0), (0.07, 0.0), (0.065, 0.025), (0.035, 0.045), (0.0, 0.05)], 12, (0, 0, 0))
        sh.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
        sh.location = (sx * (hw + 0.2), -0.075, sy * (hh + 0.2))
        geo.set_origin_world(sh)
        mat.assign(sh, _m["gilt"])
        parts.append(sh)
    # Crest at the top centre.
    crest = cl.lathe(f"{name}_crest", [(0.0, 0.0), (0.14, 0.0), (0.12, 0.04), (0.06, 0.07), (0.0, 0.08)], 16, (0, 0, 0))
    crest.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    crest.data.transform(Matrix.Diagonal((1.6, 1.0, 0.8, 1.0)))
    crest.location = (0, -0.07, hh + 0.27)
    geo.set_origin_world(crest)
    mat.assign(crest, _m["gilt"])
    parts.append(crest)
    return parts, hw + 0.3, hh + 0.3


def modern_frame(name, cw, ch, wood="frame_black"):
    """Deep box frame with a wide white mat, the gallery-modern alternative."""
    hw, hh = cw / 2, ch / 2
    parts = []
    mat_w = 0.16
    board = [(-0.002, 0.0), (0.0, 0.006), (mat_w, 0.006), (mat_w, 0.01)]
    parts.append(ring_sweep(f"{name}_mat", hw, hh, board, "mat_board"))
    box = [(mat_w, 0.01), (mat_w, 0.06), (mat_w + 0.045, 0.065), (mat_w + 0.05, 0.06), (mat_w + 0.05, -0.02)]
    parts.append(ring_sweep(f"{name}_box", hw, hh, box, wood))
    return parts, hw + mat_w + 0.05, hh + mat_w + 0.05


def picture_light(name, width):
    """Brass picture light: wall plate, curved arm, hood with a lit strip (local: wall at y=0, facing -Y)."""
    parts = []
    plate = cl.box(f"{name}_plate", (0.12, 0.02, 0.08), (0, -0.01, 0), bevel=0.005)
    mat.assign(plate, _m["brass"])
    parts.append(plate)
    arm_pts = [(0, -0.02, 0.0), (0, -0.12, 0.06), (0, -0.24, 0.07), (0, -0.32, 0.04)]
    arm = geo.tube(f"{name}_arm", arm_pts, radius=0.012, segments=10)
    mat.assign(arm, _m["brass"])
    parts.append(arm)
    hood = cl.cylinder(f"{name}_hood", 0.045, width, (0, 0, 0), segments=24)
    hood.data.transform(Matrix.Rotation(math.pi / 2, 4, "Y"))
    hood.location = (0, -0.34, 0.03)
    geo.set_origin_world(hood)
    mat.assign(hood, _m["brass"])
    parts.append(hood)
    strip = cl.box(f"{name}_strip", (width * 0.96, 0.03, 0.01), (0, -0.33, -0.012))
    mat.assign(strip, _m["lamp"])
    parts.append(strip)
    return parts


def stanchion(name, loc):
    x, y, z = loc
    prof = [(0.0, 0.0), (0.16, 0.0), (0.16, 0.02), (0.1, 0.05), (0.03, 0.07), (0.022, 0.1), (0.022, 0.86), (0.035, 0.88), (0.04, 0.92), (0.03, 0.95), (0.045, 0.98), (0.045, 1.0), (0.0, 1.04)]
    post = cl.lathe(name, prof, 24, (x, y, z))
    mat.assign(post, _m["brass"])
    return post


def rope(name, a, b, sag=0.18, radius=0.022):
    a, b = Vector(a), Vector(b)
    pts = []
    for k in range(25):
        t = k / 24
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    o = geo.tube(name, pts, radius=radius, segments=12)
    geo.smooth(o, 60)
    mat.assign(o, _m["velvet"])
    return o


def bench(name, loc, length=2.4, yaw=0.0):
    x, y, z = loc
    walnut = mat.principled(f"{name}_walnut", base=lin("#3b2415"), rough=0.4, coat=0.5, coat_rough=0.15)
    leather = mat.principled(f"{name}_leather", base=lin("#5a2f22"), rough=0.45, sheen=0.4, coat=0.2)
    parts = []
    frame = cl.box(f"{name}_frame", (0.62, length, 0.08), (0, 0, 0.36), bevel=0.012)
    mat.assign(frame, walnut)
    parts.append(frame)
    cush = cl.box(f"{name}_cushion", (0.58, length - 0.06, 0.1), (0, 0, 0.45))
    geo.subsurf(cush, 2)
    geo.apply_all(cush)
    # Button tufting: dimple the top.
    for v in cush.data.vertices:
        if v.co.z > 0.47:
            u = v.co.y / 0.3
            w = v.co.x / 0.2
            v.co.z -= 0.012 * (math.cos(u * math.pi) * math.cos(w * math.pi)) ** 8
    geo.smooth(cush, 60)
    mat.assign(cush, leather)
    parts.append(cush)
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = cl.box(f"{name}_leg", (0.06, 0.06, 0.34), (sx * 0.25, sy * (length / 2 - 0.1), 0.17), bevel=0.008)
            mat.assign(leg, walnut)
            parts.append(leg)
    rail = cl.box(f"{name}_rail", (0.04, length - 0.3, 0.04), (0, 0, 0.12))
    mat.assign(rail, walnut)
    parts.append(rail)
    o = geo.join(parts, name)
    cl.place(o, (x, y, z), yaw)
    return o


def plinth(name, loc, size=(0.7, 0.7, 1.15), stone=None):
    x, y, z = loc
    w, d, h = size
    parts = [
        cl.box(f"{name}_foot", (w + 0.12, d + 0.12, 0.1), (x, y, z + 0.05), bevel=0.01),
        cl.box(f"{name}_die", (w, d, h - 0.2), (x, y, z + 0.1 + (h - 0.2) / 2), bevel=0.006),
        cl.box(f"{name}_cap", (w + 0.1, d + 0.1, 0.1), (x, y, z + h - 0.05), bevel=0.01),
    ]
    o = geo.join(parts, name)
    if stone:
        mat.assign(o, stone)
    return o


def append_model(asset, res="1k"):
    """Append the mesh objects of a Poly Haven model .blend. Returns the new objects."""
    path = MODELS / asset / res / f"{asset}_{res}.blend"
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        dst.objects = [n for n in src.objects]
    out = []
    for o in dst.objects:
        if o is None or o.type != "MESH":
            continue
        bpy.context.scene.collection.objects.link(o)
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        out.append(o)
    return out


def sculpture(asset, loc, height, yaw=0.0):
    """Poly Haven sculpture scaled to `height`, standing on loc (bottom centre)."""
    objs = append_model(asset)
    o = geo.join(objs, asset) if len(objs) > 1 else objs[0]
    o.name = asset
    zs = [v.co.z for v in o.data.vertices]
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    s = height / (max(zs) - min(zs))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    o.data.transform(Matrix.Translation((loc[0], loc[1], loc[2])) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -cy, -min(zs))))
    return o


def placard_text(name, title, sub, loc, yaw):
    """Cycles-only placard lettering (the runtime draws the placard on a canvas)."""
    out = []
    for k, (txt, size, dz) in enumerate(((title, 0.034, 0.03), (sub, 0.02, -0.03))):
        cd = bpy.data.curves.new(f"{name}_t{k}", "FONT")
        cd.body = txt
        cd.size = size
        cd.align_x = "LEFT"
        t = bpy.data.objects.new(f"{name}_t{k}", cd)
        bpy.context.scene.collection.objects.link(t)
        t.rotation_euler = (math.pi / 2, 0, 0)
        t.location = (-0.13, -0.008, dz)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(t.evaluated_get(dg))
        o = bpy.data.objects.new(f"{name}_txt{k}", me)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = t.matrix_world.copy()
        bpy.data.objects.remove(t, do_unlink=True)
        geo.set_origin_world(o)
        cl.place(o, loc, yaw)
        mat.assign(o, M("placard_ink", base=lin("#efe6d2"), rough=0.6))
        out.append(o)
    return out


def color_field(name, w, h, colors, seed=0):
    """Procedural abstract canvas (soft colour fields with brushy noise) for the side walls."""
    rnd = random.Random(seed)
    m, nt, out = cl._nt(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.7
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.5 + rnd.random() * 2
    nz.inputs["Detail"].default_value = 8
    nz.inputs["Distortion"].default_value = 0.6
    nt.links.new(tc.outputs["Generated"], nz.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "MULTIPLY_ADD"
    add.inputs[1].default_value = 0.35
    nt.links.new(nz.outputs["Fac"], add.inputs[0])
    nt.links.new(sep.outputs["Z"], add.inputs[2])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position = 0.25
    els[0].color = (*colors[0], 1)
    els[1].position = 0.95
    els[1].color = (*colors[-1], 1)
    for k, c in enumerate(colors[1:-1], start=1):
        e = els.new(0.25 + 0.7 * k / (len(colors) - 1))
        e.color = (*c, 1)
    nt.links.new(add.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    o = geo.primitive("grid", name, x=2, y=2, size=0.5)
    o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Diagonal((w, h, 1, 1)))
    mat.assign(o, m)
    return o
