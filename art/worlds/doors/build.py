"""Pick a door: a sunlit colonnade with five themed portals, one per world.

Steps (run with --steps a,b,...):
  arches    themed arches + door leaves + portal planes -> arches.glb, layout.json
  bake      per variant: colonnade shell + floor lightmap (Cycles GI) -> corridor-<v>.glb
  rail      camera rail -> rails.json (rail time = scene s + OFFSET)
  preview   quick Cycles still at --s
  layers    Low Resources depth layers + posters (day/night)
  pano      360 from the middle of the colonnade
  mini      a little arch on a plinth for the homepage diorama

Blender coordinates: the colonnade runs along +Y, doors stand on the right
(+X) facing back toward the visitor. three.js = (x, z, -y).
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import arches as ar  # noqa: E402
import classic as cl  # noqa: E402
import robust  # noqa: E402
from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402

robust.install()

SCENE_ID = "doors"
OFFSET = 0.15
S_MAX = 1.30  # rail time; covers scene s in [-0.15, 1.15]


def extra_args(p):
    p.add_argument("--s", type=float, default=0.5)
    p.add_argument("--tags", default="")
    p.add_argument("--bake-size", type=int, default=2048)


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
REPO = HERE.parents[2]
lin = cl.lin

# Worlds behind the doors, in card order. Palettes mirror src/lib/worlds.ts.
DOORS = [
    {"id": "sites", "scene": "greenhouse", "day": ["#8fd08a", "#f6c47c", "#e6f2de"], "night": ["#9ae8a4", "#f3d58f", "#a9bfff"]},
    {"id": "apps", "scene": "dna", "day": ["#5cc3d2", "#e58bbd", "#f3e9dc"], "night": ["#6dffab", "#ff6fae", "#7f97ff"]},
    {"id": "play", "scene": "pinball", "day": ["#ff5c9d", "#3edcff", "#ffd84a"], "night": ["#ff4fa0", "#2fe6ff", "#ffe066"]},
    {"id": "create", "scene": "snowglobe", "day": ["#a9dcff", "#eef4ff", "#cbb2ff"], "night": ["#86e8cc", "#bccbff", "#ffd392"]},
    {"id": "shop", "scene": "dunes", "day": ["#ffb85f", "#ff8a66", "#ffe4b5"], "night": ["#dccbff", "#8e98ff", "#ffdca8"]},
]
DOOR_X = 3.3
DOOR_Y0 = 2.0
DOOR_STEP = 7.5
DOOR_YAW = -36.0
DAIS_H = 0.24

HALL = {"x0": -7.0, "x1": 7.6, "wall": 9.6, "y0": -18.0, "y1": 50.0, "col_h": 7.4, "col_r": 0.42, "bay": 4.0}

PAL = {
    "day": {
        "sky": [lin("#ffc9dc"), lin("#e9c8f0"), lin("#a9b8ff"), lin("#6f93f0")],
        "stone": lin("#f3ecec"),
        "stone2": lin("#e6d6dc"),
        "wall": lin("#e7c3cf"),
        "floor_a": lin("#f5f2f5"),
        "floor_b": lin("#ddd3e6"),
        "inlay": lin("#d6b06a"),
        "sun": (1.0, 0.88, 0.76),
        "sun_strength": 5.0,
        "far": [lin("#fff6ee"), lin("#ffe2ee"), lin("#e8e6ff")],
    },
    "night": {
        "sky": [lin("#1a1f45"), lin("#10143a"), lin("#070a24"), lin("#03040f")],
        "stone": lin("#d9d6e6"),
        "stone2": lin("#c8c6dc"),
        "wall": lin("#b9b4d2"),
        "floor_a": lin("#d9d8e8"),
        "floor_b": lin("#bdbbd6"),
        "inlay": lin("#c9a86a"),
        "sun": (0.62, 0.72, 1.0),
        "sun_strength": 0.55,
        "far": [lin("#3a3f8a"), lin("#6a5fc0"), lin("#a99be8")],
    },
}


def door_frame(i):
    y = DOOR_Y0 + DOOR_STEP * i
    loc = Vector((DOOR_X, y, DAIS_H))
    R = Matrix.Rotation(math.radians(DOOR_YAW), 4, "Z")
    return Matrix.Translation(loc) @ R, loc, R


def to_three(v):
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


# --------------------------------------------------------------------------
# Colonnade shell (static, baked)
def build_shell(variant):
    pal = PAL[variant]
    stone = cl.marble(f"stone_{variant}", pal["stone"], [c * 0.8 for c in pal["stone2"]], scale=1.4, rough=0.35, vein_amount=0.35)
    wall = cl.plaster(f"wall_{variant}", pal["wall"], variation=0.05)
    parts = []
    h = HALL
    ys = np.arange(h["y0"] + 2, h["y1"] - 1, h["bay"])
    for x in (h["x0"], h["x1"]):
        for y in ys:
            c = cl.column(f"col_{x}_{y}", h["col_h"], h["col_r"], (x, float(y), 0.0), flutes=16, order="doric")
            mat.assign(c, stone)
            parts.append(c)
    L = h["y1"] - h["y0"]
    ent_z = h["col_h"]
    for x in (h["x0"], h["x1"]):
        side = -1 if x < 0 else 1
        arch_ = cl.box("architrave", (1.1, L, 0.55), (x, (h["y0"] + h["y1"]) / 2, ent_z + 0.275), bevel=0.01)
        frieze = cl.box("frieze", (0.95, L, 0.5), (x, (h["y0"] + h["y1"]) / 2, ent_z + 0.8), bevel=0.01)
        # Cornice profile (outward, up), mirrored to overhang both faces of the entablature.
        prof = [(0.0, 0.0), (0.12, 0.02), (0.14, 0.08), (0.24, 0.14), (0.3, 0.24), (0.3, 0.3), (0.0, 0.3)]
        corn_o = cl.moulding("cornice_o", L, [(side * (0.48 + u), v) for u, v in prof], (x, h["y0"], ent_z + 1.05))
        corn_i = cl.moulding("cornice_i", L, [(-side * (0.48 + u), v) for u, v in prof], (x, h["y0"], ent_z + 1.05))
        for o in (arch_, frieze, corn_o, corn_i):
            mat.assign(o, stone)
            parts.append(o)
        # A fillet band along the frieze facing the nave.
        band = cl.box("fillet", (0.08, L, 0.08), (x - side * 0.5, (h["y0"] + h["y1"]) / 2, ent_z + 0.62))
        mat.assign(band, stone)
        parts.append(band)
    # Roof beams over the nave: they paint stripes of sun across the floor.
    for y in ys:
        bm_ = cl.box("beam", (h["x1"] - h["x0"] + 1.2, 0.34, 0.5), ((h["x0"] + h["x1"]) / 2, float(y), ent_z + 1.55), bevel=0.01)
        mat.assign(bm_, stone)
        parts.append(bm_)
    for y in np.arange(h["y0"] + 4, h["y1"] - 1, h["bay"]):
        for dx in (-2.6, 0.0, 2.6):
            lath = cl.box("lath", (0.16, h["bay"] - 0.34, 0.18), ((h["x0"] + h["x1"]) / 2 + dx, float(y) - h["bay"] / 2, ent_z + 1.9))
            mat.assign(lath, stone)
            parts.append(lath)
    # Back wall behind the right colonnade, with shallow niches.
    wl = cl.box("wall", (0.4, L, ent_z + 1.35), (h["wall"], (h["y0"] + h["y1"]) / 2, (ent_z + 1.35) / 2))
    mat.assign(wl, wall)
    parts.append(wl)
    for y in ys[:-1]:
        niche = cl.arch_ring("niche", 0.8, 2.6, 0.0, 0.14, 0.0, 0.06, n_arc=24, base=0.8)
        cl.place(niche, (h["wall"] - 0.23, float(y) + h["bay"] / 2, 0.0), -90)
        mat.assign(niche, stone)
        parts.append(niche)
    props = []
    # Low balustrade outside the left colonnade.
    bal_x = h["x0"] - 1.1
    props.append(mat.assign(cl.box("rail_top", (0.3, L, 0.12), (bal_x, (h["y0"] + h["y1"]) / 2, 1.0), bevel=0.01), stone))
    props.append(mat.assign(cl.box("rail_base", (0.34, L, 0.14), (bal_x, (h["y0"] + h["y1"]) / 2, 0.07), bevel=0.01), stone))
    for y in np.arange(h["y0"] + 0.3, h["y1"], 0.5):
        b = cl.lathe("baluster", [(0.07, 0.14), (0.09, 0.2), (0.05, 0.3), (0.06, 0.45), (0.11, 0.62), (0.06, 0.8), (0.04, 0.86), (0.08, 0.94)], 10, (bal_x, float(y), 0.0))
        mat.assign(b, stone)
        props.append(b)
    # End walls pierced by grand open arches (boolean cut), with a moulded archivolt.
    for y, name in ((h["y1"], "far"), (h["y0"], "near")):
        x0, x1 = h["x0"] - 1.6, h["wall"] + 0.2
        wb = cl.box(f"{name}_wall", (x1 - x0, 0.9, ent_z + 2.1), ((x0 + x1) / 2, y, (ent_z + 2.1) / 2))
        cut = cl.arch_panel(f"{name}_cut", 2.7, 3.8, 0.0, n_arc=48, base=-0.5)
        sol = cut.modifiers.new("s", "SOLIDIFY")
        sol.thickness = 3.0
        sol.offset = 0.0
        geo.apply_all(cut)
        cut.location = (0, y, 0)
        boo = wb.modifiers.new("hole", "BOOLEAN")
        boo.operation = "DIFFERENCE"
        boo.solver = "EXACT"
        boo.object = cut
        geo.apply_all(wb)
        bpy.data.objects.remove(cut, do_unlink=True)
        mat.assign(wb, stone)
        parts.append(wb)
        ring = cl.arch_ring(f"{name}_arch", 2.7, 3.8, 0.0, 0.32, -0.6, 0.6, n_arc=48)
        cl.place(ring, (0, y, 0), 0)
        mat.assign(ring, stone)
        parts.append(ring)
        key = cl.box(f"{name}_key", (0.5, 1.3, 0.7), (0, y, 3.8 + 2.7 + 0.2), bevel=0.02)
        mat.assign(key, stone)
        parts.append(key)
    # Daises under the doors.
    for i in range(len(DOORS)):
        _, loc, _ = door_frame(i)
        d = cl.steps(f"dais{i}", 3.9, 1.8, 2, DAIS_H / 2, 0.28, (0, 0, 0))
        cl.place(d, (loc.x, loc.y, 0.0), DOOR_YAW)
        mat.assign(d, stone)
        parts.append(d)
    # Lanterns on posts beside each dais (lit at night).
    iron = mat.principled(f"lantern_iron_{variant}", base=(0.03, 0.03, 0.035), metal=1.0, rough=0.45)
    glow = mat.principled(f"lantern_glass_{variant}", base=(1.0, 0.85, 0.6), emission=(1.0, 0.7, 0.38), emission_strength=(12.0 if variant == "night" else 0.0), rough=0.2, transmission=0.3)
    for i in range(len(DOORS)):
        M, loc, R = door_frame(i)
        for s in (-1, 1):
            p = M @ Vector((s * 2.35, -0.55, -DAIS_H))
            pole = cl.cylinder("lpole", 0.035, 1.9, (p.x, p.y, 0.95), segments=12)
            base = cl.cylinder("lbase", 0.1, 0.12, (p.x, p.y, 0.06), segments=16, radius2=0.07)
            cap = cl.cylinder("lcap", 0.13, 0.1, (p.x, p.y, 2.36), segments=4, radius2=0.02)
            frame = cl.box("lframe", (0.2, 0.2, 0.34), (p.x, p.y, 2.12), bevel=0.0)
            sol = frame.modifiers.new("w", "WIREFRAME")
            sol.thickness = 0.015
            geo.apply_all(frame)
            for o in (pole, base, cap, frame):
                mat.assign(o, iron)
                props.append(o)
            lg = cl.box("lglass", (0.17, 0.17, 0.3), (p.x, p.y, 2.12))
            mat.assign(lg, glow)
            props.append(lg)
    # Planters with clipped topiary balls between the doors.
    pot = cl.marble(f"pot_{variant}", pal["stone2"], [c * 0.7 for c in pal["stone2"]], scale=2.0, rough=0.4)
    leaf = mat.principled(f"topiary_{variant}", base=lin("#5f8f4e") if variant == "day" else lin("#3b5a45"), rough=0.7, sheen=0.5)
    for i in range(len(DOORS) - 1):
        _, a, _ = door_frame(i)
        _, b2, _ = door_frame(i + 1)
        c = (a + b2) / 2 + Vector((1.4, 0, 0))
        urn = cl.lathe("urn", [(0.28, 0.0), (0.34, 0.06), (0.24, 0.16), (0.32, 0.5), (0.44, 0.78), (0.46, 0.86), (0.4, 0.9)], 32, (c.x, c.y, 0.0))
        mat.assign(urn, pot)
        props.append(urn)
        ball = geo.primitive("ico", "topiary", subdiv=3, radius=0.62)
        ball.location = (c.x, c.y, 1.45)
        geo.displace_noise(ball, strength=0.09, scale=0.08, detail=2)
        geo.apply_all(ball)
        geo.set_origin_world(ball)
        geo.smooth(ball, 80)
        mat.assign(ball, leaf)
        props.append(ball)
    return parts, props


def build_floor(variant, white=False):
    pal = PAL[variant]
    h = HALL
    m = mat.principled(f"floor_white_{variant}", base=(0.8, 0.8, 0.8), rough=0.9) if white else cl.floor_tiles(f"floor_{variant}", pal["floor_a"], pal["floor_b"], pal["inlay"], tile=1.5, rough=0.07)
    pieces = []
    x0, x1 = h["x0"] - 3.0, h["wall"]
    ys = np.linspace(h["y0"] - 1, h["y1"] + 1, 5)
    for k in range(4):
        # Flat quads subdivided a little so vertex fog and the mirror seam behave.
        p = geo.primitive("grid", f"floor{k}", x=16, y=16, size=0.5)
        p.data.transform(Matrix.Translation(((x0 + x1) / 2, float(ys[k] + ys[k + 1]) / 2, 0.0)) @ Matrix.Diagonal((x1 - x0, float(ys[k + 1] - ys[k]), 1.0, 1.0)))
        pieces.append(p)
    f = geo.join(pieces, "floor")
    mat.assign(f, m)
    return f


def sky_world(variant):
    pal = PAL[variant]
    w = bpy.data.worlds.new(f"sky_{variant}")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    ab = nt.nodes.new("ShaderNodeMath")
    ab.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Z"], ab.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cols = pal["sky"]
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (*cols[0], 1)
    els[1].position = 1.0
    els[1].color = (*cols[-1], 1)
    for k, pos in ((1, 0.12), (2, 0.4)):
        e = els.new(pos)
        e.color = (*cols[k], 1)
    nt.links.new(ab.outputs[0], ramp.inputs["Fac"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.75 if variant == "day" else 0.6
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    if variant == "night":
        # Stars for camera rays only.
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.inputs["Scale"].default_value = 260.0
        nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
        st = nt.nodes.new("ShaderNodeMapRange")
        st.inputs["From Min"].default_value = 0.035
        st.inputs["From Max"].default_value = 0.0
        st.inputs["To Max"].default_value = 6.0
        nt.links.new(vor.outputs["Distance"], st.inputs["Value"])
        add = nt.nodes.new("ShaderNodeMix")
        add.data_type = "RGBA"
        add.blend_type = "ADD"
        nt.links.new(st.outputs[0], add.inputs["Factor"])
        nt.links.new(ramp.outputs["Color"], add.inputs[6])
        add.inputs[7].default_value = (0.8, 0.85, 1.0, 1)
        bg2 = nt.nodes.new("ShaderNodeBackground")
        nt.links.new(add.outputs[2], bg2.inputs["Color"])
        bg2.inputs["Strength"].default_value = 0.6
        lp = nt.nodes.new("ShaderNodeLightPath")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
        nt.links.new(bg.outputs[0], mix.inputs[1])
        nt.links.new(bg2.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
    else:
        nt.links.new(bg.outputs[0], out.inputs[0])
    return w


SUN_DIR = {"day": Vector((-0.78, -0.3, 0.55)).normalized(), "night": Vector((-0.3, 0.8, 0.52)).normalized()}


def lights(variant):
    pal = PAL[variant]
    d = SUN_DIR[variant]
    sun = scene.sun_light("sun", strength=pal["sun_strength"], color=pal["sun"], angle_deg=1.5 if variant == "day" else 0.8)
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    # Far-end glow card behind the big arch (the corridor recedes into soft light).
    h = HALL
    for y, sgn in ((h["y1"] + 3.0, 1), (h["y0"] - 3.0, -1)):
        card = geo.primitive("grid", "far_glow", x=2, y=2, size=1.0)
        card.scale = (12, 9, 1)
        card.rotation_euler = (math.pi / 2, 0, 0)
        card.location = (0, y, 4)
        geo.apply_all(card)
        geo.set_origin_world(card)
        gm = cl.emissive_gradient(f"far_{variant}_{sgn}", pal["far"], strength=2.4 if variant == "day" else 1.6, axis="Z")
        mat.assign(card, gm)
        card["band"] = "back"
    if variant == "night":
        # Moon disc high over the left colonnade.
        moon = geo.primitive("sphere", "moon", u=32, v=16, radius=6.0)
        moon.location = Vector((0, 20, 0)) + SUN_DIR["night"] * 260
        mat.assign(moon, mat.emission("moon", (0.85, 0.9, 1.0), 6.0))
        moon["band"] = "back"


def pano_path(scene_id, variant):
    p = REPO / "public" / "worlds" / scene_id / f"pano-{variant}.webp"
    return p if p.exists() else None


def portal_material(door, variant, R):
    """Emission sampled from the world's panorama by view direction, like the runtime shader.
    Falls back to the world's palette gradient if that world has no pano yet."""
    m = bpy.data.materials.new(f"portal_{door['id']}_{variant}")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.35 if variant == "day" else 2.2
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    path = pano_path(door["scene"], variant)
    geo_n = nt.nodes.new("ShaderNodeNewGeometry")
    neg = nt.nodes.new("ShaderNodeVectorMath")
    neg.operation = "SCALE"
    neg.inputs["Scale"].default_value = -1.0
    nt.links.new(geo_n.outputs["Incoming"], neg.inputs[0])
    into = R @ Vector((0, 1, 0))
    right = R @ Vector((1, 0, 0))

    def dot(v):
        d = nt.nodes.new("ShaderNodeVectorMath")
        d.operation = "DOT_PRODUCT"
        nt.links.new(neg.outputs[0], d.inputs[0])
        d.inputs[1].default_value = tuple(v)
        return d.outputs["Value"]

    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    b_ = dot(into)
    a_ = dot(right)
    na = nt.nodes.new("ShaderNodeMath")
    na.operation = "MULTIPLY"
    na.inputs[1].default_value = -1.0
    nt.links.new(a_, na.inputs[0])
    nt.links.new(b_, comb.inputs["X"])
    nt.links.new(na.outputs[0], comb.inputs["Y"])
    nt.links.new(dot(Vector((0, 0, 1))), comb.inputs["Z"])
    if path:
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(str(path), check_existing=True)
        nt.links.new(comb.outputs[0], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], em.inputs["Color"])
    else:
        # Aurora-like fallback: elevation gradient warped by soft noise.
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(comb.outputs[0], sep.inputs[0])
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 2.2
        nz.inputs["Detail"].default_value = 4
        nt.links.new(comb.outputs[0], nz.inputs["Vector"])
        warp = nt.nodes.new("ShaderNodeMath")
        warp.operation = "MULTIPLY_ADD"
        warp.inputs[1].default_value = 0.7
        nt.links.new(nz.outputs["Fac"], warp.inputs[0])
        nt.links.new(sep.outputs["Z"], warp.inputs[2])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = -0.1
        mr.inputs["From Max"].default_value = 1.2
        nt.links.new(warp.outputs[0], mr.inputs["Value"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        cols = [lin(c) for c in door[variant]]
        els = ramp.color_ramp.elements
        els[0].color = (*cols[1], 1)
        els[1].color = (*cols[2], 1)
        e = els.new(0.5)
        e.color = (*cols[0], 1)
        nt.links.new(mr.outputs[0], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    return m


def build_arches(variant=None, ajar_deg=0.0, for_export=False):
    """All five doors placed in the world. Returns (objects, leaves, portals, layout)."""
    ar.materials()
    objs, leaves, portals = [], [], []
    layout = {"doors": [], "bulbs": [], "w": ar.W, "h": ar.H, "portalY": ar.PORTAL_Y}
    for i, door in enumerate(DOORS):
        M, loc, R = door_frame(i)
        parts, (lL, lR), bulbs = ar.BUILDERS[door["id"]]()
        for o in parts:
            o.data.transform(M @ o.matrix_world)
            o.matrix_world = Matrix.Identity(4)
        frame = geo.join(parts, f"arch_{door['id']}")
        objs.append(frame)
        for o, side in ((lL, -1), (lR, 1)):
            hinge = Vector(o["hinge"])
            base = M @ Matrix.Translation(hinge)
            swing = Matrix.Rotation(math.radians(ajar_deg) * (-side), 4, "Z")
            o.matrix_world = base @ swing
            o.name = f"leaf_{door['id']}_{'L' if side < 0 else 'R'}"
            leaves.append(o)
        portal = cl.arch_panel(f"portal_{door['id']}", ar.W, ar.H, ar.PORTAL_Y, n_arc=40)
        portal.data.transform(M)
        if variant and not for_export:
            mat.assign(portal, portal_material(door, variant, R))
        else:
            mat.assign(portal, mat.emission(f"portal_{door['id']}", (1, 1, 1), 1.0))
        portals.append(portal)
        into = R @ Vector((0, 1, 0))
        right = R @ Vector((1, 0, 0))
        center = M @ Vector((0, ar.PORTAL_Y, ar.H * 0.72))
        layout["doors"].append(
            {
                "id": door["id"],
                "scene": door["scene"],
                "base": to_three(loc),
                "center": to_three(center),
                "into": to_three(into),
                "right": to_three(right),
                "up": [0, 1, 0],
                "spill": to_three(M @ Vector((0, -1.6, 0.0))),
            }
        )
        for b in bulbs:
            layout["bulbs"].append(to_three(M @ Vector(b)))
        if bulbs and not for_export:
            bm_ = []
            for b in bulbs:
                s = cl.cylinder("bulb", 0.04, 0.04, (0, 0, 0), segments=10)
                geo.subsurf(s, 1)
                geo.apply_all(s)
                s.location = M @ Vector(b)
                geo.set_origin_world(s)
                bm_.append(s)
            bj = geo.join(bm_, f"bulbs_{door['id']}")
            mat.assign(bj, ar._mats["bulb"])
            objs.append(bj)
    return objs, leaves, portals, layout


def step_arches():
    scene.reset()
    objs, leaves, portals, layout = build_arches(for_export=True)
    export.glb(OUT / "arches.glb", objs + leaves + portals)
    (PUB / "hi" / "layout.json").write_text(json.dumps(layout))
    tris = sum(geo.triangle_count(o) for o in objs + leaves + portals)
    cli.log("arches", len(objs), "frames", len(leaves), "leaves", tris, "tris")


# --------------------------------------------------------------------------
def step_bake():
    size = 1024 if args.preview else args.bake_size
    spp = 64 if args.preview else (args.samples or 200)
    for variant in args.variants:
        scene.reset()
        scene.cycles(samples=spp, bounces=5, res=(1920, 1200))
        sky_world(variant)
        lights(variant)
        # Occluders and light sources that are not part of the bake itself.
        build_arches(variant, ajar_deg=30.0)
        shell, props = build_shell(variant)
        floor = build_floor(variant)
        baked = bake.bake_group(shell, "shell", OUT / f"bake-{variant}", size=size, samples=spp)
        bprops = bake.bake_group(props, "props", OUT / f"bake-{variant}", size=size // 2, samples=spp)
        cli.log("shell tris", geo.triangle_count(baked), "props tris", geo.triangle_count(bprops))
        white = build_floor(variant, white=True)
        bpy.data.objects.remove(floor, do_unlink=True)
        fl = bake.bake_group([white], "floor", OUT / f"bake-{variant}", size=size, samples=spp)
        export.glb(OUT / f"corridor-{variant}.glb", [baked, bprops, fl])


# --------------------------------------------------------------------------
# Camera rail, keyed in scene s; rail time = s + OFFSET.
KEYS = [
    # s,    pos,                   look,                fov, roll
    (-0.15, (-0.6, -12.5, 5.6), (2.6, 11.0, 1.2), 48, -2),
    (0.00, (-1.1, -10.0, 4.5), (2.9, 12.0, 1.6), 46, -1.5),
    (0.30, (-2.1, -6.0, 2.9), (3.3, 13.5, 2.1), 44, -0.5),
    (0.60, (-2.6, -1.8, 2.0), (3.8, 16.5, 2.4), 42, 0),
    (0.85, (-2.5, 2.2, 1.75), (4.2, 20.0, 2.6), 40, 0.6),
    (1.00, (-2.2, 5.2, 1.7), (4.2, 23.0, 2.7), 39, 1),
    (1.15, (-1.9, 8.2, 1.75), (4.0, 26.0, 2.8), 38, 1),
]


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 1000
    rails.key(cam, [{"s": s + OFFSET, "pos": p, "look": l, "fov": f, "roll": r} for s, p, l, f, r in KEYS])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written", S_MAX)


# --------------------------------------------------------------------------
def stage(variant, ajar=30.0):
    scene.reset()
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 72), bounces=6, res=(1920, 1200))
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - High Contrast", exposure=0.0 if variant == "day" else 0.2)
    sky_world(variant)
    lights(variant)
    objs, leaves, portals, _ = build_arches(variant, ajar_deg=ajar)
    shell, props = build_shell(variant)
    floor = build_floor(variant)
    cam = build_camera()
    fronts = objs + leaves + portals
    backs = shell + props + [floor] + [o for o in bpy.context.scene.objects if o.get("band") == "back"]
    return sc, cam, {"back": backs, "mid": fronts}


def step_preview():
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        rails.set_at(args.s + OFFSET)
        sc.render.resolution_x, sc.render.resolution_y = 960, 600
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png")


TAGS = [0.0, 0.5, 1.0]


def fix_manifest(tag, s):
    p = OUT / "layers" / f"{tag}.json"
    info = json.loads(p.read_text())
    info["s"] = s
    p.write_text(json.dumps(info, indent=1))


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        for s in tags:
            tag = f"{variant}-s{int(round(s * 100)):03d}"
            render.layers(cam, s + OFFSET, [("back", bands["back"]), ("mid", bands["mid"])], OUT / "layers", tag, samples=sc.cycles.samples)
            fix_manifest(tag, s)


def step_pano():
    for variant in args.variants:
        sc, cam, bands = stage(variant, ajar=38.0)
        loc = Vector((-0.6, 6.0, 1.8))
        png = OUT / f"pano-{variant}.png"
        # Face the doors receding along the right-hand side.
        yaw = math.degrees(math.atan2(12.0, 4.5))
        render.panorama(png, loc, res=(4096, 2048), samples=args.samples or 64, look_yaw_deg=yaw)
        cli.log("pano", variant, png)


def step_mini():
    """A marble arch with gold inlay on a round plinth, glowing with the home gradient."""
    scene.reset()
    ar.materials()
    s = 0.2
    stone = mat.principled("mini_marble", base=lin("#f6eeee"), rough=0.3, coat=0.4, coat_rough=0.1)
    parts = []
    va = cl.voussoirs("mini_arch", ar.W, ar.H, 0.0, 0.5, -0.3, 0.3, count=9, gap=0.015, key_scale=1.3, legs=3, seed=3)
    mat.assign(va, stone)
    parts.append(va)
    parts.append(ar.tube("mini_inlay", cl.arch_path(ar.W, ar.H, 0.25, 40, step=0.3), -0.31, 0.02, "gold", 6))
    plinth = cl.lathe("mini_plinth", [(0.0, -0.5), (2.3, -0.5), (2.35, -0.42), (2.2, -0.36), (2.2, -0.2), (2.05, -0.16), (2.05, 0.0), (0.0, 0.0)], 64)
    mat.assign(plinth, stone)
    parts.append(plinth)
    ring = cl.lathe("mini_ring", [(2.08, -0.2), (2.24, -0.2), (2.24, -0.14), (2.08, -0.14)], 64)
    mat.assign(ring, ar._mats["gold"])
    parts.append(ring)
    # Portal: the home gradient (yellow -> pink -> blue, bottom to top) as an emissive map.
    portal = cl.arch_panel("mini_portal", ar.W, ar.H, 0.0, n_arc=24)
    cols = [np.array(lin(c)) for c in ("#ffe08f", "#ff9cc2", "#9dbcff")]
    px = np.zeros((64, 8, 4), dtype=np.float32)
    for yy in range(64):
        t = yy / 63
        c = cols[0] + (cols[1] - cols[0]) * (t * 2) if t < 0.5 else cols[1] + (cols[2] - cols[1]) * ((t - 0.5) * 2)
        px[yy, :, :3] = c
        px[yy, :, 3] = 1
    img = bpy.data.images.new("mini_grad", 8, 64)
    img.pixels = px.ravel()
    img.filepath_raw = str(OUT / "mini_grad.png")
    img.file_format = "PNG"
    img.save()
    me = portal.data
    uv = me.uv_layers.active
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = (0.5, co.z / (ar.H + ar.W))
    pm = mat.principled("mini_portal", base=(0, 0, 0), emission_strength=1.6, rough=0.4)
    tex = mat.image_node(pm, OUT / "mini_grad.png", "sRGB", uv_map=uv.name)
    pm.node_tree.links.new(tex.outputs["Color"], mat.bsdf_of(pm).inputs["Emission Color"])
    mat.assign(portal, pm)
    parts.append(portal)
    o = geo.join(parts, "mini_doors")
    o.data.transform(Matrix.Scale(s, 4))
    # Sit on the origin: plinth bottom at z=0.
    zmin = min(v.co.z for v in o.data.vertices)
    o.data.transform(Matrix.Translation((0, 0, -zmin)))
    geo.smooth(o, 40)
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 2) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "arches": step_arches,
    "bake": step_bake,
    "rail": step_rail,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview",) or "preview" in args.steps):
        fn()
