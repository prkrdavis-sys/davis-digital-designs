"""The long way up: the Khumbu from Lukla to the summit of Everest.

Steps (run with --steps a,b,...):
  terrain   DEM grid -> full-res bake mesh + decimated web mesh (terrain.glb)
  bake      Cycles sun/moon + sky + AO baked into the terrain color (day, night)
  rail      camera rail following the smoothed route spline -> rails.json
  preview   quick Cycles still at --s (uses the baked terrain)
  layers    Low Resources depth layers + posters for every tag (day/night)
  pano      360 view from above Gorak Shep toward Everest
  mini      carved terrain block of the Everest massif with the gold route

Data comes from geo.mjs / route.mjs (art/out/everest/): dem.f32, terrain.json,
albedo.png, masks.png, route.json. Local space matches the runtime: 1 unit =
100 m, heights x terrain.json exag. Blender is (x east, y north, z up); three.js
is (x east, y up, z south).
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "everest"


def extra_args(p):
    p.add_argument("--s", type=float, default=0.3)
    p.add_argument("--tags", default="")
    p.add_argument("--bake-size", type=int, default=0)


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
S_MAX = 6.2

META = json.loads((OUT / "terrain.json").read_text())
ROUTE = json.loads((OUT / "route.json").read_text())
UNIT = META["unit"]
EXAG = META["exag"]


def b(v):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return (v[0], -v[2], v[1])


def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def meters_to_units(m):
    return m * EXAG / UNIT


# --------------------------------------------------------------------------
# Lighting. Kept identical to the runtime (src/worlds/scenes/everest/look.ts).
LIGHT = {
    # Late-afternoon golden hour from the west-southwest: Everest, Nuptse and
    # Lhotse glow while the valleys fall into cool shadow.
    "day": {"az": 242.0, "el": 17.0, "sun": 9.0, "sun_color": lin("#ffb46e"), "sky": 0.32, "haze": lin("#c9d6ea")},
    # Moonlight from the east-southeast, silver on the snow.
    "night": {"az": 118.0, "el": 34.0, "sun": 0.9, "sun_color": lin("#b8ccff"), "sky": 0.25, "haze": lin("#0d1830")},
}


def sun_dir(az_deg, el_deg):
    """Unit vector toward the sun in Blender axes (azimuth clockwise from north)."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def add_sun(variant):
    L = LIGHT[variant]
    o = scene.sun_light(f"sun_{variant}", strength=L["sun"], color=L["sun_color"], angle_deg=0.6 if variant == "day" else 0.5)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = sun_dir(L["az"], L["el"]).to_track_quat("Z", "Y")
    return o


