"""Inflatable speech bubbles drifting in a pastel sky (homepage testimonials).

Steps (run with --steps a,b,...):
  shapes    inflate bubble + glyph shapes (cloth pressure) -> art/out/bubbles/shapes/*.blend
  clouds    puffy clouds: meshes -> shapes/clouds.blend, plus Cycles cloud cards (day/night RGBA)
  export    runtime: hi/bubbles.glb (shapes at origin) + hi/layout.json (bubbles, glyphs, clouds)
  rail      camera rail -> rails.json (rail time = scene s + RAIL_OFFSET)
  preview   quick Cycles still at --s (scene time)
  layers    Low Resources depth layers + posters (day/night)
  pano      4096x2048 equirect from inside the flock
  mini      one speech bubble on a clay base -> lo/mini.glb

Blender coordinates: meters, Z up. The flock is a loose column around the
axis (0, 10); the camera orbits it while floating up.

The homepage fades this scene in over s in [-0.22, 0.08], so the rail is
authored from s = -0.2: the runtime samples it at s + RAIL_OFFSET.
"""

import json
import math
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "garden"))

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import toy  # noqa: E402
from ddd import cli, export, geo, mat, rails, render, scene  # noqa: E402
from toy import lin  # noqa: E402

SCENE_ID = "bubbles"
RAIL_OFFSET = 0.2
S_MAX = 1.4  # rail time; scene s in [-0.2, 1.2]
HDRI = cli.CACHE / "polyhaven" / "hdri" / "studio_small_09" / "studio_small_09_2k.hdr"
AXIS = Vector((0.0, 10.0, 0.0))


