"""Materials and studio lighting for the homepage diorama island."""

import math

import bpy
from mathutils import Vector

from ddd import mat, scene


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _link(m, a, b):
    m.node_tree.links.new(a, b)


SKY = {
    "day": [
        (0.0, lin("#ffb080")),
        (0.44, lin("#ff9a6a")),
        (0.50, lin("#ff6e4a")),
        (0.56, lin("#e85a78")),
        (0.68, lin("#8a5aaa")),
        (0.84, lin("#4a5aaa")),
        (1.0, lin("#2a3a78")),
    ],
    "night": [
        (0.0, lin("#0a0818")),
        (0.48, lin("#16122e")),
        (0.52, lin("#3a2160")),
        (0.62, lin("#1a1840")),
        (1.0, lin("#050614")),
    ],
}


def gradient_world(variant, strength=1.0, stars=0.0, hdri=None, hdri_strength=0.35, hdri_rot=40.0):
    """Camera sees a sunset/night ramp; glossy rays can pick up an HDRI."""
    stops = SKY[variant]
    w = bpy.data.worlds.new(f"World_{variant}")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[1][0], (*stops[1][1], 1)
    for pos, col in stops[2:]:
        e = els.new(pos)
        e.color = (*col, 1)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    col = ramp.outputs["Color"]
    if stars > 0:
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = 280.0
        nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
        st = nt.nodes.new("ShaderNodeMapRange")
        st.inputs["From Min"].default_value = 0.055
        st.inputs["From Max"].default_value = 0.0
        st.inputs["To Max"].default_value = stars
        nt.links.new(vor.outputs["Distance"], st.inputs["Value"])
        up = nt.nodes.new("ShaderNodeMapRange")
        up.inputs["From Min"].default_value = 0.02
        up.inputs["From Max"].default_value = 0.28
        nt.links.new(sep.outputs["Z"], up.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(st.outputs["Result"], mul.inputs[0])
        nt.links.new(up.outputs["Result"], mul.inputs[1])
        add = nt.nodes.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        add.inputs["Factor"].default_value = 1.0
        nt.links.new(col, add.inputs["A"])
        nt.links.new(mul.outputs[0], add.inputs["B"])
        col = add.outputs["Result"]
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(col, bg.inputs["Color"])
    shader = bg.outputs[0]
    if hdri is not None and hdri.exists():
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value[2] = math.radians(hdri_rot)
        nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(str(hdri), check_existing=True)
        nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
        hb = nt.nodes.new("ShaderNodeBackground")
        hb.inputs["Strength"].default_value = hdri_strength
        nt.links.new(env.outputs["Color"], hb.inputs["Color"])
        lp = nt.nodes.new("ShaderNodeLightPath")
        mx = nt.nodes.new("ShaderNodeMath")
        mx.operation = "SUBTRACT"
        nt.links.new(lp.outputs["Is Glossy Ray"], mx.inputs[0])
        nt.links.new(lp.outputs["Is Singular Ray"], mx.inputs[1])
        cl = nt.nodes.new("ShaderNodeMath")
        cl.operation = "MAXIMUM"
        cl.inputs[1].default_value = 0.0
        nt.links.new(mx.outputs[0], cl.inputs[0])
        add = nt.nodes.new("ShaderNodeAddShader")
        nt.links.new(shader, add.inputs[0])
        nt.links.new(hb.outputs[0], add.inputs[1])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(cl.outputs[0], mix.inputs[0])
        nt.links.new(shader, mix.inputs[1])
        nt.links.new(add.outputs[0], mix.inputs[2])
        shader = mix.outputs[0]
    nt.links.new(shader, out.inputs[0])
    return w


def grass(name, variant):
    night = variant == "night"
    lo = lin("#142418") if night else lin("#1f4a20")
    hi = lin("#2a4a32") if night else lin("#5a9a38")
    m = mat.principled(name, base=hi, rough=0.78, sheen=0.55, sheen_rough=0.55, specular=0.28)
    ramp = mat.noise_color_node(m, scale=7.5, detail=8.0, roughness=0.6, colors=(lo, hi), positions=(0.32, 0.72), coord="Object")
    _link(m, ramp.outputs["Color"], mat.bsdf_of(m).inputs["Base Color"])
    nt = m.node_tree
    tc = next(n for n in nt.nodes if n.type == "TEX_COORD")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 42.0
    nz.inputs["Detail"].default_value = 6.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.18 if not night else 0.1
    bp.inputs["Distance"].default_value = 0.012
    _link(m, tc.outputs["Object"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], bp.inputs["Height"])
    _link(m, bp.outputs["Normal"], mat.bsdf_of(m).inputs["Normal"])
    return m


def clay(name, color, rough=0.7, bump=0.1):
    m = mat.principled(name, base=color, rough=rough, sheen=0.32, sheen_rough=0.5, specular=0.32)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 48.0
    nz.inputs["Detail"].default_value = 5.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.006
    _link(m, tc.outputs["Object"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], bp.inputs["Height"])
    _link(m, bp.outputs["Normal"], mat.bsdf_of(m).inputs["Normal"])
    return m


def wood(name, color, rough=0.55):
    m = mat.principled(name, base=color, rough=rough, sheen=0.15, specular=0.4)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (8.0, 1.4, 1.4)
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 6.5
    nz.inputs["Detail"].default_value = 8.0
    nz.inputs["Roughness"].default_value = 0.45
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*(c * 0.55 for c in color), 1)
    ramp.color_ramp.elements[1].color = (*color, 1)
    _link(m, tc.outputs["Object"], mp.inputs["Vector"])
    _link(m, mp.outputs["Vector"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], ramp.inputs["Fac"])
    _link(m, ramp.outputs["Color"], mat.bsdf_of(m).inputs["Base Color"])
    return m