def world_for(variant, stars=False):
    L = LIGHT[variant]
    if variant == "day":
        w = scene.world_sky(sun_elevation_deg=L["el"], sun_rotation_deg=90 - L["az"], strength=L["sky"], altitude=5000.0, air=1.0, dust=0.6, ozone=1.0)
        for n in w.node_tree.nodes:
            if n.type == "TEX_SKY" and hasattr(n, "sun_disc"):
                n.sun_disc = False
        return w
    w = bpy.data.worlds.new("night")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    # Deep blue at the horizon to near-black overhead.
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (*lin("#1a2a4a"), 1)
    ramp.color_ramp.elements[1].position = 0.35
    ramp.color_ramp.elements[1].color = (*lin("#03060f"), 1)
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = L["sky"]
    col = ramp.outputs["Color"]
    if stars:
        # Stars: sharp voronoi points, camera rays only.
        vor = nt.nodes.new("ShaderNodeTexVoronoi")
        vor.feature = "F1"
        vor.inputs["Scale"].default_value = 420.0
        nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
        pw = nt.nodes.new("ShaderNodeMath")
        pw.operation = "LESS_THAN"
        pw.inputs[1].default_value = 0.035
        nt.links.new(vor.outputs["Distance"], pw.inputs[0])
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "MULTIPLY"
        nt.links.new(pw.outputs[0], rnd.inputs[0])
        nt.links.new(vor.outputs["Color"], rnd.inputs[1])
        amp = nt.nodes.new("ShaderNodeMath")
        amp.operation = "MULTIPLY"
        amp.inputs[1].default_value = 40.0
        nt.links.new(rnd.outputs[0], amp.inputs[0])
        add = nt.nodes.new("ShaderNodeMixRGB")
        add.blend_type = "ADD"
        add.inputs["Fac"].default_value = 1.0
        nt.links.new(col, add.inputs[1])
        nt.links.new(amp.outputs[0], add.inputs[2])
        lp = nt.nodes.new("ShaderNodeLightPath")
        mixc = nt.nodes.new("ShaderNodeMixRGB")
        nt.links.new(lp.outputs["Is Camera Ray"], mixc.inputs["Fac"])
        nt.links.new(col, mixc.inputs[1])
        nt.links.new(add.outputs[0], mixc.inputs[2])
        col = mixc.outputs[0]
    nt.links.new(col, bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


# --------------------------------------------------------------------------
# Terrain mesh
def load_dem():
    return np.fromfile(OUT / "dem.f32", dtype=np.float32).reshape(META["ny"], META["nx"])


def grid_mesh(name, H, step=1, x0=0, y0=0, x1=None, y1=None):
    """Heightfield mesh over grid[y0:y1:step, x0:x1:step] with planar UVs over the full grid."""
    nx, ny, dx = META["nx"], META["ny"], META["dx"]
    x1 = nx if x1 is None else x1
    y1 = ny if y1 is None else y1
    cols = np.arange(x0, x1, step)
    rows = np.arange(y0, y1, step)
    if cols[-1] != x1 - 1:
        cols = np.append(cols, x1 - 1)
    if rows[-1] != y1 - 1:
        rows = np.append(rows, y1 - 1)
    W, Hh = len(cols), len(rows)
    ee = META["e0"] + cols * dx
    nn = META["n1"] - rows * dx
    X = np.broadcast_to((ee - META["ec"]) / UNIT, (Hh, W))
    Y = np.broadcast_to(((nn - META["nc"]) / UNIT)[:, None], (Hh, W))
    Z = H[np.ix_(rows, cols)] * EXAG / UNIT
    verts = np.stack([X, Y, Z], axis=-1).reshape(-1, 3).astype(np.float32)
    j, i = np.meshgrid(np.arange(Hh - 1), np.arange(W - 1), indexing="ij")
    a = (j * W + i).ravel()
    quads = np.stack([a, a + W, a + W + 1, a + 1], axis=1).astype(np.int32)  # CCW seen from +Z
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    me.loops.add(quads.size)
    me.loops.foreach_set("vertex_index", quads.ravel())
    me.polygons.add(len(quads))
    me.polygons.foreach_set("loop_start", np.arange(len(quads), dtype=np.int32) * 4)
    try:
        me.polygons.foreach_set("loop_total", np.full(len(quads), 4, dtype=np.int32))
    except (AttributeError, RuntimeError, TypeError):
        pass
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name="geo")
    u = (cols / (nx - 1))
    v = 1.0 - rows / (ny - 1)
    U = np.broadcast_to(u, (Hh, W)).ravel()
    V = np.broadcast_to(v[:, None], (Hh, W)).ravel()
    lv = quads.ravel()
    uv.data.foreach_set("uv", np.stack([U[lv], V[lv]], axis=1).astype(np.float32).ravel())
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    cli.log("grid", name, f"{W}x{Hh}", f"{len(quads) * 2} tris")
    return o