def extra_args(p):
    p.add_argument("--s", default="0.3")
    p.add_argument("--tags", default="")
    p.add_argument("--only", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
SHAPES = OUT / "shapes"

# Kept in sync with src/worlds/scenes/bubbles/palette.ts
PAL = {
    "day": {
        "vinyl": {"pink": "#ff8fbd", "blue": "#8fb0ff", "butter": "#ffd66e", "lilac": "#c3a6ff", "mint": "#8fe0bd", "white": "#f6f2ff", "chrome": "#ffffff"},
        "sky": [(0.0, "#ffe6c9"), (0.35, "#ffd6cf"), (0.5, "#ffcfe3"), (0.65, "#e1cdff"), (0.82, "#b9c9ff"), (1.0, "#9bb5ff")],
        "cloud": "#fff8fb",
        "cloud_shadow": "#f0c9e6",
    },
    "night": {
        "vinyl": {"pink": "#ff7fb8", "blue": "#7f9dff", "butter": "#ffcc5c", "lilac": "#b28cff", "mint": "#6fe0b0", "white": "#efe8ff", "chrome": "#ffffff"},
        "sky": [(0.0, "#1a0f33"), (0.3, "#3b1d52"), (0.44, "#7a3b74"), (0.5, "#4a2a6e"), (0.62, "#1e1b4d"), (1.0, "#060a22")],
        "cloud": "#7c6aa8",
        "cloud_shadow": "#2a2250",
    },
}


def c(variant, key):
    return lin(PAL[variant]["vinyl"][key])


# --------------------------------------------------------------------------
# Shapes
BUBBLES = {
    # name: (outline kwargs, thickness, bevel)
    "round": (dict(a=1.0, b=0.8, p=2.3, tail=(-0.62, -1.18), tail_at=-0.66, tail_w=0.32), 0.62, 0.26),
    "pill": (dict(a=1.35, b=0.66, p=4.2, tail=(0.78, -1.28), tail_at=-0.36, tail_w=0.22), 0.6, 0.25),
    "square": (dict(a=1.0, b=0.9, p=5.5, tail=(-0.95, -1.25), tail_at=-0.72, tail_w=0.2), 0.62, 0.26),
}


def bubble_shape(name, key):
    kw, thick, bev = BUBBLES[key]
    o = toy.slab(name, [toy.speech_outline(**kw)], thickness=thick, bevel=bev)
    toy.puff(o, voxel=0.028, pressure=4.2, frames=26, stiffness=11.0)
    toy.seam(o, depth=0.03, width=0.03, axis=1, center=0.0)
    toy.droop(o, amount=0.05)
    toy.center(o)
    toy.decimate_to(o, 12000)
    return o


def glyph_shape(name, key):
    if key == "heart":
        o = toy.slab(name, [toy.heart_outline(0.42)], thickness=0.2, bevel=0.09)
        toy.puff(o, voxel=0.012, pressure=4.0, frames=22, stiffness=12.0)
        toy.seam(o, depth=0.012, width=0.012, axis=1, center=0.0)
    elif key == "star":
        o = toy.slab(name, [toy.star_outline(5, 0.42, 0.21, 1.3)], thickness=0.18, bevel=0.08)
        toy.puff(o, voxel=0.012, pressure=4.0, frames=22, stiffness=12.0)
        toy.seam(o, depth=0.012, width=0.012, axis=1, center=0.0)
    elif key == "dots":
        parts = []
        for k in range(3):
            d = geo.primitive("ico", f"{name}_{k}", subdiv=4, radius=0.15)
            d.data.transform(Matrix.Diagonal((1.0, 0.62, 1.0, 1.0)))
            d.location = ((k - 1) * 0.4, 0, 0)
            parts.append(d)
        o = geo.join(parts, name)
        geo.smooth(o, 180)
    else:
        raise ValueError(key)
    toy.center(o)
    toy.decimate_to(o, 3000)
    return o


def front_depth(o):
    """Blender -Y extent of the bubble's face near its centre (where glyphs sit)."""
    ys = [v.co.y for v in o.data.vertices if abs(v.co.x) < 0.25 and abs(v.co.z) < 0.25]
    return -min(ys) if ys else 0.3


def step_shapes():
    scene.reset()
    SHAPES.mkdir(parents=True, exist_ok=True)
    only = set(args.only.split(",")) if args.only else None
    for key in BUBBLES:
        name = f"bubble_{key}"
        if only and name not in only:
            continue
        o = bubble_shape(name, key)
        o["front"] = front_depth(o)
        o["kind"] = "bubble"
        bpy.data.libraries.write(str(SHAPES / f"{name}.blend"), {o}, fake_user=True)
        cli.log("bubble", key, geo.triangle_count(o), "tris", "front", round(o["front"], 3), "dims", [round(x, 2) for x in o.dimensions])
    for key in ("heart", "star", "dots"):
        name = f"glyph_{key}"
        if only and name not in only:
            continue
        o = glyph_shape(name, key)
        o["kind"] = "glyph"
        bpy.data.libraries.write(str(SHAPES / f"{name}.blend"), {o}, fake_user=True)
        cli.log("glyph", key, geo.triangle_count(o), "tris")


def load_shape(name):
    with bpy.data.libraries.load(str(SHAPES / f"{name}.blend")) as (src, dst):
        dst.objects = list(src.objects)
    return [o for o in dst.objects if o is not None][0]


# --------------------------------------------------------------------------
# Clouds: puffy cotton clusters (metaballs), a cute match for the vinyl.
CLOUDS = 4


def cloud_mesh(k):
    """Cartoon cumulus: a flat-bottomed row of small puffs under a crown of big
    round lobes, with little cauliflower bumps between them."""
    rnd = random.Random(100 + k)
    mb = bpy.data.metaballs.new(f"cloud_{k}_mb")
    mb.resolution = 0.05
    mb.render_resolution = 0.05
    mb.threshold = 0.6
    w = [3.2, 4.2, 2.6, 5.0][k]
    crown = [3, 4, 3, 5][k]

    def ball(co, r, stiff=2.0):
        e = mb.elements.new()
        e.co = co
        e.radius = r
        e.stiffness = stiff

    base = max(4, int(w / 0.5))
    for i in range(base):
        t = i / (base - 1)
        ball(((t - 0.5) * w * 0.9, rnd.uniform(-0.2, 0.2), 0.0), 0.48 + 0.32 * math.sin(t * math.pi))
    tops = []
    for i in range(crown):
        t = (i + 0.5) / crown + rnd.uniform(-0.06, 0.06)
        bump = math.sin(t * math.pi)
        r = 0.55 + bump * rnd.uniform(0.45, 0.75)
        p = ((t - 0.5) * w * 0.82, rnd.uniform(-0.15, 0.15), 0.2 + r * 0.72)
        ball(p, r, 2.6)
        tops.append((p, r))
    for (p, r), (q, s) in zip(tops, tops[1:]):
        # Small puffs in the saddles between crown lobes.
        m = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 0.25, max(p[2], q[2]) - 0.05)
        ball(m, min(r, s) * 0.62, 3.0)
    for (p, r) in tops:
        for _ in range(2):
            a = rnd.uniform(0.35, 2.8)
            ball((p[0] + math.cos(a) * r * 0.62, p[1] - r * 0.35, p[2] + math.sin(a) * r * 0.55), r * rnd.uniform(0.34, 0.46), 3.0)
    ob = bpy.data.objects.new(f"cloud_{k}_tmp", mb)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob, do_unlink=True)
    o = bpy.data.objects.new(f"cloud_{k}", me)
    bpy.context.scene.collection.objects.link(o)
    # Flatten the underside.
    zs = [v.co.z for v in o.data.vertices]
    floor = min(zs) + (max(zs) - min(zs)) * 0.16
    for v in o.data.vertices:
        if v.co.z < floor:
            v.co.z = floor + (v.co.z - floor) * 0.2
    toy.relax(o, 2, 0.4)
    geo.smooth(o, 180)
    toy.center(o)
    return o


