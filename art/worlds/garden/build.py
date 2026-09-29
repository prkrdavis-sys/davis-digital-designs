"""Sculpture garden on a mirror pool (homepage hero).

Steps (run with --steps a,b,...):
  shapes    inflate the sculptures (cloth pressure) -> art/out/garden/shapes.blend
  bake      stage day/night, bake GI onto the clay plinths/steps -> plinths-<variant>
  export    runtime GLBs: garden.glb (sculptures, named, with extras) + plinths-<variant>.glb
  rail      camera rail -> rails.json
  preview   quick Cycles still at --s (half res unless --samples)
  layers    Low Resources depth layers + posters (day/night)
  pano      4096x2048 equirect from the middle of the garden
  mini      inflatable star on a clay base -> lo/mini.glb

Blender coordinates: meters, Z up, the pool surface is z = 0 and the camera
pushes along +Y. Runtime placement comes from the GLB node transforms and
the `pivot` extras, so this file is the single source of layout.
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import toy  # noqa: E402
from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402
from toy import lin  # noqa: E402

SCENE_ID = "garden"
S_MAX = 1.2
HDRI = cli.CACHE / "polyhaven" / "hdri" / "studio_small_09" / "studio_small_09_2k.hdr"


def extra_args(p):
    p.add_argument("--s", default="0.0")
    p.add_argument("--tags", default="")
    p.add_argument("--only", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
SHAPES = OUT / "shapes"

# --------------------------------------------------------------------------
# Palette (kept in sync with src/worlds/scenes/garden/palette.ts)
PAL = {
    "day": {
        "star": "#ffcf4d",
        "d": "#ff7fb2",
        "arch": "#8fb0ff",
        "torus": "#c4a4ff",
        "blob": "#ff9f86",
        "pill_a": "#8fe0bd",
        "pill_b": "#ff9cc2",
        "pill_c": "#ffe08f",
        "mini_star": "#ffcf4d",
        "clay": "#f3e6dc",
        "clay_b": "#f7d9df",
        "water": "#8795e0",
        "glass": "#f4eaff",
        "sky": [(0.0, "#ffd7c2"), (0.5, "#ffd9c9"), (0.54, "#ffc9df"), (0.66, "#e3c4ff"), (0.8, "#b5c3ff"), (1.0, "#8fa8ff")],
    },
    "night": {
        "star": "#ffcf4d",
        "d": "#ff6fae",
        "arch": "#7f9dff",
        "torus": "#b996ff",
        "blob": "#ff8f7a",
        "pill_a": "#6fe0b0",
        "pill_b": "#ff8fc0",
        "pill_c": "#ffd76f",
        "mini_star": "#ffcf4d",
        "clay": "#8c86a8",
        "clay_b": "#9a86a8",
        "water": "#0d0c1f",
        "glass": "#e9e4ff",
        "sky": [(0.0, "#07061a"), (0.5, "#1c1440"), (0.53, "#3a2160"), (0.62, "#1d1a4a"), (1.0, "#05071a")],
        "rim": {"star": "#ffe9a0", "d": "#ff9cd0", "arch": "#9fc0ff", "torus": "#dcb8ff", "blob": "#ffb49c", "pill_a": "#a8ffd8", "pill_b": "#ffb3dc", "pill_c": "#fff0a8"},
    },
}


def c(variant, key):
    return lin(PAL[variant][key])


# --------------------------------------------------------------------------
# Layout. kind: vinyl | chrome | glass | clay. `rest` = sits on something (no bob).
# pos/rot in Blender coords; rot in degrees (XYZ).
SCULPTURES = [
    # name,        shape,     kind,     color,    pos,                  rot,             scale, rest
    ("star", "star", "vinyl", "star", (2.9, -4.2, 2.75), (4, 8, -14), 1.0, False),
    ("blob", "blob", "vinyl", "blob", (1.05, -7.4, 0.0), (0, 0, 20), 1.0, True),
    ("pills", "pills", "vinyl", None, (5.4, -1.2, 1.05), (0, 0, -24), 1.0, True),
    ("arch", "arch", "vinyl", "arch", (0.35, 3.0, 0.0), (0, 0, 4), 1.0, True),
    ("torus", "torus", "vinyl", "torus", (3.3, 7.2, 3.1), (62, 12, 30), 1.0, False),
    ("letter_d", "d", "vinyl", "d", (1.9, 15.2, 0.62), (0, 0, -12), 1.0, True),
    ("chrome_a", "sphere", "chrome", None, (4.6, -8.2, 1.62), (0, 0, 0), 0.62, True),
    ("chrome_b", "sphere", "chrome", None, (-2.3, -6.0, 2.9), (0, 0, 0), 0.36, False),
    ("chrome_c", "sphere", "chrome", None, (-2.2, 11.8, 2.6), (0, 0, 0), 0.42, False),
    ("chrome_d", "sphere", "chrome", None, (-9.0, 26.0, -0.4), (0, 0, 0), 4.2, True),
    ("chrome_e", "sphere", "chrome", None, (3.1, 13.3, 0.95), (0, 0, 0), 0.33, True),
    ("glass_a", "slab", "glass", None, (-3.4, -2.6, 0.0), (0, 0, 18), 1.0, True),
    ("glass_b", "slab_tall", "glass", None, (-2.6, 8.2, 0.0), (0, 0, -10), 1.0, True),
    ("glass_c", "slab_wide", "glass", None, (5.4, 10.4, 0.0), (0, 0, -28), 1.0, True),
    ("mini_pill", "pill_small", "vinyl", "pill_b", (-1.4, -3.6, 1.55), (20, 35, 60), 1.0, False),
    ("mini_star", "star_small", "vinyl", "pill_c", (1.6, 1.0, 4.9), (10, -20, 18), 1.0, False),
    ("far_arch", "arch", "vinyl", "torus", (10.5, 30.0, 0.0), (0, 0, -32), 2.2, True),
    ("far_torus", "torus", "vinyl", "blob", (-13.0, 18.0, 5.0), (70, 0, -40), 1.6, False),
]

# Clay plinths and steps (static, baked).
PLINTHS = [
    # name, kind, pos, params
    ("plinth_d", "round", (1.9, 15.2, 0.0), dict(radius=2.25, height=0.62, steps=2, step_in=0.4)),
    ("plinth_pills", "round", (5.4, -1.2, 0.0), dict(radius=1.05, height=1.05, steps=1)),
    ("plinth_chrome", "round", (4.6, -8.2, 0.0), dict(radius=0.72, height=1.0, steps=1)),
    ("plinth_low", "round", (-0.6, 11.0, 0.0), dict(radius=0.85, height=0.28, steps=1)),
    ("steps", "steps", (6.6, -6.0, 0.0), dict(width=4.2, depth=1.1, rise=0.26, count=4, yaw=-18)),
    ("steps_far", "steps", (-6.2, 12.0, 0.0), dict(width=5.0, depth=1.3, rise=0.3, count=5, yaw=24)),
    ("block_a", "block", (-4.6, -1.2, 0.0), dict(size=(1.1, 1.1, 0.5), yaw=18)),
    ("block_b", "block", (6.8, 8.8, 0.0), dict(size=(1.6, 1.4, 0.8), yaw=-28)),
]


# --------------------------------------------------------------------------
# Sculptures
def make_shape(shape, name):
    """Returns an inflated mesh object at the origin, sitting on z = 0 (or centred for floaters)."""
    if shape in ("star", "star_small"):
        k = 1.0 if shape == "star" else 0.34
        o = toy.slab(name, [toy.star_outline(5, 1.3 * k, 0.68 * k, 1.35)], thickness=0.46 * k, bevel=0.2 * k)
        toy.puff(o, voxel=0.03 * k, pressure=4.0, frames=26, stiffness=12.0)
        toy.seam(o, depth=0.035 * k, width=0.03 * k, axis=1, center=0.0)
        toy.droop(o, amount=0.12 * k)
        toy.center(o)
        return o
    if shape == "d":
        outer, inner = toy.letter_d(3.3, 2.75, 0.98, 0.16)
        o = toy.slab(name, [outer, inner], thickness=0.8, bevel=0.34)
        o.data.transform(Matrix.Translation((-1.375, 0, 0)))
        toy.puff(o, voxel=0.045, pressure=4.0, frames=26, stiffness=12.0)
        toy.seam(o, depth=0.05, width=0.04, axis=1, center=0.0)
        toy.ground(o)
        return o
    if shape == "arch":
        o = toy.slab(name, [toy.arch_outline(4.4, 5.0, 2.4, 3.6)], thickness=1.0, bevel=0.42)
        toy.puff(o, voxel=0.05, pressure=3.2, frames=24, stiffness=14.0)
        toy.seam(o, depth=0.05, width=0.045, axis=1, center=0.0)
        toy.ground(o)
        return o
    if shape == "torus":
        o = geo.primitive("torus", name, major=1.15, minor=0.48, u=96, v=40)
        toy.puff(o, voxel=0.035, pressure=3.0, frames=20, stiffness=14.0)
        toy.seam(o, depth=0.035, width=0.035, axis=2, center=0.0)
        toy.center(o)
        return o
    if shape == "blob":
        o = geo.primitive("ico", name, subdiv=5, radius=1.0)
        o.data.transform(Matrix.Diagonal((1.35, 1.1, 0.78, 1)))
        geo.displace_noise(o, strength=0.34, scale=1.25, detail=0, name="lumps")
        geo.apply_all(o)
        toy.relax(o, 30, 0.8)
        toy.puff(o, voxel=0.035, pressure=3.0, frames=18, stiffness=12.0)
        toy.ground(o)
        # Squash the underside a touch so it rests on the water.
        for v in o.data.vertices:
            if v.co.z < 0.18:
                v.co.z = 0.18 - (0.18 - v.co.z) * 0.35
        toy.ground(o)
        return o
    if shape == "pills":
        parts = []
        spec = [("pill_a", (0, 0, 0.42), (0, 0, 8), 0.42, 1.9), ("pill_b", (0.1, 0.05, 1.22), (0, 0, -34), 0.38, 1.7), ("pill_c", (-0.05, -0.02, 1.95), (0, 0, 52), 0.34, 1.45)]
        for key, pos, rot, r, length in spec:
            p = toy.capsule(f"{name}_{key}", radius=r, length=length)
            toy.puff(p, voxel=0.03, pressure=2.5, frames=16, stiffness=14.0)
            toy.seam(p, depth=0.025, width=0.028, axis=1, center=0.0)
            # Heavy pills sag onto the one below.
            toy.droop(p, amount=0.05, axis=0)
            p.data.transform(Matrix.LocRotScale(Vector(pos), Euler([math.radians(a) for a in rot]), None))
            p["part"] = key
            parts.append(p)
        return parts
    if shape == "pill_small":
        o = toy.capsule(name, radius=0.22, length=0.9)
        toy.puff(o, voxel=0.02, pressure=2.5, frames=14, stiffness=14.0)
        toy.seam(o, depth=0.015, width=0.018, axis=1, center=0.0)
        toy.center(o)
        return o
    if shape == "sphere":
        o = geo.primitive("sphere", name, u=96, v=48, radius=1.0)
        geo.smooth(o, 180)
        return o
    if shape in ("slab", "slab_tall", "slab_wide"):
        size = {"slab": (1.5, 0.28, 2.9), "slab_tall": (1.2, 0.3, 3.9), "slab_wide": (2.6, 0.32, 2.2)}[shape]
        o = toy.rounded_box(name, size, radius=0.1, segments=5)
        o.data.transform(Matrix.Translation((0, 0, size[2] / 2 - 0.35)))
        return o
    raise ValueError(shape)


TRIS = {"star": 14000, "star_small": 3000, "d": 16000, "arch": 16000, "torus": 12000, "blob": 10000, "pills": 7000, "pill_small": 2500}


def step_shapes():
    scene.reset()
    objs = []
    made = {}
    only = set(args.only.split(",")) if args.only else None
    for name, shape, kind, color, pos, rot, sc, rest in SCULPTURES:
        if only and name not in only:
            continue
        if shape in made and shape not in ("pills",):
            o = bpy.data.objects.new(name, made[shape].data)
            bpy.context.scene.collection.objects.link(o)
            res = [o]
        else:
            res = make_shape(shape, name)
            res = res if isinstance(res, list) else [res]
            for o in res:
                if shape in TRIS:
                    toy.decimate_to(o, TRIS[shape] // (3 if shape == "pills" else 1))
            if len(res) == 1:
                made[shape] = res[0]
        for o in res:
            o["shape"] = shape
            o["sculpture"] = name
            o["kind"] = kind
            o["color"] = o.get("part", color) or ""
            o["rest"] = int(rest)
            o["pivot"] = [pos[0], pos[2], -pos[1]]
            o.matrix_world = Matrix.LocRotScale(Vector(pos), Euler([math.radians(a) for a in rot]), Vector((sc, sc, sc)))
            o.name = name if len(res) == 1 else f"{name}_{o['part']}"
            objs.append(o)
        cli.log("shape", name, sum(geo.triangle_count(o) for o in res), "tris")
    SHAPES.mkdir(parents=True, exist_ok=True)
    for name in {o["sculpture"] for o in objs}:
        group = {o for o in objs if o["sculpture"] == name}
        bpy.data.libraries.write(str(SHAPES / f"{name}.blend"), group, fake_user=True)
    cli.log("shapes written", SHAPES, len(objs))


def load_shapes():
    objs = []
    names = {s[0] for s in SCULPTURES}
    for f in sorted(SHAPES.glob("*.blend")):
        if f.stem not in names:
            continue
        with bpy.data.libraries.load(str(f)) as (src, dst):
            dst.objects = list(src.objects)
        for o in dst.objects:
            if o is not None:
                bpy.context.scene.collection.objects.link(o)
                objs.append(o)
    layout = {s[0]: s for s in SCULPTURES}
    for o in objs:
        name, shape, kind, color, pos, rot, sc, rest = layout[o["sculpture"]]
        o.matrix_world = Matrix.LocRotScale(Vector(pos), Euler([math.radians(a) for a in rot]), Vector((sc, sc, sc)))
        o["pivot"] = [pos[0], pos[2], -pos[1]]
        o["rest"] = int(rest)
        o["kind"] = kind
    return objs


# --------------------------------------------------------------------------
# Plinths and steps
def make_plinth(name, kind, pos, p):
    if kind == "round":
        o = toy.plinth(name, radius=p["radius"], height=p["height"], steps=p.get("steps", 1), step_in=p.get("step_in", 0.14))
        o.location = pos
    elif kind == "steps":
        parts = []
        for k in range(p["count"]):
            d = p["depth"] * (p["count"] - k)
            b = toy.rounded_box(f"{name}_{k}", (p["width"] - k * 0.25, d, p["rise"] * (k + 1) + 0.6), radius=0.035, segments=3)
            b.location = (0, d / 2, (p["rise"] * (k + 1) - 0.6) / 2)
            parts.append(b)
        o = geo.join(parts, name)
        o.data.transform(Matrix.Translation((0, -p["depth"] * p["count"] / 2, 0)))
        o.location = pos
        o.rotation_euler = (0, 0, math.radians(p["yaw"]))
    elif kind == "block":
        sx, sy, sz = p["size"]
        o = toy.rounded_box(name, (sx, sy, sz + 0.6), radius=0.04, segments=3)
        o.location = (pos[0], pos[1], (sz - 0.6) / 2)
        o.rotation_euler = (0, 0, math.radians(p["yaw"]))
    else:
        raise ValueError(kind)
    bpy.context.view_layer.update()
    geo.set_origin_world(o)
    o["kind"] = "clay"
    return o


def make_plinths():
    return [make_plinth(*p) for p in PLINTHS]


# --------------------------------------------------------------------------
# Materials per variant (Cycles). Mirrors src/worlds/scenes/garden/materials.ts.
def assign_materials(objs, variant):
    night = variant == "night"
    cache = {}

    def get(key, fn):
        if key not in cache:
            cache[key] = fn()
        return cache[key]

    for o in objs:
        kind = o.get("kind")
        col = o.get("color") or ""
        if kind == "vinyl":
            rim = lin(PAL["night"]["rim"][col]) if night and col in PAL["night"]["rim"] else None
            m = get(f"vinyl_{col}", lambda: toy.vinyl(f"vinyl_{col}_{variant}", c(variant, col), night_rim=rim, rim_strength=14.0, inner=c(variant, col) if night else None, inner_strength=0.06))
        elif kind == "chrome":
            m = get("chrome", lambda: toy.chrome(f"chrome_{variant}", tint=(0.97, 0.96, 0.99) if not night else (0.85, 0.85, 0.95)))
        elif kind == "glass":
            m = get("glass", lambda: toy.frosted(f"glass_{variant}", tint=c(variant, "glass"), rough=0.18 if night else 0.2))
        elif kind == "clay":
            m = get("clay", lambda: toy.clay(f"clay_{variant}", c(variant, "clay")))
        else:
            continue
        if kind == "clay":
            # Unique meshes; bake_group reads mesh-data materials.
            mat.assign(o, m)
            continue
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = m


def glass_cores(objs, variant):
    """Night: a neon bar inside each frosted slab, so the glass glows from within."""
    out = []
    if variant != "night":
        return out
    cols = ["#ff8fd0", "#9fb8ff", "#ffd98a"]
    for k, o in enumerate([o for o in objs if o.get("kind") == "glass"]):
        bpy.context.view_layer.update()
        corners = [o.matrix_world @ Vector(cn) for cn in o.bound_box]
        lo = min(v.z for v in corners)
        hi = max(v.z for v in corners)
        cen = sum(corners, Vector()) / 8
        bar = geo.primitive("cylinder", f"{o.name}_core", radius=0.05, depth=(hi - max(0.0, lo)) * 0.72, segments=16)
        bar.location = (cen.x, cen.y, max(0.0, lo) + (hi - max(0.0, lo)) / 2)
        toy.set_ray_visibility(bar, camera=True, glossy=True, diffuse=True, shadow=False)
        mat.assign(bar, toy.neon(f"core_{k}", lin(cols[k % 3]), 18.0))
        out.append(bar)
    return out


# --------------------------------------------------------------------------
# Studio
def studio(variant, sky=True):
    night = variant == "night"
    stops = [(p, lin(h)) for p, h in PAL[variant]["sky"]]
    toy.gradient_world(stops, strength=1.0 if not night else 1.0, stars=0.0 if not night else 6.0, hdri=HDRI if HDRI.exists() else None, hdri_strength=0.55 if not night else 0.08, hdri_rot=40)
    if not night:
        # Big softbox key from the upper right, cool fill from the left, colored bounce cards.
        scene.area_light("key", (9, -8, 11), rot_deg=(48, 0, 50), size=7.0, power=5200, color=(1.0, 0.95, 0.9))
        scene.area_light("fill", (-10, -4, 5), rot_deg=(72, 0, -62), size=8.0, power=1800, color=(0.85, 0.9, 1.0))
        scene.area_light("bounce_pink", (4, 20, 2.5), rot_deg=(100, 0, 170), size=10.0, power=1400, color=(1.0, 0.72, 0.84))
        scene.area_light("strip", (-3, 6, 9), rot_deg=(20, 0, -20), size=1.0, size_y=10.0, power=900, color=(1.0, 0.98, 0.96), shape="RECTANGLE")
    else:
        scene.area_light("moon", (-8, 6, 14), rot_deg=(30, 0, -130), size=8.0, power=400, color=(0.62, 0.68, 1.0))
        scene.area_light("neon_pink", (8, 4, 1.5), rot_deg=(90, 0, 90), size=6.0, power=900, color=(1.0, 0.45, 0.78))
        scene.area_light("neon_blue", (-7, 10, 1.5), rot_deg=(90, 0, -90), size=6.0, power=700, color=(0.45, 0.6, 1.0))
        for k, (p, col) in enumerate([((2.9, -4.2, 1.6), (1.0, 0.85, 0.5)), ((1.9, 13.0, 1.5), (1.0, 0.5, 0.8)), ((3.3, 7.2, 2.2), (0.75, 0.6, 1.0))]):
            scene.point_light(f"glow{k}", p, power=260, radius=0.6, color=col)


def pool(variant):
    o = geo.primitive("grid", "pool", x=2, y=2, size=220)
    o.location = (0, 30, 0)
    mat.assign(o, toy.water(f"water_{variant}", c(variant, "water"), rough=0.0, ripple=0.02 if variant == "day" else 0.03, scale=2.4))
    return o


def stage(variant, samples=None):
    scene.reset()
    sc = scene.cycles(samples=samples or args.samples or (24 if args.preview else 64), bounces=8, res=(1920, 1200))
    sc.cycles.transmission_bounces = 12
    if variant == "day":
        scene.view("Khronos PBR Neutral", exposure=0.1)
    else:
        scene.view("AgX", look="AgX - Medium High Contrast", exposure=0.2)
    studio(variant)
    objs = load_shapes()
    plinths = make_plinths()
    assign_materials(objs + plinths, variant)
    cores = glass_cores(objs, variant)
    water = pool(variant)
    cam = build_camera()
    return sc, cam, {"objs": objs, "plinths": plinths, "cores": cores, "water": water}


# --------------------------------------------------------------------------
# Camera rail (Blender coords). The camera pushes up the pool through the
# arch and settles in front of the D, which ends right of centre.
KEYS = [
    # s,    pos,                   look,                 fov, roll
    (0.00, (0.2, -17.0, 1.35), (-1.9, -3.0, 2.35), 40, -1.5),
    (0.25, (0.9, -12.0, 1.75), (-1.2, 1.0, 2.3), 42, -1.0),
    (0.50, (0.5, -5.5, 1.85), (-0.4, 5.0, 2.1), 46, 0.5),
    (0.72, (0.35, 1.2, 1.8), (-0.2, 9.0, 1.95), 50, 1.5),
    (0.86, (0.0, 4.2, 1.85), (-0.6, 13.0, 2.1), 46, 1.0),
    (1.00, (-1.0, 5.8, 1.95), (-0.7, 15.2, 2.3), 42, 0.0),
    (1.20, (-2.0, 7.0, 2.1), (-0.9, 15.3, 2.35), 40, -0.5),
]


def build_camera():
    cam = scene.camera(lens=35)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 600
    rails.key(cam, [{"s": s, "pos": p, "look": lk, "fov": f, "roll": r} for s, p, lk, f, r in KEYS])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written", PUB / "rails.json")


# --------------------------------------------------------------------------
def step_preview():
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        if not args.samples:
            sc.render.resolution_percentage = 50
        for s in [float(x) for x in args.s.split(",")]:
            rails.set_at(s)
            render.still(OUT / f"preview-{variant}-{s:.2f}.png")


def step_bake():
    """Diffuse GI (colored bounce from the vinyl, water fill, neon at night) onto the clay."""
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        joined = bake.bake_group(parts["plinths"], f"plinths_{variant}", OUT / "bake", size=2048, samples=args.samples or (64 if args.preview else 256))
        joined["kind"] = "baked"
        export.glb(OUT / f"plinths-{variant}.glb", [joined])


def step_export():
    """Runtime sculptures: one GLB, one node per piece, layout + material hints as extras."""
    scene.reset()
    objs = load_shapes()
    for k, o in enumerate(objs):
        # Unique mesh per node, or gltf-transform would dedup + turn the spheres into GPU instances.
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(Matrix.Scale(1.0 + k * 1e-5, 4))
        o.data.materials.clear()
        o.data.materials.append(mat.principled(f"m_{o.name}", base=c("day", o["color"]) if o.get("color") else (0.9, 0.9, 0.9), rough=0.3))
        export.tag(o, sculpture=o["sculpture"], kind=o["kind"], color=o.get("color", ""), rest=o["rest"], pivot=o["pivot"])
    export.glb(OUT / "garden.glb", objs, export_vertex_color="NONE")
    meta = {"sculptures": [{"name": s[0], "kind": s[2], "pivot": [s[4][0], s[4][2], -s[4][1]], "rest": s[7]} for s in SCULPTURES]}
    (OUT / "garden-meta.json").write_text(json.dumps(meta, indent=1))


# --------------------------------------------------------------------------
# Low Resources layers: back (pool + far pieces), mid, front, sorted by depth from each tag's camera.
TAGS = [0.0, 0.5, 1.0]
FAR = {"chrome_d", "far_arch", "far_torus"}


def bands_for(cam, parts):
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    bands = {"back": [parts["water"]], "mid": [], "front": []}
    for o in parts["objs"] + parts["plinths"] + parts["cores"]:
        corners = [o.matrix_world @ Vector(cn) for cn in o.bound_box]
        cen = sum(corners, Vector()) / 8
        d = (cen - cpos).dot(fwd)
        if o.get("sculpture") in FAR or d > 17:
            bands["back"].append(o)
        elif d < 6.5:
            bands["front"].append(o)
        else:
            bands["mid"].append(o)
    return bands


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        for s in tags:
            rails.set_at(s)
            bpy.context.view_layer.update()
            bands = bands_for(cam, parts)
            order = [(k, bands[k]) for k in ("back", "mid", "front") if bands[k] or k == "back"]
            render.layers(cam, s, order, OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 30.0})


def step_pano():
    """360 from between the star and the arch, facing up the pool (the door looks at the middle)."""
    for variant in args.variants:
        sc, cam, parts = stage(variant)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, Vector((0.6, -2.4, 1.7)), res=(4096, 2048), samples=args.samples or 48, look_yaw_deg=90)
        cli.log("pano", variant, png)


def step_mini():
    """A single inflatable star standing on a clay base (~1 unit tall) for the homepage diorama."""
    scene.reset()
    star = toy.slab("mini_star", [toy.star_outline(5, 0.42, 0.22, 1.35)], thickness=0.15, bevel=0.065)
    toy.puff(star, voxel=0.011, pressure=4.0, frames=26, stiffness=12.0)
    toy.seam(star, depth=0.012, width=0.01, axis=1, center=0.0)
    toy.droop(star, amount=0.03)
    toy.center(star)
    toy.decimate_to(star, 4200)
    lo_z = min(v.co.z for v in star.data.vertices)
    star.data.transform(Matrix.Translation((0, 0, 0.14 - lo_z - 0.03)))
    mat.assign(star, toy.vinyl("mini_star", c("day", "mini_star"), rough=0.25))
    base = toy.plinth("mini_base", radius=0.36, height=0.14, steps=2, step_in=0.07, segments=64, bevel=0.012)
    for v in base.data.vertices:
        v.co.z = max(0.0, v.co.z)
    mat.assign(base, mat.principled("mini_clay", base=c("day", "clay"), rough=0.7, sheen=0.3))
    o = geo.join([star, base], "mini_garden")
    geo.smooth(o, 50)
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 2) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "shapes": step_shapes,
    "bake": step_bake,
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
