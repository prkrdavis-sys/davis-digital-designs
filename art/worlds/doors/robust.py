"""GPU memory is shared with other Blender jobs on this machine: retry a failed
Cycles render/bake on the GPU after a pause, then fall back to the CPU.

Also replaces ddd.bake.unwrap_atlas: the UV layer it returns dangles once the
mesh leaves edit mode (reading `.name` afterwards crashes on Linux builds), so
this version hands back only the layer's name."""

import math
import time
import types

import bpy

from ddd import bake, render
from ddd.cli import log

_still = render.still
_bake_op = bpy.ops.object.bake


def unwrap_atlas(obj, angle_deg=60, margin=0.003):
    bake._select_only([obj], obj)
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
    return types.SimpleNamespace(name="bake")


def _retry(fn, what):
    sc = bpy.context.scene
    sc.cycles.texture_limit_render = "2048"
    if sc.cycles.device != "GPU":
        return fn()
    for attempt in range(3):
        try:
            return fn()
        except RuntimeError as e:
            msg = str(e).splitlines()[0][:120]
            if attempt == 0:
                log(what, "GPU failed, retrying in 20s:", msg)
                time.sleep(20)
            elif attempt == 1:
                log(what, "GPU failed again, falling back to CPU:", msg)
                sc.cycles.device = "CPU"
            else:
                raise
    return None


def still(path, samples=None):
    return _retry(lambda: _still(path, samples), f"render {path.name if hasattr(path, 'name') else path}")


class _BakeOps:
    """Stand-in for bpy.ops.object inside ddd.bake: only `bake` is wrapped."""

    def __getattr__(self, name):
        if name == "bake":
            return lambda **kw: _retry(lambda: _bake_op(**kw), "bake")
        return getattr(bpy.ops.object, name)


def denoise_pixels(px, radius=2, sigma_s=1.4, sigma_r=0.3, passes=2):
    """Edge-preserving smoothing of a baked RGBA float lightmap (H, W, 4).

    Cross-bilateral on log2 luminance: texels only average with neighbours of similar
    brightness, so shadow edges and UV-island borders (black background) stay put while
    Monte Carlo grain melts. Fireflies are clamped to their neighbourhood first."""
    import numpy as np

    rgb = px[..., :3].astype(np.float32)
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    valid = lum > 1e-5
    # Firefly clamp: cap each texel at 3x the mean of its valid 3x3 neighbours.
    acc = np.zeros_like(lum)
    cnt = np.zeros_like(lum)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            acc += np.roll(lum, (dy, dx), (0, 1))
            cnt += np.roll(valid, (dy, dx), (0, 1))
    cap = 3.0 * acc / np.maximum(cnt, 1) + 1e-4
    scale = np.where(valid & (lum > cap), cap / np.maximum(lum, 1e-8), 1.0)
    rgb *= scale[..., None]
    for _ in range(passes):
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        logl = np.log2(np.maximum(lum, 1e-5))
        num = np.zeros_like(rgb)
        den = np.zeros_like(lum)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                ws = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s * sigma_s))
                nl = np.roll(logl, (dy, dx), (0, 1))
                nv = np.roll(valid, (dy, dx), (0, 1))
                w = ws * np.exp(-((nl - logl) ** 2) / (2 * sigma_r * sigma_r)) * nv
                num += np.roll(rgb, (dy, dx), (0, 1)) * w[..., None]
                den += w
        rgb = np.where(valid[..., None], num / np.maximum(den, 1e-8)[..., None], rgb)
    out = px.copy()
    out[..., :3] = rgb
    return out


_save_srgb = bake.save_srgb


def save_srgb_denoised(img, path, exposure=0.0):
    import numpy as np

    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    t0 = time.time()
    px = denoise_pixels(px.reshape(h, w, 4))
    img.pixels.foreach_set(px.ravel())
    img.update()
    log("denoised", img.name, f"{time.time() - t0:.1f}s")
    return _save_srgb(img, path, exposure=exposure)


def install():
    """Patch ddd.render.still (also used by layers/panorama), the bake operator, UV unwrap and lightmap saving used by ddd.bake."""
    render.still = still
    bake.unwrap_atlas = unwrap_atlas
    bake.save_srgb = save_srgb_denoised

    class _Ops:
        object = _BakeOps()

        def __getattr__(self, name):
            return getattr(bpy.ops, name)

    class _Bpy:
        ops = _Ops()

        def __getattr__(self, name):
            return getattr(bpy, name)

    bake.bpy = _Bpy()