def cloud_material(variant):
    night = variant == "night"
    m = mat.principled(f"cloud_{variant}", base=lin(PAL[variant]["cloud"]), rough=0.85, sheen=0.4, sheen_rough=0.6, subsurface=0.2, subsurface_scale=0.5, specular=0.2)
    mat.bsdf_of(m).inputs["Subsurface Radius"].default_value = (1.0, 0.75, 0.85) if not night else (0.7, 0.75, 1.0)
    return m


def cloud_lights(variant):
    if variant == "day":
        # Key from the upper right (not from the camera, or the lobes flatten out) + a warm back rim.
        scene.sun_light("sun", rot_deg=(50, 0, 51), strength=3.4, color=(1.0, 0.95, 0.9), angle_deg=6)
        scene.sun_light("rim", rot_deg=(60, 0, 157), strength=2.0, color=(1.0, 0.82, 0.9), angle_deg=10)
    else:
        # Cool moonlight on the crowns from the upper left, dusk pink on the bellies.
        scene.sun_light("moon", rot_deg=(45, 0, -50), strength=2.6, color=(0.72, 0.76, 1.0), angle_deg=5)
        scene.sun_light("dusk", rot_deg=(150, 0, 0), strength=2.2, color=(1.0, 0.45, 0.72), angle_deg=20)
        scene.sun_light("rim", rot_deg=(60, 0, 157), strength=2.5, color=(1.0, 0.6, 0.85), angle_deg=10)


def step_clouds():
    scene.reset()
    SHAPES.mkdir(parents=True, exist_ok=True)
    objs = [cloud_mesh(k) for k in range(CLOUDS)]
    bpy.data.libraries.write(str(SHAPES / "clouds.blend"), set(objs), fake_user=True)
    cards = []
    for variant in args.variants:
        for k in range(CLOUDS):
            scene.reset()
            sc = scene.cycles(samples=args.samples or 64, bounces=6, transparent=True, res=(1024, 512))
            scene.view("Khronos PBR Neutral", exposure=0.0 if variant == "day" else 0.3)
            stops = [(p, lin(h)) for p, h in PAL[variant]["sky"]]
            toy.gradient_world(stops, strength=0.9 if variant == "day" else 0.7)
            with bpy.data.libraries.load(str(SHAPES / "clouds.blend")) as (src, dst):
                dst.objects = [n for n in src.objects if n == f"cloud_{k}"]
            o = dst.objects[0]
            bpy.context.scene.collection.objects.link(o)
            mat.assign(o, cloud_material(variant))
            cloud_lights(variant)
            dims = o.dimensions
            cam = scene.camera(lens=50)
            cam.data.type = "ORTHO"
            w = dims.x * 1.08
            h = dims.z * 1.15
            sc.render.resolution_x = 1024
            sc.render.resolution_y = max(128, int(round(1024 * h / w)))
            cam.data.sensor_fit = "HORIZONTAL"
            cam.data.ortho_scale = w
            cam.location = (0, -20, 0)
            cam.rotation_euler = (math.radians(90), 0, 0)
            png = OUT / "clouds" / f"cloud-{variant}-{k}.png"
            png.parent.mkdir(parents=True, exist_ok=True)
            render.still(png)
            cards.append({"k": k, "variant": variant, "w": round(w, 3), "h": round(h, 3)})
    (OUT / "clouds" / "cards.json").write_text(json.dumps(cards))


