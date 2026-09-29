"""The snow globe (Create page).

Steps (run with --steps a,b,...):
  meta     snowglobe.json (layout, glow table, focus + shake tracks) for the runtime
  rail     camera rail -> rails.json
  bake     build desk + village, bake day/night lightmaps, export desk.glb / village.glb
  env      env-<variant>.hdr (reflections, from the globe centre) + bg-<variant>.hdr (room backdrop)
  preview  quick Cycles still at --s (half res, low samples)
  layers   Low Resources depth layers + posters for every tag (day/night)
  pano     4096x2048 equirect from the village square
  mini     a small snow globe for the homepage diorama

Units: 1 = the globe radius. Layout and rail live in sg_model.py.
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

import sg_model as sm  # noqa: E402
import sg_parts as sp  # noqa: E402
from ddd import cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "snowglobe"
REPO = HERE.parents[2]
HDRI = REPO / "art" / ".cache" / "polyhaven" / "hdri" / "christmas_photo_studio_01" / "christmas_photo_studio_01_2k.hdr"
HDRI_ROT = 200.0
SUN_FROM = Vector((-0.62, 0.72, 0.42)).normalized()


def extra_args(p):
    p.add_argument("--s", type=float, default=0.0)
    p.add_argument("--tags", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
TAGS = [0.0, 0.6, 1.2, 1.7, 2.3, 2.85, 3.95]


# --------------------------------------------------------------------------
# World + lights


def world(variant, strength=None):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value[2] = math.radians(HDRI_ROT)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(HDRI), check_existing=True)
    nt.links.new(coord.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], env.inputs["Vector"])
    bg = nt.nodes.new("ShaderNodeBackground")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    if variant == "day":
        # Warm the room a touch; it reads as late-afternoon light.
        tint = nt.nodes.new("ShaderNodeMixRGB")
        tint.blend_type = "MULTIPLY"
        tint.inputs["Fac"].default_value = 1.0
        tint.inputs[2].default_value = (1.0, 0.93, 0.84, 1)
        nt.links.new(env.outputs["Color"], tint.inputs[1])
        nt.links.new(tint.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 0.85 if strength is None else strength
    else:
        # Night: the room falls into blue shadow, practical lights keep glowing.
        dim = nt.nodes.new("ShaderNodeVectorMath")
        dim.operation = "MULTIPLY"
        dim.inputs[1].default_value = (0.022, 0.03, 0.055)
        nt.links.new(env.outputs["Color"], dim.inputs[0])
        hi = nt.nodes.new("ShaderNodeVectorMath")
        hi.operation = "SUBTRACT"
        hi.inputs[1].default_value = (1.4, 1.4, 1.4)
        nt.links.new(env.outputs["Color"], hi.inputs[0])
        mx = nt.nodes.new("ShaderNodeVectorMath")
        mx.operation = "MAXIMUM"
        mx.inputs[1].default_value = (0, 0, 0)
        nt.links.new(hi.outputs[0], mx.inputs[0])
        warm = nt.nodes.new("ShaderNodeVectorMath")
        warm.operation = "MULTIPLY"
        warm.inputs[1].default_value = (0.9, 0.62, 0.34)
        nt.links.new(mx.outputs[0], warm.inputs[0])
        add = nt.nodes.new("ShaderNodeVectorMath")
        add.operation = "ADD"
        nt.links.new(dim.outputs[0], add.inputs[0])
        nt.links.new(warm.outputs[0], add.inputs[1])
        nt.links.new(add.outputs[0], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0 if strength is None else strength
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def _shadow_only(o):
    for attr in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission", "visible_volume_scatter"):
        setattr(o, attr, False)
    o.visible_shadow = True
    o["group"] = "light"


def window_gobo(dist=34.0):
    """Window frame far along the sun direction: casts pane shadows across the desk."""
    fwd = -SUN_FROM
    q = fwd.to_track_quat("-Z", "Y")
    c = SUN_FROM * dist
    parts = []
    W, H, bar = 20.0, 15.0, 0.7
    for (x, y, w, h) in ((-W / 2 - 15, 0, 30, 80), (W / 2 + 15, 0, 30, 80), (0, H / 2 + 20, W, 40), (0, -H / 2 - 20, W, 40), (0, 0, bar, H), (-W / 4, 0, bar * 0.6, H), (W / 4, 0, bar * 0.6, H), (0, H * 0.12, W, bar)):
        o = sp.box("gobo", (w, h, 0.2), (0, 0, 0), "light", None)
        o.matrix_world = Matrix.LocRotScale(c + q @ Vector((x, y, 0)), q, Vector((1, 1, 1)))
        parts.append(o)
    g = geo.join(parts, "window_gobo")
    _shadow_only(g)
    return [g]


def lights(variant):
    objs = []
    rot = (-SUN_FROM).to_track_quat("-Z", "Y").to_euler()
    if variant == "day":
        sun = scene.sun_light("window_sun", strength=4.2, color=(1.0, 0.8, 0.58), angle_deg=1.2)
        sun.rotation_euler = rot
        objs.append(sun)
        fill = scene.area_light("window_fill", tuple(SUN_FROM * 16), size=12, power=2600, color=(1.0, 0.9, 0.8))
        fill.rotation_euler = rot
        objs.append(fill)
        # Product softbox above-front: crisp, cool highlights on the glass and white snow.
        box_pos = Vector((-3.5, -6.5, 7.5))
        soft = scene.area_light("softbox", tuple(box_pos), size=1.4, power=1300, color=(0.9, 0.95, 1.0))
        soft.data.size_y = 7.0
        soft.data.shape = "RECTANGLE"
        soft.rotation_euler = (Vector((0, 0, 1.0)) - box_pos).to_track_quat("-Z", "Y").to_euler()
        objs.append(soft)
    else:
        moon = scene.sun_light("moon", strength=0.55, color=(0.55, 0.7, 1.0), angle_deg=0.8)
        moon.rotation_euler = rot
        objs.append(moon)
        lamp = scene.area_light("desk_lamp", (8.0, -3.0, 9.5), size=2.5, power=2400, color=(1.0, 0.68, 0.38))
        lamp.rotation_euler = (Vector((0, 0, 0.6)) - Vector((8.0, -3.0, 9.5))).to_track_quat("-Z", "Y").to_euler()
        objs.append(lamp)
        glow = scene.point_light("globe_glow", (0.0, 0.0, 0.95), power=45, radius=0.35, color=(1.0, 0.72, 0.42))
        objs.append(glow)
        for i, (x, y) in enumerate(sm.lamp_spots()):
            objs.append(scene.point_light(f"lamp_pt{i}", (x, y, sm.ground(x, y) + 0.08), power=0.35, radius=0.006, color=(1.0, 0.78, 0.48)))
        tx, ty = sm.XMAS_TREE["p"]
        objs.append(scene.point_light("tree_pt", (tx, ty - 0.06, sm.ground(tx, ty) + 0.18), power=1.0, radius=0.05, color=(1.0, 0.75, 0.5)))
        cx, cy = sm.CINEMA["p"]
        objs.append(scene.point_light("marquee_pt", (cx + 0.02, cy - 0.16, sm.ground(cx, cy) + 0.06), power=1.2, radius=0.03, color=(1.0, 0.8, 0.5)))
    for o in objs:
        o["group"] = "light"
    return objs + window_gobo()


# --------------------------------------------------------------------------
# Camera rail


def rail_keys():
    out = []
    for s, pos, subj, shift, fov, roll in sm.KEYS:
        p = Vector(pos)
        t = Vector(subj)
        d = t - p
        right = d.cross(Vector((0, 0, 1))).normalized()
        look = t - right * (shift * d.length * 0.15)
        out.append({"s": s, "pos": tuple(p), "look": tuple(look), "fov": fov, "roll": roll})
    return out


def build_camera():
    cam = scene.camera(lens=40)
    cam.data.clip_start = 0.004
    cam.data.clip_end = 400
    rails.key(cam, rail_keys())
    return cam


def focus_at(s):
    keys = [(k[0], Vector(k[2]) - Vector(k[1])) for k in sm.KEYS]
    i = max(j for j in range(len(keys)) if keys[j][0] <= s + 1e-6) if s >= keys[0][0] else 0
    j = min(i + 1, len(keys) - 1)
    if i == j:
        return keys[i][1].length
    t = (s - keys[i][0]) / (keys[j][0] - keys[i][0])
    return keys[i][1].length * (1 - t) + keys[j][1].length * t


def inside_at(cam):
    return (cam.matrix_world.translation - Vector(sm.GLOBE_C)).length < sm.R_IN


def sparkle_points(n=9000, seed=9):
    """Points on open snow (not pond or paths) with normals, three.js coordinates."""
    rng = np.random.default_rng(seed)
    path = sm.path_points(sm.PATH, 0.01) + sm.path_points(sm.PATH_B, 0.01)
    out = []
    e = 0.002
    while len(out) < n:
        x, y = rng.uniform(-sm.VILLAGE_R, sm.VILLAGE_R, 2)
        if math.hypot(x, y) > sm.VILLAGE_R - 0.03 or sm.pond_mask(x, y) > 0.05 or sm.dist_to_path(x, y, path) < 0.03:
            continue
        z = sm.ground(x, y) + 0.0015
        nx = -(sm.ground(x + e, y) - sm.ground(x - e, y)) / (2 * e)
        ny = -(sm.ground(x, y + e) - sm.ground(x, y - e)) / (2 * e)
        nrm = Vector((nx, ny, 1.0)).normalized()
        out.append((x, z, -y, nrm.x, nrm.z, -nrm.y))
    arr = np.array(out, np.float32)
    (PUB / "hi" / "sparkle.bin").write_bytes(arr.tobytes())
    return len(out)


def step_meta():
    meta_path = PUB / "hi" / "snowglobe.json"
    old = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    sm.export_meta(meta_path)
    if "lightmaps" in old:
        meta = json.loads(meta_path.read_text())
        meta["lightmaps"] = old["lightmaps"]
        meta_path.write_text(json.dumps(meta, indent=1))
    cli.log("meta written; sparkle points", sparkle_points())


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", sm.S_MAX)
    cli.log("rail written")


# --------------------------------------------------------------------------
# Lightmap baking


def dedupe_materials(o):
    """geo.join keeps one slot per source object; merge identical materials so each becomes one draw call."""
    me = o.data
    uniq, remap = [], []
    for m in me.materials:
        if m not in uniq:
            uniq.append(m)
        remap.append(uniq.index(m))
    idx = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("material_index", idx)
    idx = np.array(remap, np.int32)[idx] if len(remap) else idx
    me.materials.clear()
    for m in uniq:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)
    me.update()
    return o


def unwrap(o, margin=0.004, angle=60):
    sp.ensure_uv(o)
    me = o.data
    me.uv_layers["UVMap"].active_render = True
    uv = me.uv_layers.get("bake") or me.uv_layers.new(name="bake")
    me.uv_layers.active = uv
    bpy.context.view_layer.update()
    for x in bpy.context.scene.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers["UVMap"].active_render = True
    return uv


def srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save_lightmap(img, path):
    """Denoise lightly (3x3 median + tiny blur), normalise, write sRGB PNG. Returns the scale."""
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[..., :3]
    out = np.empty_like(px)
    for c in range(3):
        ch = px[..., c]
        st = np.stack([np.roll(np.roll(ch, dy, 0), dx, 1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
        m = np.median(st, axis=0)
        m = 0.25 * np.roll(m, 1, 0) + 0.5 * m + 0.25 * np.roll(m, -1, 0)
        m = 0.25 * np.roll(m, 1, 1) + 0.5 * m + 0.25 * np.roll(m, -1, 1)
        out[..., c] = m
    lum = out.max(axis=2)
    nz = lum[lum > 1e-5]
    scale = float(np.percentile(nz, 99.0)) if nz.size else 1.0
    scale = max(scale, 1e-3)
    enc = srgb(out / scale)
    rgba = np.concatenate([enc, np.ones((H, W, 1), np.float32)], axis=2)
    im = bpy.data.images.new(path.stem, W, H, alpha=False, float_buffer=False)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    return scale


def bake(o, name, variant, size, samples):
    sc = bpy.context.scene
    img = bpy.data.images.new(f"{name}_{variant}", size, size, alpha=False, float_buffer=True)
    nodes = []
    for m in o.data.materials:
        if not m:
            continue
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
        nodes.append((nt, tex, uvn))
    sc.cycles.samples = samples
    sc.render.bake.margin = 16
    for x in sc.objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    cli.log("baking", name, variant, f"{size}px", f"{samples}spp")
    gpu_retry(bpy.ops.object.bake, type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=16, use_clear=True)
    (OUT / "lm").mkdir(exist_ok=True)
    scale = save_lightmap(img, OUT / "lm" / f"{name}-{variant}.png")
    for nt, tex, uvn in nodes:
        nt.nodes.remove(tex)
        nt.nodes.remove(uvn)
    bpy.data.images.remove(img)
    cli.log("lightmap", name, variant, "scale", round(scale, 4))
    return scale


LIGHTMAPS = {
    # group: (size, samples)
    "village": (2048, 160),
    "trees": (1024, 128),
    "desk": (2048, 64),
    "props": (2048, 128),
}


def step_bake():
    scene.reset()
    sp.reset_cache()
    scene.cycles(samples=256, bounces=6, res=(512, 512))
    village = sp.build_village()
    desk_objs = sp.build_desk(OUT)
    sp.pose_skaters(village["skaters"], 0.0)
    for o in village["skaters"] + village["screens"]:
        o.hide_render = True
    desk_part = [o for o in desk_objs if o.get("group") == "desk"]
    props_part = [o for o in desk_objs if o.get("group") == "props"]
    trees_part = [o for o in village["static"] if o.get("group") == "trees"]
    ground_part = [o for o in village["static"] if o.get("group") != "trees"]
    joined = {
        "village": geo.join(ground_part, "village"),
        "trees": geo.join(trees_part, "trees"),
        "desk": geo.join(desk_part, "desk"),
        "props": geo.join(props_part, "props"),
    }
    for name, o in joined.items():
        dedupe_materials(o)
        o["group"] = name
        geo.smooth(o, 40) if name == "props" else None
        unwrap(o, {"village": 0.002, "trees": 0.003}.get(name, 0.004), angle=80 if name == "trees" else 60)
        cli.log("unwrapped", name, geo.triangle_count(o), "tris")
    scales = {}
    for variant in ("day", "night"):
        world(variant)
        ls = lights(variant)
        extra = [sp.build_aurora()] if variant == "night" else []
        sp.set_glow_variant(variant)
        for name, o in joined.items():
            size, samples = LIGHTMAPS[name]
            if args.preview:
                size, samples = size // 4, 48
            scales.setdefault(name, {})[variant] = round(bake(o, name, variant, size, samples), 5)
        for x in ls + extra:
            bpy.data.objects.remove(x, do_unlink=True)
    # Export with neutral emission; the runtime applies the variant strengths.
    for name in sm.GLOW:
        m = sp._mats.get(name)
        if m:
            mat.bsdf_of(m).inputs["Emission Strength"].default_value = 1.0
    for o in village["skaters"] + village["screens"]:
        o.hide_render = False
    # Skaters ship at the origin; the runtime moves them around the pond.
    for o in village["skaters"]:
        o.location = (0, 0, 0)
        o.rotation_euler = (0, 0, 0)
    export.glb(OUT / "village.glb", [joined["village"], joined["trees"], *village["screens"], *village["skaters"]])
    export.glb(OUT / "desk.glb", [joined["desk"], joined["props"]])
    meta_path = PUB / "hi" / "snowglobe.json"
    if not meta_path.exists():
        sm.export_meta(meta_path)
    meta = json.loads(meta_path.read_text())
    meta["lightmaps"] = scales
    meta_path.write_text(json.dumps(meta, indent=1))
    cli.log("bake done", scales)


# --------------------------------------------------------------------------
# Cycles staging (stills, layers, panoramas)


def screen_materials(screens, variant):
    for o in screens:
        path = REPO / "public" / sm.COVERS[o.name.split(".")[0]].lstrip("/")
        m = bpy.data.materials.new(f"img_{o.name}")
        if hasattr(m, "use_nodes"):
            m.use_nodes = True
        nt = m.node_tree
        b = mat.bsdf_of(m)
        b.inputs["Base Color"].default_value = (0, 0, 0, 1)
        b.inputs["Roughness"].default_value = 0.3
        t = mat.image_node(m, path, "sRGB")
        nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 1.1 if variant == "day" else 2.2
        mat.assign(o, m)


def gpu_retry(fn, *a, **kw):
    """The GPU is shared with other builds; on a Metal out-of-memory error, redo the job on the CPU."""
    try:
        return fn(*a, **kw)
    except RuntimeError as e:
        cli.log("render failed on GPU, retrying on CPU:", str(e).splitlines()[0][:120])
        bpy.context.scene.cycles.device = "CPU"
        try:
            return fn(*a, **kw)
        finally:
            bpy.context.scene.cycles.device = "GPU"


class Stage:
    def __init__(self, variant, with_glass=True):
        scene.reset()
        sp.reset_cache()
        self.variant = variant
        self.sc = scene.cycles(samples=args.samples or (24 if args.preview else 72), bounces=8, res=(1920, 1200))
        self.sc.cycles.transparent_max_bounces = 24
        scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - High Contrast", exposure=0.0 if variant == "day" else 0.3)
        world(variant)
        self.village = sp.build_village()
        self.desk = sp.build_desk(OUT)
        self.glass = sp.build_glass() if with_glass else None
        self.aurora = sp.build_aurora() if variant == "night" else None
        self.lights = lights(variant)
        sp.set_glow_variant(variant)
        screen_materials(self.village["screens"], variant)
        self.cam = build_camera()
        self.snow = None

    def at(self, s):
        rails.set_at(s)
        shake = sm.track(sm.SHAKE, s)
        if self.snow:
            bpy.data.objects.remove(self.snow, do_unlink=True)
        self.snow = sp.build_snow(shake=shake, seed=int(s * 100) + 3)
        sp.pose_skaters(self.village["skaters"], s * 6.0)
        cam = self.cam
        cam.data.dof.use_dof = True
        cam.data.dof.focus_distance = focus_at(s)
        inside = inside_at(cam)
        cam.data.dof.aperture_fstop = 0.4 if inside else 0.5
        cam.data.dof.aperture_blades = 7
        return inside

    def objects(self):
        return [o for o in bpy.context.scene.objects if o.type == "MESH" and o.get("group") not in ("light",)]


def step_preview():
    ss = [float(t) for t in args.tags.split(",")] if args.tags else [args.s]
    for variant in args.variants:
        st = Stage(variant)
        for s in ss:
            st.at(s)
            st.sc.render.resolution_x, st.sc.render.resolution_y = 960, 600
            gpu_retry(render.still, OUT / f"preview-{variant}-{s:.2f}.png")


def split_bands(st, s):
    """back: world + everything far; mid: what is near the camera (parallax layer)."""
    cpos = st.cam.matrix_world.translation
    near = focus_at(s) * 0.55
    back, mid = [], []
    for o in st.objects():
        if o is st.snow:
            (mid if inside_at(st.cam) else back).append(o)
            continue
        if o is st.glass or o is st.aurora or o.get("group") in ("desk",):
            back.append(o)
            continue
        corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        center = sum(corners, Vector()) / 8
        radius = max((c - center).length for c in corners)
        d = (center - cpos).length
        (mid if d - radius * 0.5 < near and radius < near * 2.5 else back).append(o)
    return back, mid


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        st = Stage(variant)
        for s in tags:
            st.at(s)
            back, mid = split_bands(st, s)
            f = focus_at(s)
            gpu_retry(render.layers, st.cam, s, [("back", back), ("mid", mid)], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=st.sc.cycles.samples, depths={"back": f * 1.6})


def save_hdr(path, res, samples, location):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    if hasattr(cd, "panorama_type"):
        cd.panorama_type = "EQUIRECTANGULAR"
    else:
        cd.cycles.panorama_type = "EQUIRECTANGULAR"
    co = bpy.data.objects.new("pano", cd)
    sc.collection.objects.link(co)
    co.location = location
    co.rotation_euler = (math.radians(90), 0, math.radians(-90))
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = samples
    sc.render.image_settings.file_format = "HDR"
    sc.render.image_settings.color_depth = "32"
    sc.render.filepath = str(path)
    gpu_retry(bpy.ops.render.render, write_still=True)
    bpy.data.objects.remove(co, do_unlink=True)


def step_env():
    for variant in args.variants:
        st = Stage(variant, with_glass=False)
        st.at(0.0)
        hide = [o for o in st.objects() if o.get("group") in ("village", "trees", "dynamic", "fx") or o.name.startswith(("globe_", "plaque", "screw"))]
        for o in hide:
            o.hide_render = True
        save_hdr(PUB / "hi" / f"env-{variant}.hdr", (1024, 512), args.samples or 96, sm.GLOBE_C)
        for o in st.objects():
            o.hide_render = True
        save_hdr(PUB / "hi" / f"bg-{variant}.hdr", (2048, 1024), 4, sm.GLOBE_C)
        cli.log("env", variant)


def step_pano():
    for variant in args.variants:
        st = Stage(variant)
        st.at(2.3)
        st.cam.data.dof.use_dof = False
        x, y = 0.05, -0.1
        png = OUT / f"pano-{variant}.png"
        gpu_retry(render.panorama, png, (x, y, sm.ground(x, y) + 0.07), res=(4096, 2048), samples=args.samples or 64, look_yaw_deg=90)
        cli.log("pano", variant, png)


def step_mini():
    """A small snow globe (~1 unit tall) with a cabin and pines inside."""
    scene.reset()
    sp.reset_cache()
    k = 0.4
    walnut = sp.M("mini_walnut", base=sm.lin("#5a3522"), rough=0.3, coat=1.0, coat_rough=0.05)
    brass = sp.M("mini_brass", base=sm.lin("#d6ab55"), metal=1.0, rough=0.22)
    snow = sp.M("mini_snow", base=sm.lin("#f5f8ff"), rough=0.6, sheen=0.3)
    pine = sp.M("mini_pine", base=sm.lin("#1f4a30"), rough=0.75, sheen=0.3)
    logm = sp.M("mini_log", base=sm.lin("#8c5a36"), rough=0.7)
    roof = sp.M("mini_roof", base=sm.lin("#6a2c2a"), rough=0.6)
    win = sp.M("mini_window", base=sm.lin("#ffb866"), emission=sm.lin("#ffb866"), emission_strength=3.0)
    base = sp.lathe("mini_base", [(0.0, 0.0), (0.36, 0.0), (0.37, 0.02), (0.36, 0.05), (0.34, 0.18), (0.33, 0.22)], "mini", walnut, seg=48)
    ring = sp.lathe("mini_ring", [(0.33, 0.22), (0.34, 0.235), (0.32, 0.25), (0.0, 0.25)], "mini", brass, seg=48)
    plaque = sp.box("mini_plaque", (0.18, 0.012, 0.05), (0, -0.35, 0.11), "mini", brass, rot=(-0.12, 0, 0), bevel=0.004)
    zc = 0.25 + 0.36
    mound = sp.lathe("mini_mound", [(0.0, zc - 0.28), (0.2, zc - 0.29), (0.3, zc - 0.33), (0.33, 0.25)], "mini", snow, seg=40)
    parts = [base, ring, plaque, mound]
    import random

    rng = random.Random(4)
    for i, (x, y, h) in enumerate([(-0.14, 0.06, 0.2), (0.15, 0.1, 0.16), (-0.02, 0.16, 0.24), (0.1, -0.13, 0.12), (-0.18, -0.08, 0.13)]):
        z0 = zc - 0.285 - 0.02 * math.hypot(x, y) / 0.3
        for t in range(3):
            c = sp.star_cone(f"mp{i}{t}", h * 0.38 * (1 - t * 0.28), h * 0.42, "mini", pine, seg=9, jag=0.7, droop=0.12, rng=rng)
            c.location = (x, y, z0 + h * (0.12 + 0.28 * t))
            s = sp.star_cone(f"ms{i}{t}", h * 0.3 * (1 - t * 0.28), h * 0.32, "mini", snow, seg=9, jag=0.7, droop=0.04, rng=rng, top_only=True)
            s.location = (x, y, z0 + h * (0.12 + 0.28 * t) + h * 0.12)
            parts += [c, s]
    cz = zc - 0.29
    parts.append(sp.box("mini_cabin", (0.12, 0.09, 0.07), (0.0, -0.02, cz + 0.035), "mini", logm, bevel=0.004))
    for sx in (-1, 1):
        parts.append(sp.box(f"mini_roof{sx}", (0.085, 0.11, 0.012), (sx * 0.035, -0.02, cz + 0.088), "mini", roof, rot=(0, sx * 0.6, 0)))
        parts.append(sp.box(f"mini_roofsnow{sx}", (0.087, 0.112, 0.008), (sx * 0.036, -0.02, cz + 0.097), "mini", snow, rot=(0, sx * 0.6, 0), bevel=0.003))
    for wx in (-0.03, 0.03):
        parts.append(sp.box(f"mini_win{wx}", (0.022, 0.004, 0.02), (wx, -0.066, cz + 0.035), "mini", win))
    solid = geo.join(parts, "mini_globe")
    geo.smooth(solid, 40)
    bm_glass = sp.sphere("mini_glass", 0.36, (0, 0, zc), "mini", sp.M("mini_glass_mat", base=(1, 1, 1), transmission=1.0, rough=0.02, ior=1.45), seg=48)
    geo.smooth(bm_glass, 180)
    cli.log("mini tris", geo.triangle_count(solid) + geo.triangle_count(bm_glass))
    export.glb(OUT / "mini.glb", [solid, bm_glass])


STEPS = {
    "meta": step_meta,
    "rail": step_rail,
    "bake": step_bake,
    "env": step_env,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name != "preview" or "preview" in args.steps):
        fn()
