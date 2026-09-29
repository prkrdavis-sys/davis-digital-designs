"""Cycles light baking.

bake_group() joins a set of static objects into one mesh, unwraps a single
atlas, bakes diffuse lighting (direct + indirect + albedo + emission, no
glossy) and rewires the result as an emissive texture on a black base. In
three.js that renders as full GI for the diffuse part while live environment
reflections still land on top via roughness/metalness.
"""

import math
import pathlib

import bpy

from . import geo, mat
from .cli import log

EMISSIVE_HEADROOM = 2.0  # bake is saved at 1/2 exposure; runtime emissive strength multiplies back


def _select_only(objs, active):
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def unwrap_atlas(obj, angle_deg=60, margin=0.003):
    _select_only([obj], obj)
    me = obj.data
    uv = me.uv_layers.get("bake") or me.uv_layers.new(name="bake")
    me.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    return uv


def _roughness_of(m):
    try:
        return mat.bsdf_of(m).inputs["Roughness"].default_value
    except StopIteration:
        return 0.8


def bake_group(objs, name, out_dir, size=2048, samples=384, margin=12, keep_uv_only=True, exposure=-1.0, roughness=None, metal=0.0):
    """Returns the joined object carrying the baked material."""
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    joined = geo.join(objs, name) if len(objs) > 1 else objs[0]
    joined.name = name
    uv = unwrap_atlas(joined)
    rough = roughness if roughness is not None else sum(_roughness_of(m) for m in joined.data.materials if m) / max(1, len(joined.data.materials))

    img = bpy.data.images.new(f"{name}_bake", size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709" if "Linear Rec.709" in [c.name for c in bpy.types.ColorManagedInputColorspaceSettings.bl_rna.properties["name"].enum_items] else "Linear"
    for m in joined.data.materials:
        if not m:
            continue
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = uv.name
        nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        tex.select = True
        nt.nodes.active = tex

    prev_samples = sc.cycles.samples
    sc.cycles.samples = samples
    sc.render.bake.margin = margin
    sc.render.bake.use_clear = True
    _select_only([joined], joined)
    log("baking", name, f"{size}px", f"{samples}spp")
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"}, margin=margin, use_clear=True)
    sc.cycles.samples = prev_samples

    path = out_dir / f"{name}.png"
    save_srgb(img, path, exposure=exposure)

    baked = mat.principled(f"{name}_baked", base=(0, 0, 0), rough=rough, metal=metal, specular=0.5)
    b = mat.bsdf_of(baked)
    t = mat.image_node(baked, path, "sRGB", uv_map=uv.name)
    baked.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = EMISSIVE_HEADROOM * (2.0 ** (-exposure - 1.0))
    joined.data.materials.clear()
    joined.data.materials.append(baked)
    if keep_uv_only:
        for layer in list(joined.data.uv_layers):
            if layer.name != uv.name:
                joined.data.uv_layers.remove(layer)
    return joined


def save_srgb(img, path, exposure=0.0):
    """Write a float image as 8-bit sRGB PNG through the Standard view transform."""
    sc = bpy.context.scene
    vs = sc.view_settings
    prev = (vs.view_transform, vs.look, vs.exposure, vs.gamma)
    vs.view_transform = "Standard"
    vs.look = "None"
    vs.exposure = exposure
    vs.gamma = 1.0
    fs = sc.render.image_settings
    fs.file_format = "PNG"
    fs.color_mode = "RGB"
    fs.color_depth = "8"
    img.save_render(str(path), scene=sc)
    vs.view_transform, vs.look, vs.exposure, vs.gamma = prev
    return path


def bake_normals(high, low, out_path, size=2048, extrusion=0.05, samples=1):
    """Tangent-space normal map from `high` onto `low` (low needs UVs)."""
    sc = bpy.context.scene
    img = bpy.data.images.new(f"{low.name}_nrm", size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    for m in low.data.materials:
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
    prev = sc.cycles.samples
    sc.cycles.samples = samples
    for o in bpy.context.scene.objects:
        o.select_set(False)
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_selected_to_active=True, cage_extrusion=extrusion, margin=8)
    sc.cycles.samples = prev
    img.filepath_raw = str(out_path)
    img.file_format = "PNG"
    img.save()
    return out_path