def load_clouds():
    with bpy.data.libraries.load(str(SHAPES / "clouds.blend")) as (src, dst):
        dst.objects = list(src.objects)
    out = {}
    for o in dst.objects:
        if o is not None:
            out[o.name] = o
    return out


# --------------------------------------------------------------------------
# Layout (deterministic). Blender coords.
SHAPE_KEYS = ["round", "pill", "square"]
COLORS = ["pink", "blue", "butter", "lilac", "mint", "white"]
GLYPH_FOR = {"pink": ("heart", "white"), "blue": ("star", "butter"), "butter": ("dots", "white"), "lilac": ("heart", "chrome"), "mint": ("dots", "white"), "white": ("star", "pink")}


def rail_path(n=140):
    """Camera positions along the rail (linear between keys is close enough for clearance)."""
    keys = rail_keys()
    out = []
    for i in range(n + 1):
        s = keys[-1]["s"] * i / n
        k = max(j for j in range(len(keys)) if keys[j]["s"] <= s + 1e-9)
        a, b = keys[k], keys[min(k + 1, len(keys) - 1)]
        t = 0.0 if a is b else (s - a["s"]) / (b["s"] - a["s"])
        out.append(Vector(a["pos"]).lerp(Vector(b["pos"]), t))
    return out


def clear_of_rail(pos, clearance):
    """Nudge a bubble sideways until it's at least `clearance` from the camera path."""
    pos = Vector(pos)
    for p in rail_path():
        d = pos - p
        dist = d.length
        if dist < clearance:
            side = Vector((d.x, d.y, 0.0))
            if side.length < 1e-3:
                side = Vector((AXIS.x - p.x, AXIS.y - p.y, 0.0))
            pos += side.normalized() * (clearance - dist)
    return pos


def layout():
    rnd = random.Random(7)
    path = rail_path()
    bubbles = []
    n = 30
    for i in range(n):
        z = -3.5 + i * (23.0 / n) + rnd.uniform(-0.5, 0.5)
        ang = i * 2.39996 + rnd.uniform(-0.3, 0.3)  # golden-angle spiral around the axis
        r = 2.0 + 6.5 * math.sqrt(rnd.random())
        pos = AXIS + Vector((math.cos(ang) * r, math.sin(ang) * r, z))
        shape = SHAPE_KEYS[i % 3]
        color = COLORS[(i * 5 + 1) % len(COLORS)]
        sc = rnd.uniform(0.62, 1.15)
        pos = clear_of_rail(pos, 4.6 + 1.6 * sc)
        # Face (-Y local) the camera where it passes closest, with a playful tilt.
        near = min(path, key=lambda p: (p - pos).length)
        yaw = math.degrees(math.atan2(near.x - pos.x, -(near.y - pos.y))) + rnd.uniform(-22, 22)
        rot = (rnd.uniform(-10, 10), rnd.uniform(-14, 14), yaw)
        mirror = rnd.random() < 0.5
        glyph = None
        if rnd.random() < 0.62:
            g, gc = GLYPH_FOR[color]
            glyph = {"shape": g, "color": gc}
        bubbles.append({"shape": shape, "color": color, "pos": tuple(pos), "rot": rot, "scale": sc, "mirror": mirror, "glyph": glyph})
    clouds = []
    for i in range(16):
        z = -8 + i * 2.2 + rnd.uniform(-1, 1)
        ang = rnd.uniform(0, 2 * math.pi)
        r = rnd.uniform(16, 34)
        pos = AXIS + Vector((math.cos(ang) * r, math.sin(ang) * r, z))
        clouds.append({"k": i % CLOUDS, "pos": tuple(pos), "scale": rnd.uniform(1.4, 3.2)})
    return bubbles, clouds


def to_three(v):
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


_Z2Y = Matrix.Rotation(-math.pi / 2, 4, "X")


