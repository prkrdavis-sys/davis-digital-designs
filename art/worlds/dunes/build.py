"""The golden dunes: monumental template monoliths in a sunset erg.

Steps (run with --steps a,b,...):
  terrain    dune height field -> decimated core mesh + horizon skirt (terrain.glb),
             runtime field.bin, 4K normal map, dunes.json
  sky        night sky equirect (Milky Way, stars, moon) for Cycles and the runtime
  monoliths  slabs with bezels, bands and panel planes (monoliths.glb)
  props      bleached quiver trunks and half-buried boulders (props.glb)
  bake       Cycles: sun visibility + diffuse irradiance per variant -> terrain light maps
  rail       camera flight -> rails.json
  preview    quick Cycles still at --s
  layers     Low Resources depth layers + posters for every tag (day/night)
  pano       360 view from a dune crest
  mini       homepage miniature: a dune with a monolith on a base

Terrain math, slab layout and the flight live in dunes_model.py.
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import dunes_model as dm  # noqa: E402
import sky as sky_mod  # noqa: E402
from ddd import cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "dunes"
CACHE = cli.CACHE


def extra_args(p):
    p.add_argument("--s", default="0.3", help="chapter time(s) for preview, comma separated")
    p.add_argument("--tags", default="")
    p.add_argument("--bake-size", type=int, default=4096)


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
TEX = 4096


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# Kept in step with src/worlds/scenes/dunes/palette.ts.
LOOK = {
    "day": {
        "sun": lin("#ffbd76"),
        "sun_strength": 7.5,
        "sky_strength": 0.7,
        "haze": (1.0, 0.94, 0.88),
        "fog": 0.00016,
        "sand": (lin("#e6b273"), lin("#cf955a")),
        "panel": 2.6,
    },
    "night": {
        "sun": lin("#9fb8ff"),
        "sun_strength": 0.55,
        "sky_strength": 1.0,
        "haze": (0.95, 1.0, 1.1),
        "fog": 0.00014,
        "sand": (lin("#c99a6a"), lin("#b3845a")),
        "panel": 4.5,
    },
}


def b2t(v):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


# --------------------------------------------------------------------------
# Terrain
def grid_mesh(name, X, Y, H):
    ny, nx = H.shape
    verts = np.column_stack([X.ravel(), Y.ravel(), H.ravel()]).astype(np.float32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    idx = np.arange(nx * ny, dtype=np.int32).reshape(ny, nx)
    q = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    nq = len(q)
    me.loops.add(nq * 4)
    me.loops.foreach_set("vertex_index", q.ravel())
    me.polygons.add(nq)
    me.polygons.foreach_set("loop_start", np.arange(0, nq * 4, 4, dtype=np.int32))
    me.update(calc_edges=True)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def heights_tiled(xs, ys, tile=512):
    H = np.zeros((len(ys), len(xs)))
    for i in range(0, len(ys), tile):
        for j in range(0, len(xs), tile):
            X, Y = np.meshgrid(xs[j : j + tile], ys[i : i + tile])
            H[i : i + tile, j : j + tile] = dm.height(X, Y)
    return H


def texel_axes(n):
    x = dm.CORE_X0 + (np.arange(n) + 0.5) * dm.CORE_SIZE / n
    y = dm.CORE_Y0 + (np.arange(n) + 0.5) * dm.CORE_SIZE / n
    return x, y


def save_png(arr, path, depth="8"):
    """arr: (h, w, 3|4) floats in 0..1, row 0 = bottom (Blender convention)."""
    h, w, c = arr.shape
    if c == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1), np.float32)], axis=2)
    img = bpy.data.images.new(pathlib.Path(path).stem, w, h, alpha=True, float_buffer=depth == "16")
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    sc = bpy.context.scene
    sc.render.image_settings.color_depth = depth
    img.save()
    bpy.data.images.remove(img)
    return path


def planar_uv(o, name="bake"):
    me = o.data
    uv = me.uv_layers.get(name) or me.uv_layers.new(name=name)
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    li = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", li)
    u = (co[li, 0] - dm.CORE_X0) / dm.CORE_SIZE
    v = (co[li, 1] - dm.CORE_Y0) / dm.CORE_SIZE
    uv.data.foreach_set("uv", np.column_stack([u, v]).astype(np.float32).ravel())
    me.uv_layers.active = uv
    return uv


def step_terrain():
    scene.reset()
    # 1. Runtime field (particles, helpers): 512^2 heights at texel centers, uint16.
    fx, fy = texel_axes(dm.FIELD_RES)
    F = heights_tiled(fx, fy)
    hmin, hmax = float(F.min()) - 1.0, float(F.max()) + 1.0
    q = np.round((F - hmin) / (hmax - hmin) * 65535).astype("<u2")
    (PUB / "hi" / "field.bin").write_bytes(q.tobytes())
    cli.log("field", F.shape, round(hmin, 2), round(hmax, 2))

    # 2. Normal map at 4K from the analytic heights (sharper than the mesh).
    tx, ty = texel_axes(TEX)
    H4 = heights_tiled(tx, ty)
    np.save(OUT / "h4.npy", H4.astype(np.float32))
    px = dm.CORE_SIZE / TEX
    gy, gx = np.gradient(H4, px)
    n = np.stack([-gx, -gy, np.ones_like(H4)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    np.save(OUT / "n4.npy", n.astype(np.float16))
    save_png((n * 0.5 + 0.5).astype(np.float32), OUT / "normal.png")
    cli.log("normal map", n.shape)

    # 3. Core mesh: 2 m grid, decimated where the sand is flat.
    xs = np.linspace(dm.CORE_X0, dm.CORE_X0 + dm.CORE_SIZE, dm.CORE_RES)
    ys = np.linspace(dm.CORE_Y0, dm.CORE_Y0 + dm.CORE_SIZE, dm.CORE_RES)
    H = heights_tiled(xs, ys)
    X, Y = np.meshgrid(xs, ys)
    core = grid_mesh("terrain", X, Y, H)
    del X, Y
    cli.log("core grid", len(core.data.vertices), "verts; decimating")
    m = core.modifiers.new("dec", "DECIMATE")
    m.ratio = 0.11
    m.use_collapse_triangulate = True
    geo.apply_all(core)
    cli.log("core tris", geo.triangle_count(core))

    # 4. Horizon skirt: geometric spacing out to the horizon; hidden under the core inside.
    cxm = dm.CORE_X0 + dm.CORE_SIZE / 2
    cym = dm.CORE_Y0 + dm.CORE_SIZE / 2
    ax = dm.far_axis()
    FX, FY = np.meshgrid(ax + cxm, ax + cym)
    FH = np.zeros_like(FX)
    for i in range(0, FX.shape[0], 64):
        FH[i : i + 64] = dm.height(FX[i : i + 64], FY[i : i + 64])
    inside = (np.abs(FX - cxm) < dm.CORE_SIZE / 2 - 1) & (np.abs(FY - cym) < dm.CORE_SIZE / 2 - 1)
    FH[inside] -= 4.0
    far = grid_mesh("far", FX, FY, FH)
    cli.log("far verts", len(far.data.vertices))
    for o in (core, far):
        geo.smooth(o, 180)
    planar_uv(core)

    export.glb(OUT / "terrain.glb", [core, far], export_materials="NONE", export_texcoords=False)
    bpy.data.libraries.write(str(OUT / "terrain.blend"), {core, far}, fake_user=True)
    meta = dm.export_meta(OUT / "dunes_meta.json", {"field": {"res": dm.FIELD_RES, "min": round(hmin, 3), "max": round(hmax, 3)}})
    cli.log("terrain done", len(meta["monoliths"]), "slabs", len(meta["footprints"]), "footprints")


def step_meta():
    """Refresh dunes_meta.json (layout, ridges, footprints) keeping the field and bake numbers."""
    mfile = OUT / "dunes_meta.json"
    old = json.loads(mfile.read_text()) if mfile.exists() else {}
    dm.export_meta(mfile, {k: old[k] for k in ("field", "light") if k in old})
    cli.log("meta refreshed")


def load_terrain():
    with bpy.data.libraries.load(str(OUT / "terrain.blend")) as (src, dst):
        dst.objects = [n for n in src.objects if n in ("terrain", "far")]
    objs = {}
    for o in dst.objects:
        bpy.context.scene.collection.objects.link(o)
        objs[o.name] = o
    return objs["terrain"], objs["far"]


# --------------------------------------------------------------------------
# Skies (sky.py): HDR equirects for Cycles, Reinhard-encoded copies for the runtime dome.
def save_exr(col, path):
    h, w, _ = col.shape
    img = bpy.data.images.new(pathlib.Path(path).stem, w, h, alpha=False, float_buffer=True)
    img.pixels.foreach_set(np.concatenate([col, np.ones((h, w, 1), np.float32)], 2).astype(np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "OPEN_EXR"
    img.save()
    bpy.data.images.remove(img)


def step_sky():
    for variant in args.variants:
        col = sky_mod.day_sky(4096, 2048) if variant == "day" else sky_mod.night_sky(4096, 2048)
        save_exr(col, OUT / f"sky_{variant}.exr")
        # Runtime decodes x = pow(tex, 2.2); radiance = x / (1 - x).
        enc = (col / (1.0 + col)) ** (1 / 2.2)
        save_png(np.clip(enc, 0, 1).astype(np.float32), OUT / f"sky-{variant}.png")
        cli.log("sky", variant, "max", round(float(col.max()), 2))


# --------------------------------------------------------------------------
# Monoliths
def rounded_rect(w, h, r, seg=6):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def ring_mesh(name, outer, inner, depth, x0):
    """Extruded frame between two closed outlines lying in the local YZ plane, facing +X."""
    bm = bmesh.new()
    n = len(outer)
    rings = []
    for x in (x0, x0 + depth):
        ro = [bm.verts.new((x, p[0], p[1])) for p in outer]
        ri = [bm.verts.new((x, p[0], p[1])) for p in inner]
        rings.append((ro, ri))
    (bo, bi), (fo, fi) = rings
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((fo[i], fo[j], fi[j], fi[i]))  # front
        bm.faces.new((bo[j], fo[j], fo[i], bo[i]))  # outer wall
        bm.faces.new((bi[i], fi[i], fi[j], bi[j]))  # inner wall
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return geo.obj_from_bmesh(name, bm)


def panel_dims(m):
    pw = m["w"] * 0.78
    ph = pw * 16 / 9
    zc = (m["ground"] - m["base"]) + m["h"] * 0.54
    return pw, ph, zc


def build_slab(m):
    """One monolith as local-space pieces under an empty at its base (keeps GLB quantization tight)."""
    w, t = m["w"], m["thickness"]
    hgt = m["ground"] + m["h"] - m["base"]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * t, v.co.y * w, (v.co.z + 0.5) * hgt))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.06, segments=3, affect="EDGES", profile=0.5)
    # Box-ish UVs: v follows height so the sandstone strata run level.
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.x + co.y) * 0.12, co.z * 0.1)
    slab = geo.obj_from_bmesh(m["id"], bm)
    geo.smooth(slab, 35)
    pw, ph, zc = panel_dims(m)
    bez = ring_mesh(f"{m['id']}_bezel", [(y, z + zc) for y, z in rounded_rect(pw + 0.26, ph + 0.26, 0.2)], [(y, z + zc) for y, z in rounded_rect(pw + 0.03, ph + 0.03, 0.08)], 0.05, t / 2 - 0.005)
    geo.smooth(bez, 40)
    # Panel plane: u runs along +Y (viewer's right when facing +X), v up.
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    corners = [(-pw / 2, zc - ph / 2, 0, 0), (pw / 2, zc - ph / 2, 1, 0), (pw / 2, zc + ph / 2, 1, 1), (-pw / 2, zc + ph / 2, 0, 1)]
    vs = [bm.verts.new((t / 2 + 0.012, y, z)) for y, z, _, _ in corners]
    f = bm.faces.new(vs)
    for loop, (_, _, u, v) in zip(f.loops, corners):
        loop[uvl].uv = (u, v)
    panel = geo.obj_from_bmesh(f"{m['id']}_panel", bm)
    # Brushed band near the top and a glowing accent line under the panel.
    band_z = hgt - 1.0
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * (t + 0.035), v.co.y * (w + 0.035), band_z + v.co.z * 0.09))
    band = geo.obj_from_bmesh(f"{m['id']}_band", bm)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((t / 2 + v.co.x * 0.03, v.co.y * pw * 0.62, zc - ph / 2 - 0.42 + v.co.z * 0.045))
    line = geo.obj_from_bmesh(f"{m['id']}_line", bm)
    root = bpy.data.objects.new(f"{m['id']}_root", None)
    bpy.context.scene.collection.objects.link(root)
    lean = math.radians(m["lean"])
    root.matrix_world = Matrix.Translation(Vector((m["p"][0], m["p"][1], m["base"]))) @ Matrix.Rotation(math.radians(m["yaw"]), 4, "Z") @ Matrix.Rotation(lean, 4, "X")
    parts = {"slab": slab, "bezel": bez, "panel": panel, "band": band, "line": line}
    for role, o in parts.items():
        o.parent = root
        export.tag(o, role=role, kind=m["kind"], product=m["product"], slab=m["id"])
    export.tag(root, role="root", kind=m["kind"], product=m["product"], slab=m["id"])
    return root, parts


def meta():
    return json.loads((OUT / "dunes_meta.json").read_text())


def step_monoliths():
    scene.reset()
    objs = []
    for m in meta()["monoliths"]:
        root, parts = build_slab(m)
        objs += [root, *parts.values()]
    export.glb(OUT / "monoliths.glb", objs, export_materials="NONE")


# --------------------------------------------------------------------------
# Props (Poly Haven, CC0)
PROP_SRC = {
    "trunk": ("dead_quiver_trunk", CACHE / "polyhaven/model/dead_quiver_trunk/1k/dead_quiver_trunk_1k.blend"),
    "boulder": ("namaqualand_boulder_02", CACHE / "polyhaven/model/namaqualand_boulder_02/1k/namaqualand_boulder_02_1k.blend"),
}
_prop_cache = {}


def prop_source(kind):
    if kind in _prop_cache:
        return _prop_cache[kind]
    _, path = PROP_SRC[kind]
    with bpy.data.libraries.load(str(path)) as (src, dst):
        dst.objects = list(src.objects)
    meshes = [o for o in dst.objects if o and o.type == "MESH"]
    src_obj = meshes[0] if len(meshes) == 1 else None
    if src_obj is None:
        for o in meshes:
            bpy.context.scene.collection.objects.link(o)
        src_obj = geo.join(meshes, kind)
    src_obj.data.transform(src_obj.matrix_world)
    src_obj.matrix_world = Matrix.Identity(4)
    # Origin at the bottom center.
    co = np.array([v.co[:] for v in src_obj.data.vertices])
    lo = co.min(0)
    mid = (co.min(0) + co.max(0)) / 2
    src_obj.data.transform(Matrix.Translation(Vector((-mid[0], -mid[1], -lo[2]))))
    # Props stay small on screen: 512 px maps (optimize.mjs only resizes when converting to webp).
    for ms in src_obj.material_slots:
        for n in ms.material.node_tree.nodes if ms.material else []:
            if n.type == "TEX_IMAGE" and n.image and n.image.size[0] > 512:
                n.image.scale(512, 512)
    target = {"trunk": 7000, "boulder": 9000}[kind]
    tris = len(src_obj.data.polygons)
    if tris > target:
        if not src_obj.users_collection:
            bpy.context.scene.collection.objects.link(src_obj)
        geo.decimate(src_obj, target / tris)
        geo.apply_all(src_obj)
    for c in list(src_obj.users_collection):
        c.objects.unlink(src_obj)
    cli.log("prop", kind, "dims", [round(x, 2) for x in (co.max(0) - co.min(0))], "tris", len(src_obj.data.polygons))
    _prop_cache[kind] = src_obj
    return src_obj


def place_props():
    out = []
    for i, p in enumerate(meta()["props"]):
        src = prop_source(p["kind"])
        o = bpy.data.objects.new(f"{p['kind']}_{i}", src.data)
        bpy.context.scene.collection.objects.link(o)
        x, y = p["p"]
        z = float(dm.height(np.array(x), np.array(y))) - p["sink"] * p["scale"]
        o.matrix_world = Matrix.LocRotScale(Vector((x, y, z)), Matrix.Rotation(math.radians(p["yaw"]), 3, "Z").to_quaternion(), Vector((p["scale"],) * 3))
        export.tag(o, role="prop", kind=p["kind"])
        out.append(o)
    return out


def step_props():
    scene.reset()
    objs = place_props()
    export.glb(OUT / "props.glb", objs)


# --------------------------------------------------------------------------
# Cycles staging: materials, world, lights
def fogify(m, variant):
    """Aerial perspective for camera rays: blend toward the haze, warmer toward the sun."""
    L = LOOK[variant]
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    src = out.inputs["Surface"].links[0].from_socket
    lp = nt.nodes.new("ShaderNodeLightPath")
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    # density * ray length -> 1 - exp(-x)
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = -L["fog"]
    nt.links.new(lp.outputs["Ray Length"], mul.inputs[0])
    ex = nt.nodes.new("ShaderNodeMath")
    ex.operation = "EXPONENT"
    nt.links.new(mul.outputs[0], ex.inputs[0])
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = "SUBTRACT"
    inv.inputs[0].default_value = 1.0
    nt.links.new(ex.outputs[0], inv.inputs[1])
    cam = nt.nodes.new("ShaderNodeMath")
    cam.operation = "MULTIPLY"
    nt.links.new(inv.outputs[0], cam.inputs[0])
    nt.links.new(lp.outputs["Is Camera Ray"], cam.inputs[1])
    # haze color: the sky map sampled at the horizon in the view direction
    neg = nt.nodes.new("ShaderNodeVectorMath")
    neg.operation = "SCALE"
    neg.inputs["Scale"].default_value = -1.0
    nt.links.new(geom.outputs["Incoming"], neg.inputs[0])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(neg.outputs[0], sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs["X"], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    comb.inputs["Z"].default_value = 0.035
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(OUT / f"sky_{variant}.exr"), check_existing=True)
    nt.links.new(comb.outputs[0], env.inputs["Vector"])
    mixc = nt.nodes.new("ShaderNodeMix")
    mixc.data_type = "RGBA"
    mixc.blend_type = "MULTIPLY"
    mixc.inputs["Factor"].default_value = 1.0
    nt.links.new(env.outputs["Color"], mixc.inputs["A"])
    mixc.inputs["B"].default_value = (*L["haze"], 1)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = LOOK[variant]["sky_strength"]
    nt.links.new(mixc.outputs["Result"], em.inputs["Color"])
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(cam.outputs[0], mix.inputs[0])
    nt.links.new(src, mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


def sand_material(variant, uv_name="bake", with_normal=True):
    L = LOOK[variant]
    m = mat.principled(f"sand_{variant}", base=L["sand"][0], rough=0.93, specular=0.35, sheen=0.25, sheen_rough=0.5)
    nt = m.node_tree
    bsdf = mat.bsdf_of(m)
    ramp = mat.noise_color_node(m, scale=0.012, detail=4, colors=(L["sand"][1], L["sand"][0]), positions=(0.35, 0.65))
    tc = nt.nodes.new("ShaderNodeTexCoord")
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 3.0
    grain.inputs["Detail"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], grain.inputs["Vector"])
    mulc = nt.nodes.new("ShaderNodeMix")
    mulc.data_type = "RGBA"
    mulc.blend_type = "MULTIPLY"
    mulc.inputs["Factor"].default_value = 0.18
    nt.links.new(ramp.outputs["Color"], mulc.inputs["A"])
    nt.links.new(grain.outputs["Color"], mulc.inputs["B"])
    nt.links.new(mulc.outputs["Result"], bsdf.inputs["Base Color"])
    normal_src = None
    if with_normal:
        t = mat.image_node(m, OUT / "normal.png", "Non-Color", uv_map=uv_name)
        t.interpolation = "Cubic"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.space = "OBJECT"
        # Stored as n*0.5+0.5 in object space already.
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        normal_src = nm.outputs["Normal"]
    # Wind ripples perpendicular to +X, warped; fade out on the steep slip faces.
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    wave.inputs["Scale"].default_value = 0.9
    wave.inputs["Distortion"].default_value = 7.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.5
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.03
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    if normal_src is not None:
        nt.links.new(normal_src, bump.inputs["Normal"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def slab_materials(variant):
    glass = mat.principled(f"glass_{variant}", base=(0.006, 0.006, 0.008), rough=0.04, coat=1.0, coat_rough=0.02, specular=0.6)
    metal = mat.principled(f"metal_{variant}", base=(0.62, 0.45, 0.31), metal=1.0, rough=0.26, aniso=0.6)
    stone = mat.principled(f"stone_{variant}", base=lin("#a7744d"), rough=0.7, sheen=0.2)
    ramp = mat.noise_color_node(stone, scale=0.8, detail=6, colors=(lin("#8a5a38"), lin("#c08a5c")), positions=(0.3, 0.75))
    stone.node_tree.links.new(ramp.outputs["Color"], mat.bsdf_of(stone).inputs["Base Color"])
    gold = mat.principled(f"gold_{variant}", base=(1.0, 0.74, 0.42), metal=1.0, rough=0.18)
    dark = mat.principled(f"dark_{variant}", base=(0.02, 0.02, 0.025), rough=0.08, coat=1.0)
    return {"glass": glass, "metal": metal, "stone": stone, "gold": gold, "dark": dark}


def panel_material(variant, idx, accent):
    L = LOOK[variant]
    m = mat.principled(f"panel_{idx}_{variant}", base=(0, 0, 0), rough=0.05, coat=1.0, coat_rough=0.03, emission_strength=L["panel"])
    t = mat.image_node(m, OUT / "panels" / f"panel-{idx}.png", "sRGB", uv_map="UVMap")
    m.node_tree.links.new(t.outputs["Color"], mat.bsdf_of(m).inputs["Emission Color"])
    return m


def sky_world(variant):
    """Environment from the art-directed sky map; the sun/moon disc is added for camera rays only."""
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    L = LOOK[variant]
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(OUT / f"sky_{variant}.exr"), check_existing=True)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = L["sky_strength"]
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    # disc: smoothstep on the angle to the light
    geom = nt.nodes.new("ShaderNodeTexCoord")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    el = dm.SKY_ELEVATION if variant == "day" else dm.SUN_ELEVATION
    dot.inputs[1].default_value = tuple(sky_mod.light_dir(el))
    nt.links.new(geom.outputs["Generated"], dot.inputs[0])
    r = math.radians(1.3 if variant == "day" else 1.1)
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = math.cos(r * 1.04)
    ramp.inputs["From Max"].default_value = math.cos(r * 0.96)
    ramp.interpolation_type = "SMOOTHSTEP"
    nt.links.new(dot.outputs["Value"], ramp.inputs["Value"])
    disc = nt.nodes.new("ShaderNodeEmission")
    disc.inputs["Color"].default_value = (*(lin("#fff1d6") if variant == "day" else lin("#f4f1ea")), 1)
    disc.inputs["Strength"].default_value = 60.0 if variant == "day" else 18.0
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(bg.outputs[0], add.inputs[0])
    mixd = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(ramp.outputs["Result"], mixd.inputs[0])
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Strength"].default_value = 0.0
    nt.links.new(black.outputs[0], mixd.inputs[1])
    nt.links.new(disc.outputs[0], mixd.inputs[2])
    nt.links.new(mixd.outputs[0], add.inputs[1])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(add.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(mix.outputs[0], out.inputs[0])
    return w


def sun_lamp(variant):
    L = LOOK[variant]
    d = Vector(dm.sun_dir())
    o = scene.sun_light("sun", strength=L["sun_strength"], color=L["sun"], angle_deg=0.6)
    o.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    return o


def stage(variant, terrain_mat=True):
    """Full scene for Cycles: terrain, skirt, slabs, props, world and light."""
    scene.reset()
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 64), bounces=4, res=(1920, 1200))
    sc.cycles.diffuse_bounces = 3
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - Base Contrast")
    terrain, far = load_terrain()
    sand = sand_material(variant)
    fogify(sand, variant)
    far_sand = sand_material(variant, with_normal=False)
    fogify(far_sand, variant)
    if terrain_mat:
        mat.assign(terrain, sand)
    mat.assign(far, far_sand)
    mats = slab_materials(variant)
    for m in mats.values():
        fogify(m, variant)
    panels = json.loads((PUB / "hi" / "panels.json").read_text())
    slabs = []
    for m in meta()["monoliths"]:
        root, parts = build_slab(m)
        body = mats[m["kind"]]
        trim = mats["dark"] if m["kind"] == "metal" else mats["gold"]
        mat.assign(parts["slab"], body)
        mat.assign(parts["bezel"], trim)
        mat.assign(parts["band"], trim)
        pm = panel_material(variant, m["product"], panels[m["product"]]["accent"])
        mat.assign(parts["panel"], pm)
        acc = lin(panels[m["product"]]["accent"])
        mat.assign(parts["line"], mat.emission(f"line_{m['id']}", acc, 12.0 if variant == "night" else 6.0))
        slabs += list(parts.values())
        if variant == "night":
            # Warm spill from the panel onto the sand in front of it.
            pw, ph, zc = panel_dims(m)
            fwd = root.matrix_world.to_3x3() @ Vector((1, 0, 0))
            c = root.matrix_world @ Vector((m["thickness"] / 2 + 0.3, 0, zc))
            li = scene.area_light(f"spill_{m['id']}", c, size=pw, size_y=ph, power=900, color=(1.0, 0.72, 0.45))
            li.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
    props = place_props()
    for p in props:
        for s in p.material_slots:
            if s.material:
                fogify(s.material, variant)
    sky_world(variant)
    sun_lamp(variant)
    return sc, terrain, far, slabs, props


# --------------------------------------------------------------------------
# Bake: sun visibility (shared) + diffuse irradiance per variant, planar UVs over the core.
def bake_image(name, size):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    return img


def attach_target(obj, img):
    for m in obj.data.materials:
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "bake"
        nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
        for n in nt.nodes:
            n.select = False
        tex.select = True
        nt.nodes.active = tex


def run_bake(obj, kind, samples, pass_filter=None):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.margin = 4
    for o in sc.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kw = {"type": kind, "margin": 4, "use_clear": True}
    if pass_filter:
        kw["pass_filter"] = pass_filter
    cli.log("bake", kind, samples, "spp")
    bpy.ops.object.bake(**kw)


def pixels(img):
    s = img.size[0]
    a = np.empty(s * s * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(s, s, 4)[..., :3]


def blur(a, sigma=0.9):
    r = int(math.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a.copy()
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None)] * a.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def step_bake():
    size = args.bake_size
    data = {}
    shadow = None
    for variant in args.variants:
        sc, terrain, far, slabs, props = stage(variant)
        sc.cycles.use_denoising = False
        if shadow is None:
            img = bake_image("shadow", size)
            attach_target(terrain, img)
            run_bake(terrain, "SHADOW", args.samples or (8 if args.preview else 24))
            shadow = blur(pixels(img)[..., 0], 0.7)
            bpy.data.images.remove(img)
        # Lighting only (no albedo): the runtime multiplies its own detailed sand color back in.
        img = bake_image(f"irr_{variant}", size)
        attach_target(terrain, img)
        run_bake(terrain, "DIFFUSE", args.samples or (16 if args.preview else 96), {"DIRECT", "INDIRECT"})
        irr = blur(pixels(img), 1.1)
        bpy.data.images.remove(img)
        scale = float(np.percentile(irr.max(-1), 99.7))
        enc = np.clip(irr / scale, 0, 1) ** (1 / 2.2)
        save_png(enc.astype(np.float32), OUT / f"light-{variant}.png")
        data[variant] = {"scale": round(scale, 5)}
        cli.log("irradiance", variant, "scale", round(scale, 4))
    n = np.load(OUT / "n4.npy").astype(np.float32)
    if n.shape[0] != size:
        idx = (np.arange(size) * n.shape[0] / size).astype(int)
        n = n[idx][:, idx]
    packed = np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, np.clip(shadow, 0, 1)], -1)
    save_png(packed.astype(np.float32), OUT / "terrain-data.png")
    mfile = OUT / "dunes_meta.json"
    mm = json.loads(mfile.read_text())
    mm.setdefault("light", {}).update(data)
    mfile.write_text(json.dumps(mm, separators=(",", ":")))


# --------------------------------------------------------------------------
# Camera rail
def build_camera():
    ss, pos, look, fov, roll = dm.flight(0.01)
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.1
    cam.data.clip_end = 30000
    keys = []
    for i in range(0, len(ss), 2):
        keys.append({"s": float(ss[i]), "pos": tuple(pos[i]), "look": tuple(look[i]), "fov": float(fov[i]), "roll": float(roll[i])})
    if (len(ss) - 1) % 2:
        i = len(ss) - 1
        keys.append({"s": float(ss[i]), "pos": tuple(pos[i]), "look": tuple(look[i]), "fov": float(fov[i]), "roll": float(roll[i])})
    rails.key(cam, keys)
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", dm.S_MAX)
    cli.log("rail written")


# --------------------------------------------------------------------------
# Stills
TAGS = [0.0, 0.4, 0.95, 1.4, 1.7, 2.12, 2.55, 2.95, 3.5, 4.1]


def setup_cam_at(s):
    cam = build_camera()
    rails.set_at(s)
    return cam


def step_preview():
    for variant in args.variants:
        sc, terrain, far, slabs, props = stage(variant)
        cam = setup_cam_at(0.0)
        sc.render.resolution_x, sc.render.resolution_y = (960, 600) if args.preview else (1920, 1200)
        for s in (float(v) for v in args.s.split(",")):
            rails.set_at(s)
            render.still(OUT / f"preview-{variant}-{s:.2f}.png")


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, terrain, far, slabs, props = stage(variant)
        cam = setup_cam_at(tags[0])
        for s in tags:
            rails.set_at(s)
            cpos = cam.matrix_world.translation.copy()

            def dist(o):
                return ((o.parent or o).matrix_world.translation - cpos).length

            near = [o for o in slabs + props if dist(o) < 300]
            ds = sorted(dist(o) for o in near)
            depth_mid = max(6.0, float(np.median(ds))) if ds else 30.0
            back = [terrain, far] + [o for o in slabs + props if o not in near]
            render.layers(cam, s, [("back", back), ("mid", near)], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 140.0, "mid": depth_mid})


def step_pano():
    """360 from just above the crest of the ridge east of the row, at sunset."""
    x = dm.cx(0, 2.0, 300.0)
    z = float(dm.height(np.array(x), np.array(300.0))) + 2.2
    for variant in args.variants:
        sc, terrain, far, slabs, props = stage(variant)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, (x, 300.0, z), res=(4096, 2048), samples=args.samples or 64, look_yaw_deg=0)
        cli.log("pano", variant, png)


def step_mini():
    """A crescent dune on a round plinth with a slab and its glowing panel (~1 unit tall)."""
    scene.reset()
    parts = []
    # Plinth
    base = geo.primitive("cylinder", "plinth", radius=0.62, depth=0.12, segments=64)
    base.location = (0, 0, 0.06)
    geo.bevel(base, width=0.015, segments=2)
    geo.apply_all(base)
    mat.assign(base, mat.principled("plinth", base=lin("#2a1c14"), rough=0.35, coat=0.6))
    parts.append(base)
    # Dune: a displaced disc shaped like a barchan.
    n = 64
    xs = np.linspace(-0.58, 0.58, n)
    X, Y = np.meshgrid(xs, xs)
    r = np.hypot(X, Y)
    u, v = X / 0.58, Y / 0.58
    q = np.clip(v, -1, 1)
    env = np.clip(1 - q * q, 0, 1) ** 0.8
    uc = 0.55 * q * q - 0.25
    d = u - uc
    stoss = np.clip(1 + d / 0.9, 0, 1) ** 1.4
    slip = np.clip(1 - d / 0.3, 0, 1)
    Hd = 0.3 * env * np.where(d < 0, stoss, slip) + 0.025 * (1 + dm.fbm(X * 6, Y * 6, 3))
    Hd *= np.clip((0.58 - r) / 0.08, 0, 1)
    dune = grid_mesh("dune", X, Y, Hd + 0.12)
    mask = r > 0.585
    bm = bmesh.new()
    bm.from_mesh(dune.data)
    bm.verts.ensure_lookup_table()
    kill = [bm.verts[i] for i in np.nonzero(mask.ravel())[0]]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(dune.data)
    bm.free()
    geo.smooth(dune, 180)
    mat.assign(dune, mat.principled("mini_sand", base=lin("#e0a263"), rough=0.85, sheen=0.4))
    parts.append(dune)
    # Slab
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for vtx in bm.verts:
        vtx.co = Vector((vtx.co.x * 0.07, vtx.co.y * 0.3, (vtx.co.z + 0.5) * 0.86 + 0.1))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.008, segments=2, affect="EDGES", profile=0.5)
    slab = geo.obj_from_bmesh("mini_slab", bm)
    geo.smooth(slab, 35)
    mat.assign(slab, mat.principled("mini_glass", base=(0.01, 0.01, 0.012), rough=0.05, coat=1.0))
    panel = geo.primitive("grid", "mini_panel", x=1, y=1, size=1.0)
    panel.data.transform(Matrix.Scale(0.23, 4, (1, 0, 0)) @ Matrix.Scale(0.41, 4, (0, 1, 0)))
    panel.rotation_euler = (math.radians(90), 0, math.radians(90))
    panel.location = (0.0355, 0, 0.62)
    geo.set_origin_world(panel)
    mat.assign(panel, mat.emission("mini_panel", lin("#ffb870"), 3.0))
    ring = ring_mesh("mini_bezel", [(y, z + 0.62) for y, z in rounded_rect(0.25, 0.43, 0.02)], [(y, z + 0.62) for y, z in rounded_rect(0.232, 0.412, 0.01)], 0.006, 0.035)
    mat.assign(ring, mat.principled("mini_gold", base=(1.0, 0.74, 0.42), metal=1.0, rough=0.2))
    for o in (slab, panel, ring):
        o.matrix_world = Matrix.Translation((0.05, 0.08, 0.0)) @ Matrix.Rotation(math.radians(200), 4, "Z") @ o.matrix_world
        geo.set_origin_world(o)
    parts += [slab, panel, ring]
    o = geo.join(parts, "mini_dunes")
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 2) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "terrain": step_terrain,
    "meta": step_meta,
    "sky": step_sky,
    "monoliths": step_monoliths,
    "props": step_props,
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
