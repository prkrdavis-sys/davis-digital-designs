"""Camera rails.

A rail is keyed in scene-local chapter time `s` (0 = start of the scene's
first chapter, 1 = start of its second, ...). One Blender frame = 0.01 s.
The exported JSON is sampled every frame in three.js coordinates so the
runtime camera, the Cycles posters and the Low-mode layers share one path.
"""

import json
import math
import pathlib

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FRAMES_PER_UNIT = 100

# Blender Z-up -> three.js Y-up: rotate -90 degrees about X.
_Z2Y = Matrix.Rotation(-math.pi / 2, 4, "X")


def frame_of(s):
    return s * FRAMES_PER_UNIT


def look_rotation(pos, target, roll_deg=0.0):
    d = Vector(target) - Vector(pos)
    q = d.to_track_quat("-Z", "Y")
    if roll_deg:
        q = q @ Quaternion((0, 0, 1), math.radians(roll_deg))
    return q


def fov_to_lens(fov_deg, sensor=24.0):
    return (sensor / 2) / math.tan(math.radians(fov_deg) / 2)


def key(cam, keys, interpolation="BEZIER", ease="AUTO_CLAMPED"):
    """keys: list of dict(s, pos, look, roll=0, fov=40). Smooth Bezier between keys."""
    cam.rotation_mode = "XYZ"
    prev = None
    for k in keys:
        f = frame_of(k["s"])
        cam.location = k["pos"]
        e = look_rotation(k["pos"], k["look"], k.get("roll", 0.0)).to_euler("XYZ", prev) if prev else look_rotation(k["pos"], k["look"], k.get("roll", 0.0)).to_euler("XYZ")
        cam.rotation_euler = e
        prev = e.copy()
        cam.data.lens = fov_to_lens(k.get("fov", 40.0), cam.data.sensor_height)
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
        cam.data.keyframe_insert("lens", frame=f)
    for owner in (cam, cam.data):
        ad = owner.animation_data
        if not ad or not ad.action:
            continue
        for fc in _fcurves(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = interpolation
                kp.handle_left_type = ease
                kp.handle_right_type = ease
            fc.update()


def _fcurves(action):
    if hasattr(action, "fcurves") and len(getattr(action, "fcurves", [])):
        return list(action.fcurves)
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    return out


def set_at(s):
    f = frame_of(s)
    bpy.context.scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))


def export(cam, path, s_max, step=0.01):
    path = pathlib.Path(path)
    p, q, fov = [], [], []
    n = int(round(s_max / step)) + 1
    for i in range(n):
        set_at(i * step)
        m = _Z2Y @ cam.matrix_world
        loc, rot, _ = m.decompose()
        p += [round(loc.x, 4), round(loc.y, 4), round(loc.z, 4)]
        q += [round(rot.x, 5), round(rot.y, 5), round(rot.z, 5), round(rot.w, 5)]
        fov.append(round(math.degrees(cam.data.angle_y), 3))
    data = {"step": step, "sMax": s_max, "count": n, "p": p, "q": q, "fov": fov}
    path.write_text(json.dumps(data, separators=(",", ":")))
    return path


def to_three(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return (v[0], v[2], -v[1])