def three_matrix(m):
    """Blender world matrix -> three.js world matrix (column-major, for Matrix4.fromArray)."""
    t = _Z2Y @ m @ _Z2Y.inverted()
    return [round(t[r][col], 5) for col in range(4) for r in range(4)]


def bubble_matrix(b):
    s = b["scale"]
    return Matrix.LocRotScale(Vector(b["pos"]), Euler([math.radians(a) for a in b["rot"]]), Vector((-s if b["mirror"] else s, s, s)))


# --------------------------------------------------------------------------
# Staging
def bubble_material(variant, color):
    night = variant == "night"
    if color == "chrome":
        return toy.chrome(f"chrome_{variant}", rough=0.05)
    col = c(variant, color)
    if night:
        # Lit from within: a saturated glow face-on (squared color keeps AgX from bleaching
        # the pastels) and a pale neon halo at the silhouette.
        glow = tuple(x**1.6 for x in col)
        rim = tuple(min(1.0, x * 1.2 + 0.15) for x in col)
        return toy.vinyl(f"vinyl_{color}_{variant}", col, rough=0.24, night_rim=rim, rim_strength=2.4, inner=glow, inner_strength=0.75)
    return toy.vinyl(f"vinyl_{color}_{variant}", col, rough=0.28)


def stage(variant, samples=None):
    scene.reset()
    night = variant == "night"
    sc = scene.cycles(samples=samples or args.samples or (24 if args.preview else 64), bounces=6, res=(1920, 1200))
    if night:
        scene.view("AgX", look="AgX - Medium High Contrast", exposure=0.25)
    else:
        scene.view("Khronos PBR Neutral", exposure=0.1)
    stops = [(p, lin(h)) for p, h in PAL[variant]["sky"]]
    toy.gradient_world(stops, strength=1.0, stars=6.0 if night else 0.0, hdri=HDRI if HDRI.exists() else None, hdri_strength=0.5 if not night else 0.06, hdri_rot=30)
    if not night:
        scene.area_light("key", (14, -6, 22), rot_deg=(40, 0, 60), size=10.0, power=9000, color=(1.0, 0.95, 0.9))
        scene.area_light("fill", (-14, -2, 8), rot_deg=(70, 0, -70), size=10.0, power=2600, color=(0.86, 0.9, 1.0))
        scene.area_light("bounce", (0, 26, -6), rot_deg=(-60, 0, 180), size=16.0, power=2400, color=(1.0, 0.78, 0.86))
    else:
        scene.area_light("moon", (-12, -4, 26), rot_deg=(25, 0, -60), size=10.0, power=900, color=(0.62, 0.68, 1.0))
        scene.area_light("dusk", (0, 34, -8), rot_deg=(-80, 0, 180), size=20.0, power=2200, color=(1.0, 0.45, 0.62))
    bubbles, clouds = layout()
    objs = []
    shapes = {k: load_shape(f"bubble_{k}") for k in SHAPE_KEYS}
    glyphs = {k: load_shape(f"glyph_{k}") for k in ("heart", "star", "dots")}
    for src in list(shapes.values()) + list(glyphs.values()):
        bpy.context.scene.collection.objects.link(src)
        src.hide_render = True
    mats = {}
    for i, b in enumerate(bubbles):
        src = shapes[b["shape"]]
        o = bpy.data.objects.new(f"b{i}", src.data)
        bpy.context.scene.collection.objects.link(o)
        o.matrix_world = bubble_matrix(b)
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = "OBJECT"
        key = (b["color"],)
        mats.setdefault(key, bubble_material(variant, b["color"]))
        o.material_slots[0].material = mats[key]
        objs.append(o)
        if b["glyph"]:
            g = glyphs[b["glyph"]["shape"]]
            go = bpy.data.objects.new(f"g{i}", g.data)
            bpy.context.scene.collection.objects.link(go)
            go.parent = o
            go.matrix_parent_inverse = Matrix.Identity(4)
            go.location = (0, -src["front"] + 0.04, 0.02)
            go.scale = (-1 if b["mirror"] else 1, 1, 1)
            if not go.material_slots:
                go.data.materials.append(None)
            go.material_slots[0].link = "OBJECT"
            gk = ("glyph", b["glyph"]["color"])
            if gk not in mats:
                mats[gk] = toy.chrome(f"gchrome_{variant}") if b["glyph"]["color"] == "chrome" else toy.vinyl(f"glyph_{b['glyph']['color']}_{variant}", c(variant, b["glyph"]["color"]), rough=0.18, night_rim=None, inner=c(variant, b["glyph"]["color"]) if night else None, inner_strength=2.5, rim_strength=2.5)
            go.material_slots[0].material = mats[gk]
            objs.append(go)
    cl = load_clouds()
    cmat = cloud_material(variant)
    cloud_objs = []
    for i, cd in enumerate(clouds):
        src = cl[f"cloud_{cd['k']}"]
        o = bpy.data.objects.new(f"c{i}", src.data)
        bpy.context.scene.collection.objects.link(o)
        # Clouds face the flock's axis (cards at runtime are cylindrical billboards).
        yaw = math.atan2(cd["pos"][1] - AXIS.y, cd["pos"][0] - AXIS.x) + math.pi / 2
        o.matrix_world = Matrix.LocRotScale(Vector(cd["pos"]), Euler((0, 0, yaw)), Vector((cd["scale"],) * 3))
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = cmat
        cloud_objs.append(o)
    for src in list(shapes.values()) + list(glyphs.values()) + list(cl.values()):
        if src.name in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.unlink(src)
    cam = build_camera()
    return sc, cam, {"objs": objs, "clouds": cloud_objs}


