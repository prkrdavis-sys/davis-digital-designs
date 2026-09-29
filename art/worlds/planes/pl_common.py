"""Shared constants and small helpers for the paper planes world.

The sky palette, sun/moon placement, flock anchor and tower layout live in
src/worlds/scenes/planes/world.json so the Cycles renders and the runtime
shaders read exactly the same numbers.
"""

import json
import math
import pathlib

import bpy
from mathutils import Vector

REPO = pathlib.Path(__file__).resolve().parents[3]
WORLD = json.loads((REPO / "src" / "worlds" / "scenes" / "planes" / "world.json").read_text())


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def b(v):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


def t(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return (v[0], v[2], -v[1])


def light_dir_three(variant):
    """Unit vector toward the sun (day) or moon (night), three.js coordinates."""
    L = WORLD["sky"][variant]["light"]
    az, el = math.radians(L["az"]), math.radians(L["el"])
    return (math.sin(az) * math.cos(el), math.sin(el), -math.cos(az) * math.cos(el))


def light_dir(variant):
    return b(light_dir_three(variant)).normalized()


def sky_world(variant, strength=1.0, disc=True, name="sky"):
    """World shader: elevation ramp + halos around the light + a disc.

    Same math as skyColor() in src/worlds/scenes/planes/shaders.ts.
    """
    sky = WORLD["sky"][variant]
    w = bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    norm = nt.nodes.new("ShaderNodeVectorMath")
    norm.operation = "NORMALIZE"
    nt.links.new(tc.outputs["Generated"], norm.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(norm.outputs[0], sep.inputs[0])

    # Elevation ramp: stops are given in sin(elevation); remap [-0.35, 1] -> [0, 1].
    lo, hi = sky["ramp"][0][0], sky["ramp"][-1][0]
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = lo
    mr.inputs["From Max"].default_value = hi
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    els = ramp.color_ramp.elements
    stops = sky["ramp"]
    els[0].position = 0.0
    els[0].color = (*lin(stops[0][1]), 1)
    els[1].position = 1.0
    els[1].color = (*lin(stops[-1][1]), 1)
    for e, col in stops[1:-1]:
        el = els.new((e - lo) / (hi - lo))
        el.color = (*lin(col), 1)
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])

    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(norm.outputs[0], dot.inputs[0])
    dot.inputs[1].default_value = tuple(light_dir(variant))
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MAXIMUM"
    mx.inputs[1].default_value = 0.0
    nt.links.new(dot.outputs["Value"], mx.inputs[0])

    acc = ramp.outputs["Color"]
    for col, power, k in sky["halo"] + ([[sky["light"]["disc"], -1, 0]] if disc else []):
        if power < 0:
            # Disc: smoothstep over the angular radius.
            r = math.radians(sky["light"]["discSize"])
            f = nt.nodes.new("ShaderNodeMapRange")
            f.interpolation_type = "SMOOTHSTEP"
            f.inputs["From Min"].default_value = math.cos(r)
            f.inputs["From Max"].default_value = math.cos(r * 0.7)
            nt.links.new(mx.outputs[0], f.inputs["Value"])
            fac = f.outputs["Result"]
            k = 60.0
        else:
            pw = nt.nodes.new("ShaderNodeMath")
            pw.operation = "POWER"
            pw.inputs[1].default_value = power
            nt.links.new(mx.outputs[0], pw.inputs[0])
            fac = pw.outputs[0]
        m = nt.nodes.new("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = "ADD"
        m.clamp_result = False
        m.inputs["B"].default_value = (*(c * k for c in lin(col)), 1)
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MINIMUM"
        mul.inputs[1].default_value = 1.0
        nt.links.new(fac, mul.inputs[0])
        nt.links.new(mul.outputs[0], m.inputs["Factor"])
        nt.links.new(acc, m.inputs["A"])
        acc = m.outputs["Result"]

    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(acc, bg.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return w


def key_light(variant, name="key"):
    """Sun (day) or moon (night) lamp shining along -light_dir."""
    L = WORLD["sky"][variant]["light"]
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = L["strength"]
    ld.color = lin(L["color"])
    ld.angle = math.radians(1.2 if variant == "day" else 0.8)
    o = bpy.data.objects.new(name, ld)
    travel = -light_dir(variant)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = travel.to_track_quat("-Z", "Y")
    bpy.context.scene.collection.objects.link(o)
    return o


def render_safe(fn, *a, **kw):
    """Run a render; if the shared GPU is out of memory, retry once more on GPU, then on the CPU."""
    sc = bpy.context.scene
    for attempt in range(3):
        try:
            return fn(*a, **kw)
        except RuntimeError as e:
            print("[ddd] render failed:", str(e).splitlines()[0][:120], flush=True)
            if attempt == 1:
                sc.cycles.device = "CPU"
                print("[ddd] falling back to CPU", flush=True)
    raise RuntimeError("render failed three times")


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)
