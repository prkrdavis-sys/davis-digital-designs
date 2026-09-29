"""Relightable cloud impostors.

Each cloud is rendered orthographically three times: lit by a key light from
the left-behind, from the right-behind, and by a soft sky dome only. The
three grayscale results go into R, G, B and coverage into A. At runtime the
sprite shader mixes R/G by where the sun sits on screen and tints everything
with the day or night palette, so one atlas serves both variants.
"""

import json
import math

import bpy
import numpy as np
from mathutils import Vector

import pl_clouds as cl
from ddd import cli, scene
from pl_common import render_safe

ATLAS = (2048, 2048)
# (kind, seed, px rect x, y, w, h) with y measured from the top of the atlas.
CELLS = [("puff", 1, 0, 0, 512, 384), ("puff", 2, 512, 0, 512, 384), ("puff", 3, 1024, 0, 512, 384), ("puff", 4, 1536, 0, 512, 384),
         ("puff", 5, 0, 384, 512, 384), ("puff", 6, 512, 384, 512, 384), ("puff", 7, 1024, 384, 512, 384), ("puff", 8, 1536, 384, 512, 384),
         ("tower", 21, 0, 768, 512, 1280), ("tower", 22, 512, 768, 512, 1280), ("tower", 23, 1024, 768, 512, 1280), ("tower", 24, 1536, 768, 512, 1280)]


def _spheres(kind, seed):
    if kind == "puff":
        return cl.puff_spheres(seed, size=30.0), 0.35, 0.12
    return cl.tower_spheres(seed, height=120.0, width=70.0, base=(0.0, 0.0, 0.0), lean=0.1), 1.1, 0.06


def _ambient_world():
    """Sky dome for the ambient pass: bright above, dim below (sea bounce)."""
    w = bpy.data.worlds.new("amb")
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    mr.inputs["To Min"].default_value = 0.35
    mr.inputs["To Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    bg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(mr.outputs["Result"], bg.inputs["Strength"])
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return w


def _black_world():
    return scene.world_color((0, 0, 0), 0.0)


def _sun(name, d, strength):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = strength
    ld.angle = math.radians(2.0)
    o = bpy.data.objects.new(name, ld)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (-Vector(d)).normalized().to_track_quat("-Z", "Y")
    bpy.context.scene.collection.objects.link(o)
    return o


def _render_exr(path, reuse=True):
    sc = bpy.context.scene
    if not (reuse and path.exists()):
        fs = sc.render.image_settings
        fs.file_format = "OPEN_EXR"
        fs.color_mode = "RGBA"
        fs.color_depth = "32"
        sc.render.filepath = str(path)
        render_safe(bpy.ops.render.render, write_still=True)
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    # Blender pixel rows run bottom -> top.
    return px.reshape(h, w, 4)[::-1]


def build(out_dir, pub_dir, samples=48):
    scene.reset()
    sc = scene.cycles(samples=samples, bounces=8, transparent=True, res=(512, 384))
    cl.volume_settings(sc, 8)
    scene.view("Standard")
    cam = scene.camera()
    cam.data.type = "ORTHO"
    cam.rotation_euler = (math.radians(90), 0, 0)  # looks along +Y
    suns = {"L": _sun("L", (-0.82, 0.42, 0.38), 3.0), "R": _sun("R", (0.82, 0.42, 0.38), 3.0)}
    worlds = {"amb": _ambient_world(), "black": _black_world()}

    clouds = []
    for k, (kind, seed, x, y, w, h) in enumerate(CELLS):
        sp, dens, scale = _spheres(kind, seed)
        m = cl.cloud_material(f"{kind}{k}", density=dens, erosion=0.9, gain=1.8, scale=scale, billow=0.45, anisotropy=0.35)
        vox = 0.3 if kind == "puff" else 1.0
        o = cl.sphere_cloud(f"c{k}", sp, m, voxel=vox, blur_iters=1, dilate=1)
        o.location.x = k * 400.0
        lo = sp[:, :3] - sp[:, 3:4]
        hi = sp[:, :3] + sp[:, 3:4]
        clouds.append((o, lo.min(0), hi.max(0)))

    atlas = np.zeros((ATLAS[1], ATLAS[0], 4), dtype=np.float32)
    meta = []
    for k, ((kind, seed, x, y, w, h), (o, lo, hi)) in enumerate(zip(CELLS, clouds)):
        for j, (other, _, _) in enumerate(clouds):
            other.hide_render = j != k
        # Frame the cloud: width fits the cell, bottom sits at the cell's bottom edge.
        width = (hi[0] - lo[0]) * 1.08
        height = width * h / w
        need_h = (hi[2] - lo[2]) * 1.06
        if need_h > height:
            height = need_h
            width = height * w / h
        cam.data.ortho_scale = max(width, height)
        cx = o.location.x + (lo[0] + hi[0]) / 2
        bottom = lo[2] - (hi[2] - lo[2]) * 0.02
        cz = bottom + height / 2
        cam.location = (cx, -600.0, cz)
        sc.render.resolution_x, sc.render.resolution_y = w, h
        passes = {}
        for name in ("L", "R", "amb"):
            suns["L"].hide_render = name != "L"
            suns["R"].hide_render = name != "R"
            sc.world = worlds["amb" if name == "amb" else "black"]
            passes[name] = _render_exr(out_dir / f"atlas-{k}-{name}.exr")
            cli.log("atlas", k, kind, name, "max", round(float(passes[name][..., :3].max()), 2))
        a = np.clip(passes["amb"][..., 3], 0, 1)
        cell = np.zeros((h, w, 4), dtype=np.float32)
        safe = np.maximum(a, 1e-4)
        cell[..., 0] = passes["L"][..., 0] / safe
        cell[..., 1] = passes["R"][..., 0] / safe
        cell[..., 2] = passes["amb"][..., 0] / safe
        cell[..., 3] = a
        cell[..., :3] *= (a > 0.004)[..., None]
        atlas[y : y + h, x : x + w] = cell
        meta.append({"kind": kind, "uv": [x / ATLAS[0], y / ATLAS[1], w / ATLAS[0], h / ATLAS[1]], "size": [round(width, 2), round(height, 2)]})

    # Straight (unpremultiplied) values, encoded as sqrt(v / vmax) for precision in the darks.
    lit = atlas[..., :3][atlas[..., 3] > 0.05]
    vmax = float(np.percentile(lit, 99.7)) if lit.size else 1.0
    enc = atlas.copy()
    enc[..., :3] = np.sqrt(np.clip(atlas[..., :3] / vmax, 0, 1))
    img = bpy.data.images.new("clouds_atlas", ATLAS[0], ATLAS[1], alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(enc[::-1].ravel())
    img.filepath_raw = str(out_dir / "clouds.png")
    img.file_format = "PNG"
    img.save()
    (pub_dir / "hi" / "clouds.json").write_text(json.dumps({"vmax": round(vmax, 4), "encoding": "sqrt", "cells": meta}, indent=1))
    cli.log("atlas written", out_dir / "clouds.png", "vmax", round(vmax, 3))