# --------------------------------------------------------------------------
# Rail: orbit the flock while floating up. Keys in rail time (scene s + 0.2).
KEYS = [
    # rail s, orbit deg (0 = camera at -Y of the axis), radius, cam z, look z, fov
    (0.00, -28, 13.0, -2.0, 0.0, 46),
    (0.35, -16, 12.0, 2.2, 3.8, 46),
    (0.70, -2, 11.0, 7.0, 8.6, 44),
    (1.05, 12, 11.5, 12.0, 13.2, 44),
    (1.40, 24, 12.5, 16.5, 17.0, 46),
]


def rail_keys():
    out = []
    for s, orb, r, cz, lz, fov in KEYS:
        a = math.radians(orb - 90)
        pos = AXIS + Vector((math.cos(a) * r, math.sin(a) * r, cz))
        to_axis = (AXIS + Vector((0, 0, lz)) - pos)
        right = to_axis.cross(Vector((0, 0, 1))).normalized()
        # Aim a little left of the axis so the flock's heart sits right of centre.
        look = AXIS + Vector((0, 0, lz)) - right * 2.2
        out.append({"s": s, "pos": tuple(pos), "look": tuple(look), "fov": fov, "roll": 0.0})
    return out


def build_camera():
    cam = scene.camera(lens=35)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 800
    rails.key(cam, rail_keys())
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written")


# --------------------------------------------------------------------------
def step_export():
    scene.reset()
    objs = []
    for k in SHAPE_KEYS:
        o = load_shape(f"bubble_{k}")
        bpy.context.scene.collection.objects.link(o)
        export.tag(o, kind="bubble", front=o["front"])
        objs.append(o)
    for k in ("heart", "star", "dots"):
        o = load_shape(f"glyph_{k}")
        bpy.context.scene.collection.objects.link(o)
        export.tag(o, kind="glyph")
        objs.append(o)
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat.principled(f"m_{o.name}", base=(0.9, 0.9, 0.9), rough=0.3))
    export.glb(OUT / "bubbles.glb", objs, export_vertex_color="NONE")
    bubbles, clouds = layout()
    cards = json.loads((OUT / "clouds" / "cards.json").read_text()) if (OUT / "clouds" / "cards.json").exists() else []
    card_size = {cd["k"]: [cd["w"], cd["h"]] for cd in cards}
    data = {
        "railOffset": RAIL_OFFSET,
        "axis": to_three(AXIS),
        "bubbles": [
            {
                "shape": b["shape"],
                "color": b["color"],
                "pos": to_three(b["pos"]),
                "matrix": three_matrix(bubble_matrix(b)),
                "mirror": b["mirror"],
                "glyph": b["glyph"],
                "front": round(float(load_front(b["shape"])), 4),
            }
            for b in bubbles
        ],
        "clouds": [{"k": cd["k"], "pos": to_three(cd["pos"]), "scale": round(cd["scale"], 3), "size": card_size.get(cd["k"], [4, 2])} for cd in clouds],
    }
    (PUB / "hi" / "layout.json").write_text(json.dumps(data))
    path = rail_path()
    near = min(min((Vector(b["pos"]) - p).length for p in path) for b in bubbles)
    cli.log("layout written", len(data["bubbles"]), "bubbles", len(data["clouds"]), "clouds; closest bubble to the rail", round(near, 2), "m")


