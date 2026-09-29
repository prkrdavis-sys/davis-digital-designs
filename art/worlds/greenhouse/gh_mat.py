"""Cycles materials for the conservatory. Box-mapped PBR scans (Poly Haven)
for masonry, procedural paint/glass/terracotta for the rest."""

import bpy

from ddd import mat
from ddd.cli import CACHE

TEX = CACHE / "polyhaven" / "texture"


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def _new(name):
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    return m, nt, out


def _obj_coords(nt, scale=1.0, coord="Object"):
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs[coord], mp.inputs["Vector"])
    return mp.outputs[0]


def _img(nt, path, colorspace, vec, box=True):
    t = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = colorspace
    t.image = img
    if box:
        t.projection = "BOX"
        t.projection_blend = 0.25
    nt.links.new(vec, t.inputs["Vector"])
    return t


def _noise(nt, vec, scale, detail=6.0, rough=0.6):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n


def _ramp(nt, fac, stops):
    r = nt.nodes.new("ShaderNodeValToRGB")
    els = r.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    nt.links.new(fac, r.inputs["Fac"])
    return r


def _mix_rgb(nt, fac, a, b, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    if isinstance(fac, float):
        m.inputs[0].default_value = fac
    else:
        nt.links.new(fac, m.inputs[0])
    for sock, v in ((6, a), (7, b)):
        if isinstance(v, tuple):
            m.inputs[sock].default_value = (*v, 1) if len(v) == 3 else v
        else:
            nt.links.new(v, m.inputs[sock])
    return m.outputs[2]


def pbr_scan(name, tex_id, size_m, tint=None, rough_mul=1.0, normal_strength=1.0, coord="Object", box=True, bump_dirt=0.0):
    """A Poly Haven scan, mapped by object coordinates (meters) with box projection."""
    m, nt, out = _new(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    d = TEX / tex_id
    vec = _obj_coords(nt, 1.0 / size_m, coord)
    diff = _img(nt, d / f"{tex_id}_diffuse_2k.png", "sRGB", vec, box)
    col = diff.outputs["Color"]
    if tint:
        col = _mix_rgb(nt, 1.0, col, tint, "MULTIPLY")
    if bump_dirt > 0:
        n = _noise(nt, _obj_coords(nt, 1.0, coord), 1.4, 5)
        dirt = _ramp(nt, n.outputs["Fac"], [(0.45, (1, 1, 1)), (0.75, (0.62, 0.58, 0.52))])
        col = _mix_rgb(nt, bump_dirt, col, dirt.outputs["Color"], "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    rough = _img(nt, d / f"{tex_id}_rough_2k.png", "Non-Color", vec, box)
    if rough_mul != 1.0:
        mm = nt.nodes.new("ShaderNodeMath")
        mm.operation = "MULTIPLY"
        mm.inputs[1].default_value = rough_mul
        nt.links.new(rough.outputs["Color"], mm.inputs[0])
        nt.links.new(mm.outputs[0], bsdf.inputs["Roughness"])
    else:
        nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    nrm = _img(nt, d / f"{tex_id}_normal_2k.png", "Non-Color", vec, box)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = normal_strength
    nt.links.new(nrm.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    return m


def floor_tiles():
    # Poly Haven's scan is 2.15 m across; flat XY projection keeps the grid square to the nave.
    return pbr_scan("floor_tiles", "patterned_terracotta_tiling", 2.15, rough_mul=0.8, box=False, bump_dirt=0.35)


def brick():
    return pbr_scan("brick", "red_brick_03", 1.0, tint=lin("#e9d2c4"), bump_dirt=0.5)


def soil():
    return pbr_scan("soil", "farm_soil", 1.6, tint=lin("#6a5040"), rough_mul=1.1)


def wood():
    return pbr_scan("wood", "weathered_planks", 2.0, tint=lin("#e6d6c0"))


def iron_paint(name="iron", color="#efe9dc"):
    """Victorian white-painted cast iron: slightly chalky, dirtier low down, faint rust bloom."""
    m, nt, out = _new(name)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    vec = _obj_coords(nt, 1.0)
    n = _noise(nt, vec, 3.0, 6)
    base = _ramp(nt, n.outputs["Fac"], [(0.3, lin(color)), (0.7, tuple(c * 0.9 for c in lin(color)))])
    rust_n = _noise(nt, _obj_coords(nt, 6.0), 1.0, 8, 0.7)
    rust = _ramp(nt, rust_n.outputs["Fac"], [(0.66, (0, 0, 0)), (0.74, (1, 1, 1))])
    col = _mix_rgb(nt, rust.outputs["Color"], base.outputs["Color"], lin("#8a5a3a"))
    # Grime collects near the floor.
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(vec, sep.inputs[0])
    low = nt.nodes.new("ShaderNodeMapRange")
    low.inputs["From Min"].default_value = 0.0
    low.inputs["From Max"].default_value = 1.2
    low.inputs["To Min"].default_value = 0.55
    low.inputs["To Max"].default_value = 0.0
    nt.links.new(sep.outputs["Z"], low.inputs["Value"])
    col = _mix_rgb(nt, low.outputs["Result"], col, lin("#6d6150"), "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.38
    bsdf.inputs["Coat Weight"].default_value = 0.2
    bsdf.inputs["Coat Roughness"].default_value = 0.25
    return m


def gilt():
    return mat.principled("gilt", base=lin("#e0b46a"), metal=1.0, rough=0.28)


def stone():
    m, nt, out = _new("stone")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    vec = _obj_coords(nt, 1.0)
    n = _noise(nt, vec, 9.0, 8, 0.65)
    r = _ramp(nt, n.outputs["Fac"], [(0.25, lin("#b9ad98")), (0.55, lin("#d8ceba")), (0.8, lin("#a39680"))])
    moss = _noise(nt, _obj_coords(nt, 2.5), 1.0, 6)
    mm = _ramp(nt, moss.outputs["Fac"], [(0.62, (0, 0, 0)), (0.72, (1, 1, 1))])
    col = _mix_rgb(nt, mm.outputs["Color"], r.outputs["Color"], lin("#5f6b3a"))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    return m


def terracotta():
    """Unglazed clay: warm orange, lighter salt bloom near the rim and base, a little moss."""
    m, nt, out = _new("terracotta")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    n = _noise(nt, _obj_coords(nt, 14.0), 1.0, 8, 0.7)
    base = _ramp(nt, n.outputs["Fac"], [(0.3, lin("#b0613f")), (0.5, lin("#c4744c")), (0.75, lin("#9c5236"))])
    bloom_n = _noise(nt, _obj_coords(nt, 5.0), 1.0, 6)
    bloom = _ramp(nt, bloom_n.outputs["Fac"], [(0.55, (0, 0, 0)), (0.7, (1, 1, 1))])
    col = _mix_rgb(nt, bloom.outputs["Color"], base.outputs["Color"], lin("#d9c2a8"))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    return m


def moss():
    m, nt, out = _new("moss")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    n = _noise(nt, _obj_coords(nt, 30.0), 1.0, 8, 0.7)
    r = _ramp(nt, n.outputs["Fac"], [(0.3, lin("#3d4d1f")), (0.7, lin("#7a8a3a"))])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Sheen Weight"].default_value = 0.6
    return m


def glass():
    """Old greenhouse glass as a thin sheet: fresnel reflection over a transparent pass.
    Per-pane tint comes from the 'Col' vertex attribute; grime and condensation are procedural."""
    m, nt, out = _new("glass")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Col"
    vec = _obj_coords(nt, 1.0)
    grime_n = _noise(nt, _obj_coords(nt, 2.2), 1.0, 8, 0.65)
    grime = _ramp(nt, grime_n.outputs["Fac"], [(0.35, (0, 0, 0)), (0.8, (1, 1, 1))])
    # Condensation droplets: voronoi dots mostly on the lower part of each pane.
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "F1"
    vor.inputs["Scale"].default_value = 110.0
    nt.links.new(vec, vor.inputs["Vector"])
    drop = _ramp(nt, vor.outputs["Distance"], [(0.0, (1, 1, 1)), (0.22, (0, 0, 0))])
    wav = _noise(nt, _obj_coords(nt, 0.9), 1.0, 3, 0.5)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.06
    nt.links.new(wav.outputs["Fac"], bump.inputs["Height"])
    bump2 = nt.nodes.new("ShaderNodeBump")
    bump2.inputs["Strength"].default_value = 0.35
    bump2.inputs["Distance"].default_value = 0.002
    nt.links.new(drop.outputs["Color"], bump2.inputs["Height"])
    nt.links.new(bump.outputs[0], bump2.inputs["Normal"])

    transp = nt.nodes.new("ShaderNodeBsdfTransparent")
    tint = _mix_rgb(nt, 1.0, lin("#e9f5ec"), attr.outputs["Color"], "MULTIPLY")
    nt.links.new(tint, transp.inputs["Color"])
    gloss = nt.nodes.new("ShaderNodeBsdfGlossy")
    gloss.inputs["Roughness"].default_value = 0.04
    nt.links.new(bump2.outputs[0], gloss.inputs["Normal"])
    fres = nt.nodes.new("ShaderNodeFresnel")
    fres.inputs["IOR"].default_value = 1.52
    nt.links.new(bump2.outputs[0], fres.inputs["Normal"])
    fk = nt.nodes.new("ShaderNodeMath")
    fk.operation = "MULTIPLY"
    fk.inputs[1].default_value = 0.6
    nt.links.new(fres.outputs[0], fk.inputs[0])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fk.outputs[0], mix.inputs[0])
    nt.links.new(transp.outputs[0], mix.inputs[1])
    nt.links.new(gloss.outputs[0], mix.inputs[2])
    # Grime: a milky diffuse film that catches the sun and softens what's behind.
    film = nt.nodes.new("ShaderNodeBsdfDiffuse")
    film.inputs["Color"].default_value = (*lin("#d9d4c2"), 1)
    gm = nt.nodes.new("ShaderNodeMath")
    gm.operation = "MULTIPLY"
    gm.inputs[1].default_value = 0.12
    nt.links.new(grime.outputs["Color"], gm.inputs[0])
    mix2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(gm.outputs[0], mix2.inputs[0])
    nt.links.new(mix.outputs[0], mix2.inputs[1])
    nt.links.new(film.outputs[0], mix2.inputs[2])
    nt.links.new(mix2.outputs[0], out.inputs["Surface"])
    return m


def leaf(name, color_attr=True, base="#4f7a2e", translucency=0.35, rough=0.45):
    """Thin leaf: principled front with a translucent back-lit component."""
    m, nt, out = _new(name)
    col = None
    if color_attr:
        a = nt.nodes.new("ShaderNodeAttribute")
        a.attribute_name = "Col"
        col = a.outputs["Color"]
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    if col is not None:
        nt.links.new(col, bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*lin(base), 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Sheen Weight"].default_value = 0.2
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    if col is not None:
        warm = _mix_rgb(nt, 1.0, col, lin("#d8f07a"), "MULTIPLY")
        nt.links.new(warm, tr.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = translucency
    nt.links.new(bsdf.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def bark():
    m, nt, out = _new("palm_trunk")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    n = _noise(nt, _obj_coords(nt, 20.0), 1.0, 8, 0.7)
    r = _ramp(nt, n.outputs["Fac"], [(0.3, lin("#5b4a36")), (0.7, lin("#8f7a5c"))])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.4
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], bsdf.inputs["Normal"])
    return m


def metal(name, color, rough=0.3):
    return mat.principled(name, base=lin(color), metal=1.0, rough=rough)


def bulb(variant):
    if variant == "night":
        return mat.principled("bulb", base=(0, 0, 0), emission=lin("#ffc27a"), emission_strength=40.0, rough=0.2)
    return mat.principled("bulb", base=lin("#f5efe0"), transmission=0.6, rough=0.1, coat=0.5)


def flame():
    return mat.principled("flame", base=(0, 0, 0), emission=lin("#ffb35c"), emission_strength=30.0)


def emission_image(name, path, strength=1.0):
    m, nt, out = _new(name)
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(str(path), check_existing=True)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(t.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def frosted(name="frost", tint="#ffffff"):
    return mat.principled(name, base=lin(tint), transmission=1.0, rough=0.35, ior=1.45)


def emission(name, color, strength):
    return mat.principled(name, base=(0, 0, 0), emission=lin(color), emission_strength=strength)