def path_gravel(name, variant):
    lo = lin("#3a2a1c") if variant == "night" else lin("#8a6a3c")
    hi = lin("#5a4030") if variant == "night" else lin("#c4a06a")
    m = mat.principled(name, base=hi, rough=0.86, sheen=0.12)
    ramp = mat.noise_color_node(m, scale=28.0, detail=10.0, roughness=0.7, colors=(lo, hi), positions=(0.35, 0.7))
    _link(m, ramp.outputs["Color"], mat.bsdf_of(m).inputs["Base Color"])
    return m


def water(name, tint, rough=0.06, ripple=0.035):
    # Opaque glossy pool so Cycles stills never punch through to a checker.
    m = mat.principled(name, base=tint, rough=rough, ior=1.333, specular=1.0, metal=0.08, coat=0.55, coat_rough=0.06)
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 9.0
    nz.inputs["Detail"].default_value = 4.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = ripple
    bp.inputs["Distance"].default_value = 0.025
    _link(m, tc.outputs["Object"], nz.inputs["Vector"])
    _link(m, nz.outputs["Fac"], bp.inputs["Height"])
    _link(m, bp.outputs["Normal"], mat.bsdf_of(m).inputs["Normal"])
    return m


def foliage(name, color, variant):
    night = variant == "night"
    m = mat.inflatable(name, color, rough=0.42 if not night else 0.5, coat=0.25)
    if night:
        b = mat.bsdf_of(m)
        b.inputs["Emission Color"].default_value = (*tuple(min(1.0, c * 1.4) for c in color), 1)
        b.inputs["Emission Strength"].default_value = 0.12
    return m


def glossy_toy(name, color, night=False, glow=None):
    m = mat.principled(name, base=color, rough=0.16, coat=0.75, coat_rough=0.08, specular=0.6, metal=0.08)
    if night and glow is not None:
        b = mat.bsdf_of(m)
        b.inputs["Emission Color"].default_value = (*glow, 1)
        b.inputs["Emission Strength"].default_value = 1.6
    return m


def lamp_glass(name, night):
    if night:
        return mat.emission(name, lin("#ffd08a"), 8.0)
    return mat.principled(name, base=lin("#fff4dc"), transmission=0.85, rough=0.12, ior=1.45)


def studio(variant, hdri=None):
    night = variant == "night"
    gradient_world(
        variant,
        strength=1.0 if not night else 0.85,
        stars=0.0 if not night else 7.5,
        hdri=hdri,
        hdri_strength=0.42 if not night else 0.08,
        hdri_rot=55.0,
    )
    if not night:
        # Warm sunset key from the SW, peach bounce, cool fill.
        scene.sun_light("sun", rot_deg=(72, 0, 52), strength=3.6, color=(1.0, 0.62, 0.38), angle_deg=3.4)
        scene.area_light("key", (7.5, -8.5, 7.2), rot_deg=(56, 0, 42), size=6.5, power=1600, color=(1.0, 0.72, 0.48))
        scene.area_light("fill", (-9.0, -3.0, 5.0), rot_deg=(70, 0, -70), size=9.0, power=480, color=(0.62, 0.72, 1.0))
        scene.area_light("bounce", (1.0, 9.0, 2.0), rot_deg=(105, 0, 180), size=10.0, power=520, color=(1.0, 0.42, 0.55))
        scene.area_light("rim", (-6.0, 8.0, 5.5), rot_deg=(40, 0, -140), size=6.0, power=700, color=(1.0, 0.55, 0.85))
    else:
        scene.sun_light("moon", rot_deg=(48, 0, -28), strength=0.42, color=(0.55, 0.66, 1.0), angle_deg=2.2)
        scene.area_light("moon_fill", (-7.0, 5.0, 10.0), rot_deg=(28, 0, -130), size=10.0, power=220, color=(0.5, 0.6, 1.0))
        scene.area_light("pink", (8.0, 2.0, 1.8), rot_deg=(88, 0, 90), size=6.0, power=380, color=(1.0, 0.42, 0.78))


def plot_lamp(name, loc, color, power):
    return scene.point_light(name, loc, power=power, radius=0.35, color=color)


def aim_right(pos, subject, shift=0.28):
    """Look target that parks `subject` right of frame centre (text column lives on the left)."""
    d = Vector(subject) - Vector(pos)
    up = Vector((0.0, 0.0, 1.0))
    right = d.cross(up)
    if right.length < 1e-6:
        return Vector(subject)
    right.normalize()
    return Vector(subject) - right * d.length * shift
