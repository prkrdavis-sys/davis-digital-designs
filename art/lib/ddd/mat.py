"""Material helpers. Everything is a Principled BSDF so the glTF exporter
maps it cleanly (transmission, clearcoat, sheen, iridescence, emission)."""

import bpy

_ALIASES = {
    "base": "Base Color",
    "metal": "Metallic",
    "rough": "Roughness",
    "ior": "IOR",
    "alpha": "Alpha",
    "transmission": "Transmission Weight",
    "coat": "Coat Weight",
    "coat_rough": "Coat Roughness",
    "sheen": "Sheen Weight",
    "sheen_rough": "Sheen Roughness",
    "sheen_tint": "Sheen Tint",
    "emission": "Emission Color",
    "emission_strength": "Emission Strength",
    "specular": "Specular IOR Level",
    "subsurface": "Subsurface Weight",
    "subsurface_radius": "Subsurface Radius",
    "subsurface_scale": "Subsurface Scale",
    "thin_film": "Thin Film Thickness",
    "thin_film_ior": "Thin Film IOR",
    "aniso": "Anisotropic",
}


def _nodes(m):
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    return m.node_tree


def bsdf_of(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def set_input(bsdf, key, value):
    name = _ALIASES.get(key, key)
    sock = bsdf.inputs.get(name)
    if sock is None:
        return
    if isinstance(value, (tuple, list)) and len(value) == 3 and sock.type == "RGBA":
        value = (*value, 1.0)
    sock.default_value = value


def principled(name, **props):
    """principled("chrome", base=(0.9,0.9,0.92), metal=1, rough=0.08)"""
    m = bpy.data.materials.new(name)
    nt = _nodes(m)
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) or nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    for k, v in props.items():
        set_input(bsdf, k, v)
    if props.get("alpha", 1.0) < 1.0 and hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    return m


def image_node(m, path, colorspace="sRGB", uv_map=None, scale=None):
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = colorspace
    tex.image = img
    if uv_map or scale:
        uv = nt.nodes.new("ShaderNodeUVMap")
        if uv_map:
            uv.uv_map = uv_map
        src = uv.outputs[0]
        if scale:
            mp = nt.nodes.new("ShaderNodeMapping")
            mp.inputs["Scale"].default_value = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
            nt.links.new(src, mp.inputs["Vector"])
            src = mp.outputs[0]
        nt.links.new(src, tex.inputs["Vector"])
    return tex


def pbr(name, maps, scale=1.0, **props):
    """Principled material from a dict of texture maps (from art/fetch/*)."""
    m = principled(name, **props)
    nt = m.node_tree
    bsdf = bsdf_of(m)
    if "diffuse" in maps:
        t = image_node(m, maps["diffuse"], "sRGB", scale=scale)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if "rough" in maps:
        t = image_node(m, maps["rough"], "Non-Color", scale=scale)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Roughness"])
    if "metal" in maps:
        t = image_node(m, maps["metal"], "Non-Color", scale=scale)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Metallic"])
    if "normal" in maps:
        t = image_node(m, maps["normal"], "Non-Color", scale=scale)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = props.get("normal_strength", 1.0)
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    return m


def emission(name, color=(1, 1, 1), strength=5.0):
    return principled(name, base=(0, 0, 0), emission=color, emission_strength=strength, rough=1.0, specular=0.0)


def glass(name, tint=(1, 1, 1), rough=0.0, ior=1.45, thin_film=0.0):
    return principled(name, base=tint, transmission=1.0, rough=rough, ior=ior, thin_film=thin_film)


def chrome(name, tint=(0.95, 0.95, 0.97), rough=0.05):
    return principled(name, base=tint, metal=1.0, rough=rough)


def clay(name, color, rough=0.55, sheen=0.3):
    return principled(name, base=color, rough=rough, sheen=sheen, sheen_rough=0.4)


def inflatable(name, color, rough=0.18, coat=0.6):
    """Glossy vinyl: saturated base, soft coat, a touch of subsurface."""
    return principled(name, base=color, rough=rough, coat=coat, coat_rough=0.12, subsurface=0.08, subsurface_scale=0.2, specular=0.6)


def assign(obj, m, slot=None):
    if slot is None:
        obj.data.materials.clear()
        obj.data.materials.append(m)
    else:
        while len(obj.data.materials) <= slot:
            obj.data.materials.append(m)
        obj.data.materials[slot] = m
    return obj


def noise_color_node(m, scale=4.0, detail=8.0, roughness=0.55, colors=((0.1, 0.1, 0.1), (0.9, 0.9, 0.9)), positions=(0.3, 0.7), coord="Object"):
    """Adds Noise -> ColorRamp; returns the ramp node (link its Color output where needed)."""
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = detail
    nz.inputs["Roughness"].default_value = roughness
    nt.links.new(tc.outputs[coord], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = positions[0]
    ramp.color_ramp.elements[0].color = (*colors[0], 1)
    ramp.color_ramp.elements[1].position = positions[1]
    ramp.color_ramp.elements[1].color = (*colors[1], 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    return ramp