def math_node(nt, op, a=None, b_=None, c=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for k, v in ((0, a), (1, b_), (2, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[k].default_value = v
        else:
            nt.links.new(v, n.inputs[k])
    return n.outputs[0]


def mix_rgb(nt, fac, c1, c2, blend="MIX"):
    n = nt.nodes.new("ShaderNodeMixRGB")
    n.blend_type = blend
    for k, v in (("Fac", fac), (1, c1), (2, c2)):
        sock = n.inputs[k]
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = (*v, 1.0) if len(v) == 3 else v
        else:
            nt.links.new(v, sock)
    return n.outputs[0]


def smoothstep(nt, x, e0, e1):
    """(x - e0) / (e1 - e0) clamped, then smoothstep via Map Range."""
    n = nt.nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    n.inputs["From Min"].default_value = e0
    n.inputs["From Max"].default_value = e1
    nt.links.new(x, n.inputs["Value"])
    return n.outputs["Result"]


def terrain_albedo_material(name="terrain_albedo"):
    """Sentinel-2 de-lit albedo, repaired with procedural snow/rock/moraine by slope and altitude."""
    m = mat.principled(name, rough=0.9, specular=0.3)
    nt = m.node_tree
    bsdf = mat.bsdf_of(m)
    alb = mat.image_node(m, OUT / "albedo.png", "sRGB", uv_map="geo")
    msk = mat.image_node(m, OUT / "masks.png", "Non-Color", uv_map="geo")
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(msk.outputs["Color"], sep.inputs[0])
    snow_m, water_m, conf = sep.outputs[0], sep.outputs[1], sep.outputs[2]

    gi = nt.nodes.new("ShaderNodeNewGeometry")
    sp = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(gi.outputs["Position"], sp.inputs[0])
    sn = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(gi.outputs["Normal"], sn.inputs[0])
    alt = sp.outputs["Z"]  # units
    up = sn.outputs["Z"]

    # Fine rock/snow breakup noise in world space (~100 m and ~20 m features).
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.2
    nz.inputs["Detail"].default_value = 10.0
    nz.inputs["Roughness"].default_value = 0.62
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    fine = nz.outputs["Fac"]

    rock = mix_rgb(nt, fine, lin("#231d18"), lin("#4a4038"))
    moraine = mix_rgb(nt, fine, lin("#5a5048"), lin("#8a7c6c"))
    meadow = mix_rgb(nt, fine, lin("#3b2c1e"), lin("#5e4a31"))
    forest = mix_rgb(nt, fine, lin("#152014"), lin("#2a321c"))
    snow = mix_rgb(nt, fine, lin("#d9dde6"), lin("#f4f6fa"))

    # Altitude bands (in units: meters * exag / 100).
    low = mix_rgb(nt, smoothstep(nt, alt, meters_to_units(3500), meters_to_units(4100)), forest, meadow)
    mid = mix_rgb(nt, smoothstep(nt, alt, meters_to_units(4600), meters_to_units(5200)), low, moraine)
    # Snow holds where the slope allows it, above the winter snow line.
    flat = smoothstep(nt, up, 0.55, 0.8)
    high = smoothstep(nt, alt, meters_to_units(5000), meters_to_units(5800))
    snow_amt = math_node(nt, "MULTIPLY", flat, high)
    proc = mix_rgb(nt, snow_amt, mid, snow)
    steep = smoothstep(nt, up, 0.62, 0.4)
    proc = mix_rgb(nt, math_node(nt, "MULTIPLY", steep, 0.85), proc, rock)

    # Trust the satellite where the de-lighting is confident.
    w = math_node(nt, "MULTIPLY_ADD", conf, 0.7, 0.3)
    col = mix_rgb(nt, w, proc, alb.outputs["Color"])
    # SCL snow/ice class cleans up shadowed snow; lakes get glacial teal.
    col = mix_rgb(nt, math_node(nt, "MULTIPLY", snow_m, 0.55), col, snow, blend="LIGHTEN")
    col = mix_rgb(nt, water_m, col, lin("#1b4a52"))
    # Subtle micro variation everywhere so close-ups do not look smeared.
    micro = nt.nodes.new("ShaderNodeTexNoise")
    micro.inputs["Scale"].default_value = 9.0
    micro.inputs["Detail"].default_value = 6.0
    nt.links.new(tc.outputs["Object"], micro.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = 0.86
    mr.inputs["To Max"].default_value = 1.12
    nt.links.new(micro.outputs["Fac"], mr.inputs["Value"])
    col = mix_rgb(nt, 1.0, col, mr.outputs["Result"], blend="MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    return m


def step_terrain():
    scene.reset()
    H = load_dem()
    # Web mesh: every 2nd sample, then decimated where the ground is smooth.
    o = grid_mesh("terrain", H, step=2)
    tris = geo.triangle_count(o)
    geo.decimate(o, 380000 / tris)
    geo.apply_all(o)
    cli.log("terrain web mesh", geo.triangle_count(o), "tris")
    # Positions only: the runtime derives UVs from x/z and normals from the DEM normal map.
    export.glb(OUT / "terrain.glb", [o], export_normals=False, export_texcoords=False, export_materials="NONE")


def bake_terrain(variant, size):
    scene.reset()
    sc = scene.cycles(samples=args.samples or (32 if args.preview else 160), bounces=4)
    sc.cycles.use_denoising = False
    H = load_dem()
    o = grid_mesh("terrain_bake", H, step=1)
    geo.smooth(o, 180)
    m = terrain_albedo_material()
    mat.assign(o, m)
    world_for(variant)
    add_sun(variant)
    w, h = META["tex"]
    if size:
        w, h = int(w * size / h) // 4 * 4, size
    img = bpy.data.images.new(f"terrain_{variant}", w, h, alpha=False, float_buffer=True)
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "geo"
    nt.links.new(uvn.outputs[0], tex.inputs["Vector"])
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    for ob in sc.objects:
        ob.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    sc.render.bake.margin = 4
    cli.log("baking terrain", variant, f"{w}x{h}", sc.cycles.samples, "spp")
    bpy.ops.object.bake(type="COMBINED", pass_filter={"DIRECT", "INDIRECT", "DIFFUSE"}, margin=4, use_clear=True)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    ref = float(np.percentile(lum, 99.6))
    scale = 0.9 / max(ref, 1e-6)
    rgb *= scale
    px.reshape(-1, 4)[:, :3] = rgb
    img.pixels.foreach_set(px)
    path = OUT / f"terrain-{variant}.png"
    bake.save_srgb(img, path, exposure=0.0)
    (OUT / f"terrain-{variant}.json").write_text(json.dumps({"scale": scale, "p996": ref}))
    cli.log("bake", variant, "p99.6", round(ref, 4), "scale", round(scale, 4))


def step_bake():
    for variant in args.variants:
        bake_terrain(variant, args.bake_size or (1024 if args.preview else 0))
    meta_pub = PUB / "hi" / "terrain.json"
    meta = json.loads(meta_pub.read_text())
    meta["bake"] = {}
    for variant in ("day", "night"):
        p = OUT / f"terrain-{variant}.json"
        if p.exists():
            meta["bake"][variant] = json.loads(p.read_text())
    meta["light"] = {k: {"az": v["az"], "el": v["el"]} for k, v in LIGHT.items()}
    meta_pub.write_text(json.dumps(meta))


# --------------------------------------------------------------------------
# Route helpers (mirror src/worlds/scenes/everest/route.ts)
PTS = np.array(ROUTE["points"], dtype=np.float64)
DIST = np.array(ROUTE["dist"], dtype=np.float64)
CAM = np.array(ROUTE["camera"], dtype=np.float64)
CAM_D = np.array(ROUTE["cameraDist"], dtype=np.float64)
DRAW = np.array(ROUTE["draw"], dtype=np.float64)
WP = {w["name"]: w for w in ROUTE["waypoints"]}
PEAKS = {k: np.array(v["local"]) for k, v in META["peaks"].items()}


def draw_at(s):
    f = min(max(s / ROUTE["drawStep"], 0.0), len(DRAW) - 1.0)
    i = min(int(f), len(DRAW) - 2)
    return DRAW[i] + (DRAW[i + 1] - DRAW[i]) * (f - i)


def along(arr, dist_arr, d):
    d = min(max(d, dist_arr[0]), dist_arr[-1])
    i = int(np.clip(np.searchsorted(dist_arr, d) - 1, 0, len(dist_arr) - 2))
    span = max(1e-9, dist_arr[i + 1] - dist_arr[i])
    t = (d - dist_arr[i]) / span
    return arr[i] + (arr[i + 1] - arr[i]) * t


def cam_point(d):
    return along(CAM, CAM_D, d)


def route_point(d):
    return along(PTS, DIST, d)


def wp(name):
    return np.array(WP[name]["pos"], dtype=np.float64)


# --------------------------------------------------------------------------
# Camera rail. Each key: s, fixed target (three.js), follow weight (0 = fixed
# target, 1 = the smoothed route spline at the line's head), azimuth (camera
# offset direction, 0 = south of the target, -90 = west), elevation angle,
# distance (units), vertical fov, screen x of the subject (+ = right).
def monotone(keys, x):
    """Fritsch-Carlson monotone cubic (same as route.mjs)."""
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(keys)
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2 for i in range(1, n - 1)] + [d[-1]]
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
            continue
        a, bb = m[i] / d[i], m[i + 1] / d[i]
        hh = a * a + bb * bb
        if hh > 9:
            t = 3 / math.sqrt(hh)
            m[i], m[i + 1] = t * a * d[i], t * bb * d[i]
    i = max(k for k in range(n - 1) if xs[k] <= x)
    h = xs[i + 1] - xs[i]
    t = (x - xs[i]) / h
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]


def mid(*pts, w=None):
    pts = [np.asarray(p, dtype=np.float64) for p in pts]
    w = w or [1.0 / len(pts)] * len(pts)
    return sum(p * k for p, k in zip(pts, w))


AMA = PEAKS["Ama Dablam"]
EVEREST = PEAKS["Everest"]
LHOTSE = PEAKS["Lhotse"]
RANGE_MID = np.array([-20.0, 52.0, -30.0])

# (s, target, follow, az, el, dist, fov, sx)
KEYS = [
    # intro: bird's eye over the whole range, drifting south toward Lukla.
    (0.00, RANGE_MID, 0.0, -18, 52, 430, 36, 0.20),
    (0.45, mid(RANGE_MID, wp("Namche Bazaar")), 0.0, -26, 47, 360, 36, 0.22),
    (0.92, mid(wp("Lukla"), wp("Namche Bazaar")), 0.2, -38, 40, 190, 36, 0.26),
    # values: Lukla -> Namche, low over the Dudh Kosi gorge.
    (1.30, None, 0.9, -52, 34, 118, 35, 0.27),
    (1.62, None, 1.0, -30, 32, 104, 35, 0.27),
    (1.90, wp("Namche Bazaar"), 0.7, -10, 34, 110, 35, 0.27),
    # tools: Tengboche -> Dingboche, orbiting around Ama Dablam.
    (2.20, mid(wp("Tengboche"), AMA, w=[0.72, 0.28]), 0.35, -70, 24, 118, 34, 0.24),
    (2.55, mid(wp("Pangboche"), AMA, w=[0.66, 0.34]), 0.35, -98, 22, 112, 34, 0.24),
    (2.88, mid(wp("Dingboche"), AMA, w=[0.66, 0.34]), 0.35, -136, 23, 116, 34, 0.24),
    # story: Lobuche -> Gorak Shep -> Base Camp -> Icefall -> Western Cwm -> South Col.
    (3.10, mid(wp("Lobuche"), wp("Gorak Shep")), 0.6, -128, 30, 108, 34, 0.26),
    (3.34, mid(wp("Everest Base Camp"), wp("Khumbu Icefall")), 0.7, -104, 30, 96, 34, 0.27),
    (3.62, None, 1.0, -96, 30, 84, 34, 0.27),
    (3.80, None, 1.0, -80, 30, 80, 34, 0.26),
    (3.98, mid(wp("South Col"), EVEREST, LHOTSE), 0.6, -62, 26, 78, 33, 0.25),
    # voices: the summit ridge, a slow orbit from the Western Cwm side to the south.
    (4.25, None, 1.0, -44, 18, 58, 32, 0.25),
    (4.55, None, 1.0, -18, 14, 50, 31, 0.26),
    (4.85, EVEREST, 0.6, 6, 12, 48, 30, 0.26),
    # outro: pull up and away, the whole golden route below.
    (5.20, mid(EVEREST, wp("Gorak Shep")), 0.0, 14, 24, 120, 32, 0.22),
    (5.65, mid(RANGE_MID, EVEREST, w=[0.6, 0.4]), 0.0, 10, 44, 330, 36, 0.18),
    (S_MAX, np.array([-40.0, 48.0, 10.0]), 0.0, 4, 56, 520, 38, 0.14),
]


def rail_frame(s):
    """Camera position, look target (three.js) and fov at chapter time s."""
    ks = KEYS
    par = lambda idx: monotone([(k[0], k[idx]) for k in ks], s)  # noqa: E731
    follow = par(2)
    az, el, dist, fov, sx = par(3), par(4), math.exp(monotone([(k[0], math.log(k[5])) for k in ks], s)), par(6), par(7)
    # Fixed targets: interpolate only between keys that define one.
    fixed = [(k[0], k[1]) for k in ks if k[1] is not None]
    tgt = np.array([monotone([(t, p[c]) for t, p in fixed], s) for c in range(3)])
    head = cam_point(draw_at(s) + 4.0)
    target = tgt * (1 - follow) + head * follow
    a, e = math.radians(az), math.radians(el)
    off = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)])
    pos = target + off * dist
    # Aim left of the subject so it sits right of centre, clear of the text column.
    fwd = (target - pos) / np.linalg.norm(target - pos)
    right = np.cross(fwd, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    half_w = math.tan(math.radians(fov) / 2) * 1.6
    look = target - right * (sx * half_w * dist)
    return pos, look, fov


def rail_samples(step=0.01):
    n = int(round(S_MAX / step)) + 1
    raw = [rail_frame(i * step) for i in range(n)]
    P = np.array([r[0] for r in raw])
    L = np.array([r[1] for r in raw])
    F = np.array([r[2] for r in raw])
    # Final Gaussian pass over time: no kink survives (sigma = 0.03 s).
    sig = 3.0
    rad = int(sig * 3)
    wts = np.exp(-(np.arange(-rad, rad + 1) ** 2) / (2 * sig * sig))
    def blur(A):
        pad = np.concatenate([np.repeat(A[:1], rad, 0), A, np.repeat(A[-1:], rad, 0)])
        return np.array([(pad[i : i + 2 * rad + 1] * wts[:, None]).sum(0) / wts.sum() for i in range(len(A))])
    return [i * step for i in range(n)], blur(P), blur(L), blur(F[:, None])[:, 0]


def build_camera():
    cam = scene.camera(lens=35)
    cam.data.clip_start = 0.5
    cam.data.clip_end = 4000
    ss, P, L, F = rail_samples()
    keys = [{"s": s, "pos": b(P[i]), "look": b(L[i]), "fov": float(F[i])} for i, s in enumerate(ss)]
    rails.key(cam, keys, interpolation="LINEAR")
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written", PUB / "rails.json")


# --------------------------------------------------------------------------
# Stills: baked terrain + haze, the route drawn to s, clouds, sky.
def baked_terrain_object(variant, step=1):
    H = load_dem()
    o = grid_mesh("terrain", H, step=step)
    geo.smooth(o, 180)
    info = json.loads((OUT / f"terrain-{variant}.json").read_text())
    m = bpy.data.materials.new(f"terrain_baked_{variant}")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = mat.image_node(m, OUT / f"terrain-{variant}.png", "sRGB", uv_map="geo")
    gain = math_node(nt, "DIVIDE", 1.0, info["scale"])
    gnode = nt.nodes.new("ShaderNodeCombineColor")
    for k in range(3):
        nt.links.new(gain, gnode.inputs[k])
    col = mix_rgb(nt, 1.0, tex.outputs["Color"], gnode.outputs[0], blend="MULTIPLY")
    # Aerial perspective: exponential haze by view distance, thinner with altitude.
    cd = nt.nodes.new("ShaderNodeCameraData")
    gi = nt.nodes.new("ShaderNodeNewGeometry")
    sz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(gi.outputs["Position"], sz.inputs[0])
    dens = math_node(nt, "MULTIPLY", math_node(nt, "EXPONENT", math_node(nt, "MULTIPLY", sz.outputs["Z"], -0.028)), 0.0045 if variant == "day" else 0.004)
    fog = math_node(nt, "SUBTRACT", 1.0, math_node(nt, "EXPONENT", math_node(nt, "MULTIPLY", math_node(nt, "MULTIPLY", cd.outputs["View Distance"], dens), -1.0)))
    haze = LIGHT[variant]["haze"]
    haze_strength = 1.35 if variant == "day" else 0.5
    col = mix_rgb(nt, fog, col, tuple(c * haze_strength for c in haze))
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(col, em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    mat.assign(o, m)
    return o


def route_tube(s, cam_dist, variant):
    d = draw_at(s)
    k = int(np.searchsorted(DIST, d))
    if k < 2:
        return None
    pts = [b(p) for p in PTS[: k + 1][::2]]
    if len(pts) < 2:
        return None
    r = max(0.08, cam_dist * 0.0022)
    o = geo.tube("route", pts, radius=r, segments=8)
    gold = lin("#ffc247")
    mat.assign(o, mat.emission("route", gold, 9.0 if variant == "day" else 14.0))
    return o


def cloud_layer(variant, seed=0):
    """Valley cloud sheets: noise-cut translucent planes low in the southern valleys."""
    objs = []
    for k, (alt_m, size, off) in enumerate([(3300, 260, (-110, 140)), (3900, 220, (-60, 40)), (4300, 180, (10, -40))]):
        o = geo.primitive("grid", f"cloud{k}", x=2, y=2, size=size)
        o.location = (off[0], -off[1], meters_to_units(alt_m))
        m = bpy.data.materials.new(f"cloud{k}")
        if hasattr(m, "use_nodes"):
            m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.035
        nz.inputs["Detail"].default_value = 8.0
        nz.inputs["Roughness"].default_value = 0.6
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        cut = smoothstep(nt, nz.outputs["Fac"], 0.55, 0.78)
        edge = nt.nodes.new("ShaderNodeTexGradient")
        edge.gradient_type = "SPHERICAL"
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (2.0 / size, 2.0 / size, 1)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        nt.links.new(mp.outputs[0], edge.inputs["Vector"])
        a = math_node(nt, "MULTIPLY", cut, edge.outputs["Fac"])
        a = math_node(nt, "MULTIPLY", a, 0.8)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*(lin("#fff1e2") if variant == "day" else lin("#5c6f96")), 1)
        em.inputs["Strength"].default_value = 1.6 if variant == "day" else 0.35
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(a, mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
        mat.assign(o, m)
        objs.append(o)
    return objs


def headlamps(variant, s):
    """Night: a string of climbers' headlamps between the South Col and the Balcony."""
    if variant != "night":
        return []
    objs = []
    d0, d1 = WP["South Col"]["dist"], WP["The Balcony"]["dist"]
    rng = np.random.default_rng(4)
    em = mat.emission("lamp", lin("#fff2c8"), 60.0)
    for k in range(22):
        d = d0 + (d1 - d0) * (k + rng.uniform(-0.3, 0.3)) / 22
        p = route_point(d) + np.array([0, 0.08, 0])
        o = geo.primitive("ico", f"lamp{k}", subdiv=1, radius=0.12)
        o.location = b(p)
        mat.assign(o, em)
        objs.append(o)
    return objs


def stage(s, variant, step=1):
    scene.reset()
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 64), bounces=2, res=(1920, 1200))
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - High Contrast")
    world_for(variant, stars=True)
    cam = build_camera()
    rails.set_at(s)
    cpos = Vector(cam.matrix_world.translation)
    terrain = baked_terrain_object(variant, step=step)
    bands = {"back": [], "mid": [terrain], "front": []}
    cam_dist = (cpos - Vector(b(rail_frame(s)[1]))).length
    tube = route_tube(s, cam_dist, variant)
    if tube:
        bands["mid"].append(tube)
    bands["mid"] += headlamps(variant, s)
    bands["front"] += cloud_layer(variant)
    return sc, cam, bands, cam_dist


