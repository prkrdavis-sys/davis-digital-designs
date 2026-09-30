"""Denoised variants of the shared bake helpers (art/lib/ddd/bake.py).

bake_group() here matches ddd.bake.bake_group, except that it re-fetches the
atlas UV layer by name after the edit-mode unwrap (the RNA pointer returned
before the mode switch is stale), and it writes the float bake to EXR and runs
OpenImageDenoise on it before the 8-bit sRGB PNG is saved.
"""

import pathlib
import subprocess

import bpy

from ddd import bake, geo, mat
from ddd.cli import log

HERE = pathlib.Path(__file__).resolve().parent


def denoise(img, png, exposure):
    """Float image -> EXR -> OpenImageDenoise -> 8-bit sRGB PNG at `exposure` EV."""
    png = pathlib.Path(png)
    exr = png.with_suffix(".exr")
    img.filepath_raw = str(exr)
    img.file_format = "OPEN_EXR"
    img.save()
    cmd = [bpy.app.binary_path, "-b", "--factory-startup", "-noaudio", "--python", str(HERE / "denoise.py"), "--", str(exr), str(png), str(exposure)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    log("denoised", png.name)
    return png


def bake_group(objs, name, out_dir, size=2048, samples=128, margin=12, exposure=-2.0, roughness=None, metal=0.0):
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    joined = geo.join(objs, name) if len(objs) > 1 else objs[0]
    joined.name = name
    bake.unwrap_atlas(joined)
    uv_name = "bake"
    rough = roughness if roughness is not None else sum(bake._roughness_of(m) for m in joined.data.materials if m) / max(1, len(joined.data.materials))

    img = bpy.data.images.new(f"{name}_bake", size, size, alpha=False, float_buffer=True)
    for m in joined.data.materials:
        if not m:
            continue
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = uv_name
        nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        tex.select = True
        nt.nodes.active = tex

    prev_samples = sc.cycles.samples
    sc.cycles.samples = samples
    sc.render.bake.margin = margin
    sc.render.bake.use_clear = True
    bake._select_only([joined], joined)
    log("baking", name, f"{size}px", f"{samples}spp")
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"}, margin=margin, use_clear=True)
    sc.cycles.samples = prev_samples

    path = denoise(img, out_dir / f"{name}.png", exposure)

    baked = mat.principled(f"{name}_baked", base=(0, 0, 0), rough=rough, metal=metal, specular=0.5)
    b = mat.bsdf_of(baked)
    t = mat.image_node(baked, path, "sRGB", uv_map=uv_name)
    baked.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 2.0 ** (-exposure)
    joined.data.materials.clear()
    joined.data.materials.append(baked)
    for layer in list(joined.data.uv_layers):
        if layer.name != uv_name:
            joined.data.uv_layers.remove(layer)
    return joined
