"""The greenhouse: a Victorian glass conservatory at sunrise (Sites page).

Steps (run with --steps a,b,...):
  bake      static architecture -> joined + unwrapped once, baked day and night
            (iron + masonry diffuse GI atlases, floor irradiance lightmap),
            exported as arch.glb (geometry only) + lightmap PNGs
  live      plants, lanterns -> live.glb (live-lit in three.js)
  rail      camera rail -> rails.json
  meta      greenhouse.json: sun/moon, light shafts, bulbs, flames, panels
  sky       world-only equirects (backdrop) + interior env maps for reflections
  preview   quick Cycles still at --s
  layers    Low Resources depth layers + posters (day/night)
  pano      4096x2048 equirect from under the dome
  mini      a tiny glass greenhouse on a plinth for the homepage diorama
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

import gh_mat as gm  # noqa: E402
import gh_model as model  # noqa: E402
import gh_plants as plants  # noqa: E402
import oidn  # noqa: E402
from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402
from ddd.cli import CACHE  # noqa: E402
from mesh import MeshBuilder, pack_atlas  # noqa: E402

SCENE_ID = "greenhouse"
V = Vector


def extra_args(p):
    p.add_argument("--s", type=float, default=0.0)
    p.add_argument("--tags", default="")
    p.add_argument("--res", type=float, default=0.5)
    p.add_argument("--no-volume", action="store_true")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
HDRI = CACHE / "polyhaven" / "hdri"
S_MAX = 4.9  # tour uses [0, 4.2]; [4.4, 4.9] is the parked bench view
PARKED_S = 4.6
COVERS = ["/work/vtcc-redesign/cover.png", "/work/wunderful-life/cover.png"]
REPO = HERE.parents[2]


def to_three(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


# --------------------------------------------------------------------------
# Sky: Poly Haven HDRIs, rotated so the sun/moon sits where the story wants it.
# Sun: ahead and to the right when looking down the nave (+Y), 15 degrees up.
SKY = {
    "day": {"file": "spruit_sunrise/spruit_sunrise_4k.hdr", "az": math.radians(62), "elev": math.radians(15.0), "strength": 0.6, "sun": 1.1, "clamp": 40.0},
    "night": {"file": "moonlit_golf/moonlit_golf_4k.hdr", "az": math.radians(70), "elev": None, "strength": 0.22, "sun": 0.35, "clamp": 12.0},
}
_sky_info = {}


def sky_info(variant):
    """Brightest disc in the HDRI: its direction, color, and irradiance (for the matching lamp)."""
    if variant in _sky_info:
        return _sky_info[variant]
    cfg = SKY[variant]
    img = bpy.data.images.load(str(HDRI / cfg["file"]), check_existing=True)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    lum = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    elev0 = ((y + 0.5) / h - 0.5) * math.pi
    az0 = -((x + 0.5) / w - 0.5) * 2 * math.pi
    mask = lum > cfg["clamp"]
    rows = np.arange(h)[:, None].repeat(w, 1)
    d_omega = (2 * math.pi / w) * (math.pi / h) * np.cos(((rows + 0.5) / h - 0.5) * math.pi)
    rad = (px - cfg["clamp"]).clip(0) * mask[..., None]
    irr = (rad * d_omega[..., None]).sum((0, 1))
    elev1 = cfg["elev"] if cfg["elev"] is not None else elev0
    az1 = cfg["az"]
    M = Matrix.Rotation(az0, 3, "Z") @ Matrix.Rotation(elev1 - elev0, 3, "Y") @ Matrix.Rotation(-az1, 3, "Z")
    d1 = V((math.cos(az1) * math.cos(elev1), math.sin(az1) * math.cos(elev1), math.sin(elev1)))
    strength = float(irr.max()) * cfg["sun"]
    color = tuple(float(c) / float(irr.max()) for c in irr)
    info = {"M": M, "dir": d1, "strength": strength, "color": color, "elev0": math.degrees(elev0), "az0": math.degrees(az0)}
    cli.log("sky", variant, "disc", f"az {info['az0']:.1f} el {info['elev0']:.1f}", "irradiance", round(strength, 2), "color", [round(c, 3) for c in color])
    _sky_info[variant] = info
    return info


def world(variant, camera_gain=1.0):
    cfg = SKY[variant]
    info = sky_info(variant)
    w = bpy.data.worlds.new(f"World_{variant}")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = info["M"].to_euler("XYZ")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(HDRI / cfg["file"]), check_existing=True)
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    # Lighting rays see the HDRI with its sun clamped away (the sun lamp replaces it).
    clamp = nt.nodes.new("ShaderNodeMix")
    clamp.data_type = "RGBA"
    clamp.blend_type = "DARKEN"
    clamp.inputs[0].default_value = 1.0
    clamp.inputs[7].default_value = (cfg["clamp"], cfg["clamp"], cfg["clamp"], 1)
    nt.links.new(env.outputs["Color"], clamp.inputs[6])
    bg_light = nt.nodes.new("ShaderNodeBackground")
    bg_light.inputs["Strength"].default_value = cfg["strength"]
    nt.links.new(clamp.outputs[2], bg_light.inputs["Color"])
    bg_cam = nt.nodes.new("ShaderNodeBackground")
    bg_cam.inputs["Strength"].default_value = cfg["strength"] * camera_gain
    nt.links.new(env.outputs["Color"], bg_cam.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg_light.outputs[0], mix.inputs[1])
    nt.links.new(bg_cam.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    # Matching sun / moon lamp.
    d = info["dir"]
    ld = bpy.data.lights.new("sun" if variant == "day" else "moon", "SUN")
    ld.energy = info["strength"]
    ld.color = info["color"] if variant == "day" else (0.72, 0.82, 1.0)
    ld.angle = math.radians(0.8 if variant == "day" else 1.2)
    o = bpy.data.objects.new(ld.name, ld)
    o.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(o)
    return w, o


def night_lights(P, lantern_mats):
    """Fairy lights on the ribs and lantern flames (point lights; emissive geometry comes with the meshes)."""
    lights = []
    for i, (p, sid) in enumerate(P.bulbs):
        ld = bpy.data.lights.new(f"bulb{i}", "POINT")
        ld.energy = 0.45
        ld.shadow_soft_size = 0.015
        ld.color = (1.0, 0.7, 0.38)
        o = bpy.data.objects.new(ld.name, ld)
        o.location = p
        bpy.context.scene.collection.objects.link(o)
        lights.append(o)
    for name, m in lantern_mats:
        ld = bpy.data.lights.new("flame", "POINT")
        ld.energy = 14.0
        ld.shadow_soft_size = 0.02
        ld.color = (1.0, 0.62, 0.3)
        o = bpy.data.objects.new("flame", ld)
        o.location = m @ V((0, 0, 0.12))
        bpy.context.scene.collection.objects.link(o)
        lights.append(o)
    return lights


# --------------------------------------------------------------------------
# Camera rail (Blender coordinates). s = chapter time.
KEYS = [
    # s, pos, look, fov
    (0.00, (0.55, -21.25, 1.5), (-2.3, -8.0, 3.0), 52),
    (0.50, (0.35, -19.7, 1.7), (-2.0, -7.0, 3.3), 50),
    (1.00, (-0.15, -17.9, 1.5), (1.5, -8.0, 1.9), 48),
    (1.35, (0.25, -15.4, 1.62), (-1.0, -5.0, 2.3), 48),
    (1.70, (-0.3, -12.6, 1.85), (1.4, -3.0, 2.6), 48),
    (2.00, (0.25, -9.7, 2.1), (-0.6, 0.0, 3.6), 50),
    (2.30, (0.6, -6.8, 2.7), (-0.9, 1.0, 6.6), 52),
    (2.65, (1.4, -4.2, 4.8), (-0.6, 1.5, 11.0), 54),
    (3.00, (1.6, -2.5, 7.4), (-0.8, 1.2, 14.0), 56),
    (3.35, (0.6, -2.0, 8.6), (2.6, 5.5, 11.2), 50),
    (3.70, (-0.5, -2.8, 9.3), (2.5, 7.4, 10.0), 46),
    (4.20, (-1.4, -3.6, 9.4), (2.3, 7.6, 8.9), 44),
    # Parked: a bench under the dome.
    (4.45, (1.0, -2.4, 1.5), (5.0, 1.25, 0.95), 42),
    (4.90, (1.35, -2.0, 1.45), (5.0, 1.45, 0.9), 42),
]


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 400
    rails.key(cam, [{"s": s, "pos": p, "look": look, "fov": fov} for s, p, look, fov in KEYS])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written", S_MAX)


# --------------------------------------------------------------------------
# Scene assembly
MATS = {}


def materials(variant):
    MATS.clear()
    MATS.update(
        iron=[gm.iron_paint(), gm.gilt(), gm.metal("wire", "#2b2a24", 0.5)],
        masonry=[gm.brick(), gm.stone(), gm.soil(), gm.wood(), gm.terracotta(), gm.moss()],
        glass=[gm.glass()],
        floor=[gm.floor_tiles()],
        leaf=gm.leaf("leaf", True),
        stem=gm.leaf("stem", True, translucency=0.1, rough=0.6),
        trunk=gm.bark(),
        bulb=gm.bulb(variant),
    )
    return MATS


SMOOTH = {"iron": 80, "wire": 180}


def build_static(variant, pack=None):
    """Architecture objects by (group, chunk). Returns (P, {group: [objs]}, objs by chunk, foliage builders).

    pack = {group: atlas px} shelf-packs those groups' lightmap UVs first (P.density: texels per meter).
    """
    P = model.build_all()
    fol = plants.build_foliage(P)
    materials(variant)
    MATS["wire"] = MATS["iron"]
    P.density = {}
    for key, size in (pack or {}).items():
        builders = [mb for (g, _), mb in sorted(P.mb.items()) if g == key and mb.f]
        P.density[key] = pack_atlas(builders, size, margin=2)
        cli.log("atlas", key, f"{size}px", f"{P.density[key]:.1f} texels/m", pack_atlas.last["islands"], "islands", f"content {pack_atlas.last['fill'] * 100:.0f}%")
    groups = {"iron": [], "masonry": [], "glass": [], "floor": [], "wire": []}
    chunks = {}
    for (group, chunk), mb in sorted(P.mb.items()):
        if not mb.f:
            continue
        o = mb.build(f"{group}_{chunk}", MATS[group], color_attr=(group == "glass"), smooth_angle=SMOOTH.get(group))
        groups[group].append(o)
        chunks.setdefault(chunk, []).append(o)
    if variant is not None:
        bulb_mb = MeshBuilder()
        for p, _ in P.bulbs:
            bulb_mb.sphere(p, 0.018, 8, 6)
        bo = bulb_mb.build("bulbs", [MATS["bulb"]], smooth_angle=180)
        groups["bulbs"] = [bo]
    return P, groups, chunks, fol


def build_foliage_objects(fol):
    objs = []
    for name, mb in fol.items():
        mats = [MATS["leaf"], MATS["stem"], MATS["trunk"]]
        o = mb.build(f"foliage_{name}", mats, color_attr=True, smooth_angle=60)
        objs.append(o)
    return objs


def floor_uv(o, bounds):
    x0, y0, x1, y1 = bounds
    me = o.data
    uv = me.uv_layers.new(name="bake")
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    loops = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loops)
    u = (co[loops, 0] - x0) / (x1 - x0)
    v = (co[loops, 1] - y0) / (y1 - y0)
    uv.data.foreach_set("uv", np.stack([u, v], 1).ravel())
    return uv


FLOOR_LM = (1024, 2048)
ATLAS = {"iron": 2048, "masonry": 2048}
LM_JSON = "lightmaps.json"


def _bake_target(obj, uv_name, img):
    nodes = []
    for m in obj.data.materials:
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
        nodes.append((nt, tex, uvn))
    return nodes


def _bake(obj, uv_name, size, samples, margin, **kw):
    """One Cycles bake of `obj` into a new float image; returns pixels as (H, W, 3) float32."""
    sc = bpy.context.scene
    w, h = size
    img = bpy.data.images.new(f"{obj.name}_{kw['type']}", w, h, alpha=False, float_buffer=True)
    nodes = _bake_target(obj, uv_name, img)
    sc.cycles.samples = samples
    sc.render.bake.margin = margin
    for o in sc.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(margin=margin, use_clear=True, **kw)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3].copy()
    for nt, tex, uvn in nodes:
        nt.nodes.remove(tex)
        nt.nodes.remove(uvn)
    bpy.data.images.remove(img)
    return px


def _save(px, path, target=0.9, pct=99.7, lo=-4.0, hi=2.0):
    """8-bit sRGB PNG with an exposure (power of two, quarter stops) that keeps the bright end."""
    lum = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lit = lum[lum > 1e-5]
    top = float(np.percentile(lit, pct)) if lit.size else 1.0
    exposure = float(np.clip(math.floor(math.log2(target / max(top, 1e-6)) * 4) / 4, lo, hi))
    h, w = px.shape[:2]
    img = bpy.data.images.new(path.stem, w, h, alpha=False, float_buffer=True)
    rgba = np.concatenate([px, np.ones((h, w, 1), np.float32)], -1)
    img.pixels.foreach_set(rgba.ravel())
    bake.save_srgb(img, path, exposure=exposure)
    bpy.data.images.remove(img)
    cli.log("lightmap", path.name, f"p{pct} {top:.3f}", "exposure", exposure)
    return exposure


def bake_gi(obj, uv_name, path, size, samples, aux):
    """Diffuse GI with albedo (ddd.bake.bake_group's pass) into a shared atlas UV, denoised."""
    cli.log("baking GI", obj.name, size, samples)
    col = _bake(obj, uv_name, size, samples, 16, type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"})
    col = oidn.denoise(col, aux["albedo"], aux["normal"])
    return _save(np.maximum(col, 0), path)


def bake_irradiance(obj, uv_name, path, size, samples):
    """Lighting-only (no albedo) bake: the runtime multiplies its own tiled floor texture."""
    cli.log("baking irradiance", obj.name, size, samples)
    irr = _bake(obj, uv_name, size, samples, 8, type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    irr = oidn.denoise(irr, np.ones_like(irr))
    return _save(np.maximum(irr, 0), path)


def bake_aux(obj, uv_name, size):
    albedo = _bake(obj, uv_name, size, 4, 16, type="DIFFUSE", pass_filter={"COLOR"})
    normal = _bake(obj, uv_name, size, 1, 16, type="NORMAL", normal_space="OBJECT")
    return {"albedo": np.clip(albedo, 0, 1), "normal": normal * 2.0 - 1.0}


def lights_for(variant, P, lantern_inst):
    for o in [o for o in bpy.context.scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    world(variant)
    if variant == "night":
        night_lights(P, lantern_inst)


def _one_slot(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    o.data.polygons.foreach_set("material_index", np.zeros(len(o.data.polygons), dtype=np.int32))


def step_bake():
    scene.reset()
    plants.reset()
    scene.cycles(samples=64, bounces=6, res=(1920, 1200))
    size = 1024 if args.preview else 2048
    P, groups, chunks, fol = build_static("day", pack={k: (size if args.preview else v) for k, v in ATLAS.items()})
    inst, lanterns = plants.place_scans(P)
    # Plants cast shadows and bounce light into the bake but are not part of it.
    live = plants.link_instances(inst) + build_foliage_objects(fol) + plants.link_instances(lanterns)
    for g in groups["glass"]:
        g.visible_shadow = True
    joined = {}
    for key in ("iron", "masonry", "glass", "wire"):
        objs = groups[key]
        joined[key] = geo.join(objs, key) if len(objs) > 1 else objs[0]
        joined[key].name = key
    floor = groups["floor"][0]
    floor.name = "floor"
    uvf = floor_uv(floor, P.floor_bounds)
    # Metals bake black in a diffuse pass: gilt bakes as diffuse gold, and gets its sheen back at runtime.
    iron_mats = joined["iron"].data.materials
    for i, m in enumerate(iron_mats):
        if m is not None and m.name.startswith("gilt"):
            iron_mats[i] = mat.principled("gilt_bake", base=gm.lin("#d2a864"), rough=0.5)
    lm = OUT / "lightmaps"
    lm.mkdir(parents=True, exist_ok=True)
    samples = args.samples or (32 if args.preview else 96)
    floor_size = FLOOR_LM if not args.preview else (512, 1024)
    aux = {k: bake_aux(joined[k], "bake", (size, size)) for k in ("iron", "masonry")}
    info_path = lm / LM_JSON
    info = json.loads(info_path.read_text()) if info_path.exists() else {}
    for variant in args.variants:
        lights_for(variant, P, lanterns)
        b = mat.bsdf_of(MATS["bulb"])
        b.inputs["Emission Color"].default_value = (*gm.lin("#ffc27a"), 1)
        b.inputs["Emission Strength"].default_value = 40.0 if variant == "night" else 0.0
        info[variant] = {
            "iron": bake_gi(joined["iron"], "bake", lm / f"iron-{variant}.png", (size, size), samples, aux["iron"]),
            "masonry": bake_gi(joined["masonry"], "bake", lm / f"masonry-{variant}.png", (size, size), samples, aux["masonry"]),
            "floor": bake_irradiance(floor, uvf.name, lm / f"floor-{variant}.png", floor_size, samples),
        }
        info_path.write_text(json.dumps(info, indent=1))
        _write_lm_meta(info)
    # Export geometry only: runtime materials read the lightmaps (and find parts by material name).
    rt = {"lm_paint": mat.principled("lm_paint", base=(1, 1, 1), rough=0.4), "lm_gilt": mat.principled("lm_gilt", base=(1, 1, 1), rough=0.3)}
    for i, m in enumerate(joined["iron"].data.materials):
        iron_mats[i] = rt["lm_gilt" if m is not None and m.name.startswith("gilt") else "lm_paint"]
    _one_slot(joined["masonry"], mat.principled("lm_masonry", base=(1, 1, 1), rough=0.8))
    _one_slot(joined["wire"], mat.principled("rt_wire", base=(0.02, 0.02, 0.02), rough=0.5))
    _one_slot(joined["glass"], mat.principled("rt_glass", base=(1, 1, 1), rough=0.05))
    _one_slot(floor, mat.principled("rt_floor", base=(1, 1, 1), rough=0.5))
    for key, o in (*joined.items(), ("floor", floor)):
        keep = {"bake"} if key in ("iron", "masonry") else set()
        for layer in list(o.data.uv_layers):
            if layer.name not in keep:
                o.data.uv_layers.remove(layer)
        if key == "glass":
            o.data.color_attributes.active_color = o.data.color_attributes["Col"]
        else:
            for ca in list(o.data.color_attributes):
                o.data.color_attributes.remove(ca)
    for o in live:
        o.hide_set(True)
    export.glb(OUT / "arch.glb", [joined["iron"], joined["masonry"], joined["glass"], joined["wire"], floor], export_vertex_color="ACTIVE")
    for key, o in (*joined.items(), ("floor", floor)):
        cli.log("arch", key, geo.triangle_count(o), "tris", len(o.data.vertices), "verts")


def _write_lm_meta(info):
    """Lightmap exposures go into greenhouse.json (the meta step keeps them)."""
    path = PUB / "hi" / "greenhouse.json"
    if not path.exists():
        return
    meta = json.loads(path.read_text())
    meta["lm"] = {v: info[v] for v in ("day", "night") if v in info}
    path.write_text(json.dumps(meta, separators=(",", ":")))


# --------------------------------------------------------------------------
def pack_rgba(diff_path, alpha_path, out_path):
    d = bpy.data.images.load(str(diff_path), check_existing=True)
    a = bpy.data.images.load(str(alpha_path), check_existing=True)
    w, h = d.size
    dp = np.array(d.pixels[:], dtype=np.float32).reshape(h, w, 4)
    ap = np.array(a.pixels[:], dtype=np.float32).reshape(a.size[1], a.size[0], 4)
    if ap.shape[:2] != dp.shape[:2]:
        raise RuntimeError(f"alpha size mismatch {alpha_path}")
    dp[..., 3] = ap[..., 0]
    img = bpy.data.images.new(out_path.stem, w, h, alpha=True)
    img.pixels[:] = dp.ravel()
    img.filepath_raw = str(out_path)
    img.file_format = "PNG"
    img.save()
    return img


SMALL_TEX = ("Lantern", "_pot", "bark")  # small on screen: 512 px is plenty


def runtime_material(src_mat, tex_dir):
    """Principled with a packed RGBA base color (alpha mask) for glTF, from a Poly Haven material."""
    img = _runtime_material(src_mat, tex_dir)
    t = next((n for n in img.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if t is not None and t.image is not None and any(k in src_mat.name for k in SMALL_TEX) and t.image.size[0] > 512:
        small = t.image.copy()
        small.scale(512, 512)
        path = tex_dir / f"{src_mat.name}_512.png"
        small.filepath_raw = str(path)
        small.file_format = "PNG"
        small.save()
        t.image = bpy.data.images.load(str(path))
    return img


def _runtime_material(src_mat, tex_dir):
    nt = src_mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    diff = alpha = None
    if bsdf:
        for sock, key in (("Base Color", "diff"), ("Alpha", "alpha")):
            link = bsdf.inputs[sock].links[0] if bsdf.inputs[sock].links else None
            node = link.from_node if link else None
            while node is not None and node.type != "TEX_IMAGE" and node.inputs and node.inputs[0].links:
                node = node.inputs[0].links[0].from_node
            if node is not None and node.type == "TEX_IMAGE":
                if key == "diff":
                    diff = node.image
                else:
                    alpha = node.image
    m = bpy.data.materials.new(f"{src_mat.name}_rt")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    b = mat.bsdf_of(m)
    b.inputs["Roughness"].default_value = 0.55
    if diff is not None:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        if alpha is not None:
            out = tex_dir / f"{src_mat.name}_rgba.png"
            t.image = pack_rgba(pathlib.Path(bpy.path.abspath(diff.filepath)), pathlib.Path(bpy.path.abspath(alpha.filepath)), out)
            m.node_tree.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
            if hasattr(m, "blend_method"):
                m.blend_method = "CLIP"
        else:
            t.image = diff
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    return m


def step_live():
    scene.reset()
    plants.reset()
    P = model.build_all()
    fol = plants.build_foliage(P)
    materials("day")
    inst, lanterns = plants.place_scans(P)
    src = plants.load_scans()
    tex_dir = OUT / "tex"
    tex_dir.mkdir(parents=True, exist_ok=True)
    # Swap every scan material for a glTF-friendly one (shared across instances).
    swapped = {}
    for me in src.values():
        for i, m in enumerate(me.materials):
            if m is None:
                continue
            if m.name not in swapped:
                swapped[m.name] = runtime_material(m, tex_dir)
            me.materials[i] = swapped[m.name]
    objs = plants.link_instances(inst) + plants.link_instances(lanterns)
    for o in objs:
        export.tag(o, kind="lantern" if o.name.startswith("Lantern") else "scan")
    rt_leaf = mat.principled("foliage", base=(1, 1, 1), rough=0.5)
    rt_trunk = mat.principled("trunk", base=gm.lin("#6e5a40"), rough=0.85)
    for name, mb in fol.items():
        o = mb.build(f"foliage_{name}", [rt_leaf, rt_leaf, rt_trunk], color_attr=True, smooth_angle=60)
        export.tag(o, kind="foliage")
        objs.append(o)
    export.glb(OUT / "live.glb", objs, export_vertex_color="ACTIVE")
    tris = sum(geo.triangle_count(o) for o in objs if not o.name.startswith(("Lantern",)))
    cli.log("live objects", len(objs), "tris (with instances)", tris)


# --------------------------------------------------------------------------
PANELS = [
    # pos (Blender), facing direction, width, cover index
    ((1.95, -16.0, 2.35), (-0.55, -1.0), 1.2, 0),
    ((-2.0, -13.4, 2.7), (0.55, -1.0), 1.05, 1),
    ((2.0, -10.9, 2.45), (-0.55, -1.0), 1.3, 1),
    ((2.9, -2.4, 4.4), (-0.6, -1.0), 1.35, 0),
    ((-2.4, 0.3, 6.7), (0.5, -1.0), 1.2, 1),
]


def trace_beams(dir_to_light, glass, n_samples=5000, seed=3, max_beams=28, min_sep=0.9):
    """Find real light shafts: points lit through the glass, traced back to the pane and forward to where they land."""
    rng = np.random.default_rng(seed)
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    L = V(dir_to_light).normalized()
    glass_names = {g.name for g in glass}

    def cast(o, d, skip_glass):
        o = V(o)
        for _ in range(8):
            hit, loc, _, _, ob, _ = sc.ray_cast(dg, o, d)
            if not hit:
                return None, None
            if skip_glass and ob.name in glass_names:
                o = loc + d * 0.01
                continue
            return loc, ob
        return None, None

    beams = []
    for _ in range(n_samples):
        if rng.random() < 0.6:
            p = V((rng.uniform(-3.5, 3.5), rng.uniform(-21.5, -6.5), rng.uniform(0.8, 6.0)))
        else:
            r, a = 6.3 * math.sqrt(rng.random()), rng.uniform(0, math.tau)
            p = V((r * math.cos(a), r * math.sin(a), rng.uniform(1.0, 11.0)))
        loc, ob = cast(p, L, False)
        if loc is None or ob.name not in glass_names:
            continue
        start = loc
        end, _ = cast(p, -L, True)
        if end is None:
            continue
        axis = end - start
        if axis.length < 2.0:
            continue
        mid = (start + end) / 2
        if any((mid - (b[0] + b[1]) / 2).length < min_sep * 3 and abs((b[1] - b[0]).normalized().dot(axis.normalized())) > 0.99 and _line_dist(b[0], b[1], mid) < min_sep for b in beams):
            continue
        beams.append((start, end))
        if len(beams) >= max_beams:
            break
    return beams


def _line_dist(a, b, p):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def step_meta():
    scene.reset()
    plants.reset()
    P, groups, chunks, fol = build_static("day")
    inst, lanterns = plants.place_scans(P)
    plants.link_instances(inst)
    build_foliage_objects(fol)
    meta = {"floor": {"bounds": [round(x, 4) for x in P.floor_bounds], "lm": list(FLOOR_LM)}}
    prev_path = PUB / "hi" / "greenhouse.json"
    prev = json.loads(prev_path.read_text()) if prev_path.exists() else {}
    for key in ("lm", "sunvis"):
        if key in prev:
            meta[key] = prev[key]
    lm_info = OUT / "lightmaps" / LM_JSON
    if lm_info.exists():
        info = json.loads(lm_info.read_text())
        meta["lm"] = {v: info[v] for v in ("day", "night") if v in info}
    for variant in ("day", "night"):
        info = sky_info(variant)
        meta[variant] = {"lightDir": to_three(info["dir"]), "strength": round(info["strength"], 3), "color": [round(c, 4) for c in info["color"]]}
    for variant, n in (("day", 30), ("night", 14)):
        d = sky_info(variant)["dir"]
        beams = trace_beams(d, groups["glass"], max_beams=n)
        meta[variant]["beams"] = [{"a": to_three(a), "b": to_three(b)} for a, b in beams]
        cli.log("beams", variant, len(beams))
    meta["bulbs"] = [to_three(p) for p, _ in P.bulbs]
    meta["flames"] = [to_three(m @ V((0, 0, 0.12))) for _, m in lanterns]
    meta["panels"] = []
    for pos, face, width, cover in PANELS:
        yaw = math.atan2(face[0], -face[1])
        meta["panels"].append({"p": to_three(pos), "yaw": round(yaw, 4), "w": width, "cover": COVERS[cover]})
    meta["parked"] = {"s": PARKED_S, "panel": {"p": to_three((5.02, 0.05, 0.9))}}
    (PUB / "hi").mkdir(parents=True, exist_ok=True)
    (PUB / "hi" / "greenhouse.json").write_text(json.dumps(meta, separators=(",", ":")))
    cli.log("meta written", len(meta["bulbs"]), "bulbs", len(meta["flames"]), "flames")


# --------------------------------------------------------------------------
def panel_objects(variant):
    objs = []
    for i, (pos, face, width, cover) in enumerate(PANELS):
        img_path = REPO / "public" / COVERS[cover].lstrip("/")
        img = bpy.data.images.load(str(img_path), check_existing=True)
        aspect = img.size[1] / img.size[0]
        h = width * aspect
        yaw = math.atan2(face[0], -face[1])
        rot = Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "X")
        m = Matrix.Translation(V(pos)) @ rot
        mb = MeshBuilder()
        bar_h = width * 0.05
        mb.box((0, (h + bar_h) / 2 - h / 2 + 0.0, -0.012), (width * 1.04, h + bar_h + width * 0.04, 0.02))
        frame = mb.build(f"panel{i}_frame", [gm.frosted("frost", "#f4fbff" if variant == "day" else "#9fb6ff")])
        frame.matrix_world = m @ Matrix.Translation(V((0, bar_h / 2, 0)))
        screen = geo.primitive("grid", f"panel{i}_screen", x=1, y=1, size=0.5)
        screen.data.transform(Matrix.Diagonal((width, h, 1, 1)))
        me = screen.data
        uv = me.uv_layers.new(name="UVMap")
        for loop in me.loops:
            co = me.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (co.x / width + 0.5, co.y / h + 0.5)
        mat.assign(screen, gm.emission_image(f"cover{cover}", img_path, 1.4 if variant == "day" else 1.8))
        screen.matrix_world = m
        bar = geo.primitive("grid", f"panel{i}_bar", x=1, y=1, size=0.5)
        bar.data.transform(Matrix.Diagonal((width, bar_h, 1, 1)))
        mat.assign(bar, gm.emission("chrome", "#f6f3ee" if variant == "day" else "#1d2233", 1.2))
        bar.matrix_world = m @ Matrix.Translation(V((0, h / 2 + bar_h / 2, 0.001)))
        dots = MeshBuilder()
        for k, c in enumerate(("#ff6159", "#ffbd2e", "#28c941")):
            dots.sphere((-width / 2 + bar_h * (0.8 + k * 0.7), 0, 0.004), bar_h * 0.18, 10, 6, mat=k)
        do = dots.build(f"panel{i}_dots", [gm.emission(f"dot{k}", c, 2.0) for k, c in enumerate(("#ff6159", "#ffbd2e", "#28c941"))])
        do.matrix_world = m @ Matrix.Translation(V((0, h / 2 + bar_h / 2, 0.002)))
        objs += [frame, screen, bar, do]
    return objs


def volume_box(variant):
    o = geo.primitive("cube", "haze", size=1.0)
    o.scale = (16, 32, 17)
    o.location = (0, -8, 8.3)
    m = bpy.data.materials.new("haze")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Density"].default_value = 0.011 if variant == "day" else 0.007
    pv.inputs["Anisotropy"].default_value = 0.7
    pv.inputs["Color"].default_value = (*gm.lin("#fff2e0" if variant == "day" else "#c6d4ff"), 1)
    nt.links.new(pv.outputs[0], out.inputs["Volume"])
    mat.assign(o, m)
    return o


def stage(s, variant, volume=True):
    scene.reset()
    plants.reset()
    samples = args.samples or (32 if args.preview else 72)
    sc = scene.cycles(samples=samples, bounces=6, res=(1920, 1200))
    sc.cycles.volume_bounces = 1
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - Base Contrast", exposure=0.0 if variant == "day" else 0.4)
    P, groups, chunks, fol = build_static(variant)
    inst, lanterns = plants.place_scans(P)
    scans = plants.link_instances(inst)
    lant = plants.link_instances(lanterns)
    folo = build_foliage_objects(fol)
    for g in groups["glass"]:
        g.visible_shadow = True
    lights_for(variant, P, lanterns)
    if variant == "night":
        for o in lant:
            fl = MeshBuilder()
            fl.sphere((0, 0, 0.075), 0.012, 8, 6)
            fo = fl.build("flame_geo", [gm.flame()])
            fo.matrix_world = o.matrix_world
            folo.append(fo)
    cam = build_camera()
    rails.set_at(s)
    pan = panel_objects(variant)
    haze = volume_box(variant) if volume and not args.no_volume else None
    return sc, cam, {"P": P, "groups": groups, "chunks": chunks, "scans": scans, "lanterns": lant, "foliage": folo, "panels": pan, "haze": haze}


def step_preview():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else [args.s]
    for variant in args.variants:
        for s in tags:
            sc, cam, st = stage(s, variant)
            sc.render.resolution_x, sc.render.resolution_y = int(1920 * args.res), int(1200 * args.res)
            path = OUT / f"preview-{variant}-{s:.2f}.png"
            render.still(path)
            cli.log("preview", path)


TAGS = [0.0, 0.6, 1.25, 1.75, 2.2, 2.7, 3.2, 3.7, 4.15]


def split_bands(cam, st, near_dist):
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ V((0, 0, -1))).normalized()
    back, front = [], []

    def depth(o):
        corners = [o.matrix_world @ V(c) for c in o.bound_box]
        # Nearest corner depth, so anything reaching close to the lens goes to the front band.
        return min((c - cpos).dot(fwd) for c in corners), max((c - cpos).length for c in corners)

    candidates = st["scans"] + st["lanterns"] + st["foliage"] + st["panels"]
    for g in ("iron", "masonry", "glass"):
        candidates += st["groups"][g]
    for o in candidates:
        dmin, dmax = depth(o)
        (front if dmax < near_dist * 2.2 and dmin < near_dist else back).append(o)
    back += st["groups"]["floor"] + st["groups"]["wire"] + st["groups"].get("bulbs", [])
    if st["haze"] is not None:
        back.append(st["haze"])
    return back, front


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        for s in tags:
            sc, cam, st = stage(s, variant)
            rails.set_at(s)
            back, front = split_bands(cam, st, 3.2)
            render.layers(cam, s, [("back", back), ("front", front)], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 9.0, "front": 2.6})


def step_pano():
    for variant in args.variants:
        sc, cam, st = stage(2.0, variant)
        loc = V((0.0, -3.4, 1.75))
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, loc, res=(4096, 2048) if not args.preview else (1024, 512), samples=args.samples or 64, look_yaw_deg=90)
        cli.log("pano", variant, png)


def step_sky():
    """World-only backdrop (seen through the glass) and a blurred interior env for reflections."""
    for variant in args.variants:
        scene.reset()
        scene.cycles(samples=16, bounces=2, res=(2048, 1024))
        scene.view("Standard", exposure=0.0 if variant == "day" else 0.0)
        world(variant)
        png = OUT / f"sky-{variant}.png"
        render.panorama(png, (0, 0, 2), res=(2048, 1024), samples=16, look_yaw_deg=0)
        cli.log("sky", variant, png)
        sc, cam, st = stage(2.0, variant, volume=False)
        scene.view("Standard", exposure=0.0)
        png = OUT / f"env-{variant}.png"
        render.panorama(png, V((0.0, -8.0, 3.0)), res=(1024, 512), samples=args.samples or 48, look_yaw_deg=0)
        cli.log("env", variant, png)


def step_mini():
    """A tiny glass greenhouse on a stone plinth (~1 unit tall)."""
    scene.reset()
    materials("day")
    s = 0.075
    iron = MeshBuilder()
    glass = MeshBuilder()
    base = MeshBuilder()
    base.lathe([(0.62, 0.0), (0.62, 0.05), (0.58, 0.07), (0.58, 0.1), (0.001, 0.1)], (0, 0, 0), 48, 1)
    hw, y0, y1 = model.NAVE_HW * s, -4.4 * s, 4.4 * s
    for y in [y0 + (y1 - y0) * k / 4 for k in range(5)]:
        a_l, a_r = model.vault_angles()
        pts = [V((model.VR * s * math.cos(a_l + (a_r - a_l) * i / 16), y, 0.1 + (model.VZ + model.VR * math.sin(a_l + (a_r - a_l) * i / 16)) * s)) for i in range(17)]
        iron.tube(pts, 0.008, 6)
        for x in (-hw, hw):
            iron.tube([V((x, y, 0.1)), V((x, y, 0.1 + model.EAVE * s))], 0.009, 6)
    for x in (-hw, hw):
        iron.tube([V((x, y0, 0.1 + model.EAVE * s)), V((x, y1, 0.1 + model.EAVE * s))], 0.007, 6)
        glass.quad(V((x, y0, 0.1)), V((x, y1, 0.1)), V((x, y1, 0.1 + model.EAVE * s)), V((x, y0, 0.1 + model.EAVE * s)))
    a_l, a_r = model.vault_angles()
    for i in range(16):
        aa, ab = a_l + (a_r - a_l) * i / 16, a_l + (a_r - a_l) * (i + 1) / 16

        def vp(a, y):
            return V((model.VR * s * math.cos(a), y, 0.1 + (model.VZ + model.VR * math.sin(a)) * s))

        glass.quad(vp(aa, y0), vp(aa, y1), vp(ab, y1), vp(ab, y0))
    for y in (y0, y1):
        xs = [-hw + 2 * hw * k / 12 for k in range(13)]
        for xa, xb in zip(xs, xs[1:]):
            glass.quad(V((xa, y, 0.1)), V((xb, y, 0.1)), V((xb, y, 0.1 + model.vault_z(xb / s) * s)), V((xa, y, 0.1 + model.vault_z(xa / s) * s)))
    # Rotunda at one end.
    rr = 0.3
    cy = y1 + rr * 0.75
    for k in range(12):
        t = math.tau * k / 12
        iron.tube([V((rr * math.cos(t), cy + rr * math.sin(t), 0.1)), V((rr * math.cos(t), cy + rr * math.sin(t), 0.1 + 0.4))], 0.008, 6)
        pts = [V((rr * math.cos(p) * math.cos(t), cy + rr * math.cos(p) * math.sin(t), 0.5 + 0.28 * math.sin(p))) for p in [math.pi / 2 * i / 10 for i in range(11)]]
        iron.tube(pts, 0.007, 6)
    glass.lathe([(rr, 0.1), (rr, 0.5)] + [(rr * math.cos(p), 0.5 + 0.28 * math.sin(p)) for p in [math.pi / 2 * i / 10 for i in range(1, 10)]] + [(0.001, 0.78)], (0, cy, 0), 32)
    model.finial(iron, (0, cy, 0.77), 0.18, mat=1)
    model.finial(iron, (0, y0, 0.1 + model.APEX * s + 0.005), 0.1, mat=1)
    # A few plant blobs inside so it reads as a greenhouse.
    leaves = MeshBuilder()
    rng = np.random.default_rng(4)
    for i in range(26):
        p = V((rng.uniform(-hw * 0.8, hw * 0.8), rng.uniform(y0 + 0.02, cy + 0.15), 0.1))
        if abs(p.x) < 0.04 and p.y < y1:
            continue
        leaves.sphere(p + V((0, 0, rng.uniform(0.04, 0.12))), rng.uniform(0.04, 0.08), 10, 7)
    o_iron = iron.build("mini_iron", [gm.metal("mini_paint", "#f3eee4", 0.3), MATS["iron"][1]], smooth_angle=50)
    mat.assign(o_iron, mat.principled("mini_paint", base=gm.lin("#f3eee4"), rough=0.3, coat=0.4), 0)
    o_glass = glass.build("mini_glass", [mat.principled("mini_glass", base=(0.95, 1, 0.97), transmission=1.0, rough=0.05, ior=1.45)])
    o_base = base.build("mini_base", [mat.principled("mini_stone", base=gm.lin("#d9ceb8"), rough=0.7), mat.principled("mini_stone", base=gm.lin("#d9ceb8"), rough=0.7)], smooth_angle=40)
    o_leaf = leaves.build("mini_leaves", [mat.principled("mini_leaf", base=gm.lin("#4f8a3a"), rough=0.5, sheen=0.5)], smooth_angle=80)
    objs = [o_base, o_iron, o_glass, o_leaf]
    # Centre on the origin, ~1 unit tall.
    zmax = max((o.matrix_world @ V(c)).z for o in objs for c in o.bound_box)
    ymin = min((o.matrix_world @ V(c)).y for o in objs for c in o.bound_box)
    ymax = max((o.matrix_world @ V(c)).y for o in objs for c in o.bound_box)
    k = 1.0 / zmax
    for o in objs:
        o.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation(V((0, -(ymin + ymax) / 2, 0))))
    cli.log("mini tris", sum(geo.triangle_count(o) for o in objs))
    export.glb(OUT / "mini.glb", objs)


SUNVIS = {"min": (-7.3, -22.6, -0.1), "max": (7.3, 7.4, 13.4), "cell": 0.25, "rays": 6, "cols": 8}


def _world_triangles(objs):
    """World-space triangle soup of `objs` (evaluated), as numpy arrays."""
    dg = bpy.context.evaluated_depsgraph_get()
    vs, ts, off = [], [], 0
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.vertices)
        if n and len(me.loop_triangles):
            co = np.empty(n * 3, dtype=np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            M = np.array(o.matrix_world, dtype=np.float32)
            co = co @ M[:3, :3].T + M[:3, 3]
            tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
            me.loop_triangles.foreach_get("vertices", tri)
            vs.append(co)
            ts.append(tri.reshape(-1, 3) + off)
            off += n
        ev.to_mesh_clear()
    return np.concatenate(vs), np.concatenate(ts)


def step_sunvis():
    """Sun (moon) visibility on a 25 cm grid: shadows live foliage and drives the ray-marched haze at runtime."""
    from mathutils.bvhtree import BVHTree

    scene.reset()
    plants.reset()
    P, groups, chunks, fol = build_static("day")
    inst, lanterns = plants.place_scans(P)
    occluders = groups["iron"] + groups["masonry"] + plants.link_instances(inst) + build_foliage_objects(fol) + plants.link_instances(lanterns)
    verts, tris = _world_triangles(occluders)
    cli.log("sunvis occluders", len(tris), "tris")
    bvh = BVHTree.FromPolygons(verts.tolist(), tris.tolist(), all_triangles=True)
    del verts, tris
    lo, hi, cell = V(SUNVIS["min"]), V(SUNVIS["max"]), SUNVIS["cell"]
    dims = [int(math.ceil((hi[i] - lo[i]) / cell)) for i in range(3)]
    nx, ny, nz = dims
    cols = SUNVIS["cols"]
    rows = int(math.ceil(nz / cols))
    rng = np.random.default_rng(9)
    jit = (rng.random((SUNVIS["rays"], 3)) - 0.5) * cell
    out = {}
    for variant in ("day", "night"):
        L = V(sky_info(variant)["dir"]).normalized()
        vis = np.zeros((nz, ny, nx), dtype=np.float32)
        for k in range(nz):
            z = lo.z + (k + 0.5) * cell
            for j in range(ny):
                y = lo.y + (j + 0.5) * cell
                for i in range(nx):
                    x = lo.x + (i + 0.5) * cell
                    lit = 0
                    for dx, dy, dz in jit:
                        if bvh.ray_cast(V((x + dx, y + dy, z + dz)), L, 60.0)[0] is None:
                            lit += 1
                    vis[k, j, i] = lit / len(jit)
            if k % 9 == 0:
                cli.log("sunvis", variant, f"slice {k}/{nz}")
        atlas = np.zeros((rows * ny, cols * nx), dtype=np.uint8)
        for k in range(nz):
            r, c = divmod(k, cols)
            atlas[r * ny : (r + 1) * ny, c * nx : (c + 1) * nx] = np.round(vis[k] * 255).astype(np.uint8)
        # Row 0 of the PNG is voxel row y = 0 of slice 0 (the runtime reads it top-down).
        img = bpy.data.images.new(f"sunvis-{variant}", atlas.shape[1], atlas.shape[0], alpha=False)
        px = np.repeat(atlas[::-1, :, None].astype(np.float32) / 255.0, 4, axis=2)
        px[..., 3] = 1.0
        img.pixels.foreach_set(px.ravel())
        path = OUT / f"sunvis-{variant}.png"
        img.filepath_raw = str(path)
        img.file_format = "PNG"
        img.colorspace_settings.name = "Non-Color"
        img.save()
        out[variant] = float(vis.mean())
        cli.log("sunvis", variant, path.name, f"mean {out[variant]:.2f}")
    meta_path = PUB / "hi" / "greenhouse.json"
    meta = json.loads(meta_path.read_text())
    meta["sunvis"] = {"min": [round(c, 4) for c in lo], "cell": cell, "dims": dims, "cols": cols}
    meta_path.write_text(json.dumps(meta, separators=(",", ":")))


def step_stats():
    """Triangle counts per group and per model function (to find what to trim)."""
    import collections

    counts = collections.Counter()
    orig = MeshBuilder.face

    def face(self, idx, mat=0):
        f = sys._getframe(1)
        name = "?"
        while f is not None:
            mod = f.f_globals.get("__name__", "")
            if mod in ("gh_model", "gh_plants") and f.f_code.co_name not in ("bulbs_string",):
                name = f"{mod}.{f.f_code.co_name}"
                break
            f = f.f_back
        counts[(getattr(self, "_group", "?"), name)] += len(idx) - 2
        orig(self, idx, mat)

    class Tagged(dict):
        def __missing__(self, key):
            mb = MeshBuilder()
            mb._group = key[0]
            self[key] = mb
            return mb

    MeshBuilder.face = face
    P = model.build_all(Tagged)
    fol = plants.build_foliage(P)
    for name, mb in fol.items():
        counts[("foliage", name)] += mb.tris
    MeshBuilder.face = orig
    total = collections.Counter()
    for (g, n), c in counts.items():
        total[g] += c
    for g, c in total.most_common():
        cli.log("group", g, c)
    for (g, n), c in counts.most_common(40):
        cli.log(f"  {g:10s} {n:40s} {c}")


STEPS = {
    "stats": step_stats,
    "sunvis": step_sunvis,
    "bake": step_bake,
    "live": step_live,
    "rail": step_rail,
    "meta": step_meta,
    "sky": step_sky,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name != "preview" or "preview" in args.steps):
        fn()