TAGS = [0.3, 1.45, 2.5, 3.5, 4.5, 5.6]


def step_preview():
    for variant in args.variants:
        sc, cam, bands, _ = stage(args.s, variant, step=2)
        sc.render.resolution_x, sc.render.resolution_y = 960, 600
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png")


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        for s in tags:
            sc, cam, bands, cam_dist = stage(s, variant)
            render.layers(cam, s, [("back", bands["back"]), ("mid", bands["mid"]), ("front", bands["front"])], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 3000.0, "mid": cam_dist, "front": cam_dist * 0.7})


def step_pano():
    """360 from 700 m above Gorak Shep, looking at Everest."""
    gs = wp("Gorak Shep")
    loc = Vector(b(gs + np.array([0.0, meters_to_units(700), 0.0])))
    ev = Vector(b(EVEREST))
    yaw = math.degrees(math.atan2(ev.y - loc.y, ev.x - loc.x))
    for variant in args.variants:
        sc, cam, bands, _ = stage(5.0, variant)
        for o in bands["front"]:
            bpy.data.objects.remove(o, do_unlink=True)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, loc, res=(4096, 2048), samples=args.samples or 48, look_yaw_deg=yaw)
        cli.log("pano", variant, png)


# --------------------------------------------------------------------------
def step_mini():
    """The Everest massif as a carved block on a walnut base, gold route to the summit (~6k tris)."""
    scene.reset()
    H = load_dem()
    ev, lh = PEAKS["Everest"], PEAKS["Lhotse"]
    cx, cz = (ev[0] + lh[0]) / 2 - 8, (ev[2] + lh[2]) / 2 + 4
    half = 42.0  # units (4.2 km)
    N = 56
    xs = np.linspace(cx - half, cx + half, N)
    zs = np.linspace(cz - half, cz + half, N)
    base_m = 5000.0
    scale = 1.0 / meters_to_units(8849 - base_m) * 0.78  # summit about 0.78 above the block floor

    def height_at(x, z):
        e = x * UNIT + META["ec"]
        n = -z * UNIT + META["nc"]
        fx = np.clip((e - META["e0"]) / META["dx"], 0, META["nx"] - 1.001)
        fy = np.clip((META["n1"] - n) / META["dx"], 0, META["ny"] - 1.001)
        x0, y0 = int(fx), int(fy)
        u, v = fx - x0, fy - y0
        h = (H[y0, x0] * (1 - u) + H[y0, x0 + 1] * u) * (1 - v) + (H[y0 + 1, x0] * (1 - u) + H[y0 + 1, x0 + 1] * u) * v
        return max(h, base_m + 150)

    def to_mini(x, h, z):
        # Blender coords of the miniature: centered, floor at z = 0.12 (on the base).
        return ((x - cx) * scale, -(z - cz) * scale, 0.12 + meters_to_units(h - base_m) * scale)

    import bmesh

    bm = bmesh.new()
    top = [[bm.verts.new(to_mini(x, height_at(x, z), z)) for x in xs] for z in zs]
    cols = bm.loops.layers.color.new("Color")
    for j in range(N - 1):
        for i in range(N - 1):
            bm.faces.new((top[j][i], top[j + 1][i], top[j + 1][i + 1], top[j][i + 1]))
    # Side walls down to the block floor.
    ring = [top[0][i] for i in range(N)] + [top[j][N - 1] for j in range(1, N)] + [top[N - 1][i] for i in range(N - 2, -1, -1)] + [top[j][0] for j in range(N - 2, 0, -1)]
    low = [bm.verts.new((v.co.x, v.co.y, 0.12)) for v in ring]
    for k in range(len(ring)):
        a, c = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((a, low[k], low[(k + 1) % len(ring)], c))
    bm.faces.new(list(reversed(low)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    snow, rock, strata = lin("#f3f5fa"), lin("#4a4038"), lin("#8b6f55")
    for f in bm.faces:
        for lp in f.loops:
            z = lp.vert.co.z
            nz = f.normal.z
            if abs(nz) < 0.2 or z <= 0.121:
                band = 0.5 + 0.5 * math.sin(z * 90.0)
                c = tuple(strata[k] * (0.75 + 0.25 * band) for k in range(3))
            else:
                snowy = max(0.0, min(1.0, (nz - 0.55) / 0.25)) * max(0.0, min(1.0, (z - 0.35) / 0.2))
                c = tuple(rock[k] + (snow[k] - rock[k]) * snowy for k in range(3))
            lp[cols] = (*c, 1.0)
    block = geo.obj_from_bmesh("mini_block", bm)
    geo.smooth(block, 35)
    mat.assign(block, mat.principled("mini_terrain", base=(1, 1, 1), rough=0.62, sheen=0.25))
    block.data.color_attributes.active_color = block.data.color_attributes["Color"]
    # Walnut plinth.
    w = (xs[-1] - xs[0]) * scale * 1.12
    base = geo.primitive("cube", "mini_base", size=1.0)
    base.scale = (w, w, 0.12)
    base.location = (0, 0, 0.06)
    geo.set_origin_world(base)
    geo.bevel(base, width=0.02, segments=3)
    geo.apply_all(base)
    mat.assign(base, mat.principled("walnut", base=lin("#4a2f1f"), rough=0.35, coat=0.6, coat_rough=0.2))
    # Gold route from Camp II to the summit, draped on the block.
    pts = []
    for d in np.linspace(WP["Camp II"]["dist"], WP["Summit"]["dist"], 70):
        p = route_point(d)
        if abs(p[0] - cx) > half or abs(p[2] - cz) > half:
            continue
        pts.append(Vector(to_mini(p[0], height_at(p[0], p[2]) + 60, p[2])))
    parts = [block, base]
    if len(pts) > 2:
        tube = geo.tube("mini_route", pts, radius=0.012, segments=6)
        mat.assign(tube, mat.principled("gold", base=lin("#ffc247"), metal=1.0, rough=0.22, emission=lin("#ffb020"), emission_strength=0.6))
        parts.append(tube)
        flag = geo.primitive("ico", "mini_summit", subdiv=2, radius=0.028)
        flag.location = pts[-1]
        mat.assign(flag, mat.emission("summit_glow", lin("#ffd66e"), 4.0))
        parts.append(flag)
    tris = sum(geo.triangle_count(p) for p in parts)
    cli.log("mini", tris, "tris, width", round(w, 3))
    export.glb(OUT / "mini.glb", parts)


STEPS = {
    "terrain": step_terrain,
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
