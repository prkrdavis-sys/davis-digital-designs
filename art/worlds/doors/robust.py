"""GPU memory is shared with other Blender jobs on this machine: retry a failed
Cycles render/bake on the GPU after a pause, then fall back to the CPU."""

import time

import bpy

from ddd import bake, render
from ddd.cli import log

_still = render.still
_bake_op = bpy.ops.object.bake


def _retry(fn, what):
    sc = bpy.context.scene
    sc.cycles.texture_limit_render = "2048"
    sc.cycles.device = "GPU"
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


def install():
    """Patch ddd.render.still (also used by layers/panorama) and the bake operator used by ddd.bake."""
    render.still = still

    class _Ops:
        object = _BakeOps()

        def __getattr__(self, name):
            return getattr(bpy.ops, name)

    class _Bpy:
        ops = _Ops()

        def __getattr__(self, name):
            return getattr(bpy, name)

    bake.bpy = _Bpy()