_fronts = {}


def load_front(shape):
    if shape not in _fronts:
        o = load_shape(f"bubble_{shape}")
        _fronts[shape] = o["front"]
    return _fronts[shape]


def step_preview():
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        if not args.samples:
            sc.render.resolution_percentage = 50
        for s in [float(x) for x in args.s.split(",")]:
            rails.set_at(s + RAIL_OFFSET)
            render.still(OUT / f"preview-{variant}-{s:.2f}.png")


TAGS = [0.0, 0.5, 1.0]


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        for s in tags:
            rails.set_at(s + RAIL_OFFSET)
            bpy.context.view_layer.update()
            cpos = cam.matrix_world.translation
            fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
            back, mid = list(parts["clouds"]), []
            for o in parts["objs"]:
                if o.parent is not None:
                    continue
                band = mid if (o.matrix_world.translation - cpos).dot(fwd) < 13.5 else back
                band.append(o)
                band.extend(o.children)
            tag = f"{variant}-s{int(round(s * 100)):03d}"
            info = render.layers(cam, s + RAIL_OFFSET, [("back", back), ("mid", mid)], OUT / "layers", tag, samples=sc.cycles.samples, depths={"back": 26.0})
            # Manifests carry scene time; the rail is sampled at s + RAIL_OFFSET.
            info["s"] = s
            (OUT / "layers" / f"{tag}.json").write_text(json.dumps(info, indent=1))


def step_pano():
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, AXIS + Vector((0.0, -6.0, 6.0)), res=(4096, 2048), samples=args.samples or 48, look_yaw_deg=90)
        cli.log("pano", variant, png)


def step_mini():
    """One pink speech bubble with a white heart, standing on a clay base."""
    scene.reset()
    kw, thick, bev = BUBBLES["round"]
    b = toy.slab("mini_bubble", [toy.speech_outline(**kw)], thickness=thick, bevel=bev)
    b.data.transform(Matrix.Scale(0.36, 4))
    toy.puff(b, voxel=0.011, pressure=4.2, frames=26, stiffness=11.0)
    toy.seam(b, depth=0.011, width=0.011, axis=1, center=0.0)
    toy.center(b)
    toy.decimate_to(b, 4200)
    front = front_depth(b)
    mat.assign(b, toy.vinyl("mini_bubble", c("day", "pink"), rough=0.25))
    h = toy.slab("mini_heart", [toy.heart_outline(0.14)], thickness=0.07, bevel=0.03)
    toy.puff(h, voxel=0.006, pressure=4.0, frames=20, stiffness=12.0)
    toy.center(h)
    toy.decimate_to(h, 1200)
    h.data.transform(Matrix.Translation((0, -front + 0.015, 0.01)))
    mat.assign(h, toy.vinyl("mini_heart", c("day", "white"), rough=0.2))
    top = geo.join([b, h], "mini_top")
    lo_z = min(v.co.z for v in top.data.vertices)
    top.data.transform(Matrix.Translation((0, 0, 0.16 - lo_z)))
    base = toy.plinth("mini_base", radius=0.34, height=0.14, steps=2, step_in=0.07, segments=64, bevel=0.012)
    for v in base.data.vertices:
        v.co.z = max(0.0, v.co.z)
    mat.assign(base, mat.principled("mini_clay", base=lin("#f3e6dc"), rough=0.7, sheen=0.3))
    # A short stem so the bubble "floats" above its base.
    stem = geo.primitive("cylinder", "mini_stem", radius=0.02, depth=0.08, segments=16)
    stem.location = (0, 0, 0.16)
    mat.assign(stem, toy.chrome("mini_stem"))
    o = geo.join([top, base, stem], "mini_bubbles")
    geo.smooth(o, 50)
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 2) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "shapes": step_shapes,
    "clouds": step_clouds,
    "export": step_export,
    "rail": step_rail,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview",) or "preview" in args.steps):
        fn()
