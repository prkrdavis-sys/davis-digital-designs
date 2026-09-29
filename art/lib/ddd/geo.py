"""Geometry helpers built on bmesh and modifiers (no edit-mode operators)."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def obj_from_bmesh(name, bm, coll=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def obj_from_mesh(name, verts, faces, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    return o


def primitive(kind, name, coll=None, **kw):
    bm = bmesh.new()
    if kind == "cube":
        bmesh.ops.create_cube(bm, size=kw.get("size", 1.0))
    elif kind == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get("u", 64), v_segments=kw.get("v", 32), radius=kw.get("radius", 1.0))
    elif kind == "ico":
        bmesh.ops.create_icosphere(bm, subdivisions=kw.get("subdiv", 4), radius=kw.get("radius", 1.0))
    elif kind == "cylinder":
        bmesh.ops.create_cone(bm, cap_ends=kw.get("caps", True), segments=kw.get("segments", 64), radius1=kw.get("radius", 1.0), radius2=kw.get("radius2", kw.get("radius", 1.0)), depth=kw.get("depth", 2.0))
    elif kind == "grid":
        bmesh.ops.create_grid(bm, x_segments=kw.get("x", 10), y_segments=kw.get("y", 10), size=kw.get("size", 1.0))
    elif kind == "torus":
        _torus(bm, kw.get("major", 1.0), kw.get("minor", 0.25), kw.get("u", 96), kw.get("v", 32))
    else:
        raise ValueError(kind)
    return obj_from_bmesh(name, bm, coll)


def _torus(bm, R, r, U, V):
    verts = []
    for i in range(U):
        a = 2 * math.pi * i / U
        for j in range(V):
            b = 2 * math.pi * j / V
            verts.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
    for i in range(U):
        for j in range(V):
            a = verts[i * V + j]
            b = verts[((i + 1) % U) * V + j]
            c = verts[((i + 1) % U) * V + (j + 1) % V]
            d = verts[i * V + (j + 1) % V]
            bm.faces.new((a, b, c, d))


def tube(name, points, radius=0.05, segments=16, coll=None, radii=None, closed=False, caps=True):
    """Sweep a circle along a polyline using parallel-transport frames."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    bm = bmesh.new()
    tangents = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tangents.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    normal = tangents[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i > 0:
            axis = tangents[i - 1].cross(tangents[i])
            if axis.length > 1e-8:
                ang = math.acos(max(-1.0, min(1.0, tangents[i - 1].dot(tangents[i]))))
                normal = Matrix.Rotation(ang, 3, axis.normalized()) @ normal
        binormal = tangents[i].cross(normal).normalized()
        r = radii[i] if radii else radius
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            ring.append(bm.verts.new(pts[i] + (normal * math.cos(a) + binormal * math.sin(a)) * r))
        rings.append(ring)
    count = n if closed else n - 1
    for i in range(count):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(segments):
            bm.faces.new((r0[j], r0[(j + 1) % segments], r1[(j + 1) % segments], r1[j]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bmesh(name, bm, coll)


def modifier(obj, kind, name=None, **props):
    m = obj.modifiers.new(name or kind.lower(), kind)
    for k, v in props.items():
        setattr(m, k, v)
    return m


def subsurf(obj, levels=2):
    return modifier(obj, "SUBSURF", levels=levels, render_levels=levels)


def bevel(obj, width=0.02, segments=3, angle_deg=30):
    m = modifier(obj, "BEVEL", width=width, segments=segments, limit_method="ANGLE")
    m.angle_limit = math.radians(angle_deg)
    return m


def apply_all(obj):
    """Bake the evaluated mesh (modifiers, shape keys, sims) into obj.data."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def smooth(obj, angle_deg=40):
    me = obj.data
    me.shade_smooth()
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=math.radians(angle_deg))
    return obj


def join(objs, name):
    """Join meshes without operators: concatenate evaluated meshes into one."""
    bm = bmesh.new()
    mats = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        offset = len(mats)
        for m in o.data.materials:
            mats.append(m)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.transform(o.matrix_world)
        for f in tmp.faces:
            f.material_index += offset
        me_tmp = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me_tmp)
        tmp.free()
        bm.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
        ev.to_mesh_clear()
    coll = objs[0].users_collection[0] if objs[0].users_collection else None
    out = obj_from_bmesh(name, bm, coll)
    for m in mats:
        out.data.materials.append(m)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def set_origin_world(obj):
    """Apply object transform into the mesh so the object sits at the origin."""
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    return obj


def displace_noise(obj, strength=0.1, scale=1.0, detail=2, name="disp", noise="CLOUDS"):
    tex = bpy.data.textures.new(f"{obj.name}_{name}", "CLOUDS" if noise == "CLOUDS" else noise)
    if hasattr(tex, "noise_scale"):
        tex.noise_scale = scale
    if hasattr(tex, "noise_depth"):
        tex.noise_depth = detail
    m = obj.modifiers.new(name, "DISPLACE")
    m.texture = tex
    m.strength = strength
    m.texture_coords = "GLOBAL"
    return m


def decimate(obj, ratio=0.5):
    return modifier(obj, "DECIMATE", ratio=ratio)


def triangle_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)
