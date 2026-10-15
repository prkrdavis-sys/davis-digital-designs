"""Glass gallery: a limestone room and a five-slice glass monolith.

Steps (run with --steps a,b,...):
  room      glass facets -> facets.glb, layout.json (three.js coordinates)
  bake      per variant: room shell + floor lightmap (Cycles GI) -> room-<v>.glb
  rail      camera rail -> rails.json
  preview   quick Cycles still at --s
  layers    Low Resources depth layers + posters (day/night)
  pano      360 of the empty room, so the glass can reflect it at runtime

Blender is Z-up. three.js = (x, z, -y). The camera starts front-left and
orbits toward the monolith, which stands right of center.
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "monolith"
OFFSET = 0.0
S_MAX = 1.15

# Monolith, right of center. Five slices sit flush with a hairline gap.
MONO_X = 2.7
MONO_Y = 5.05
PLINTH_H = 0.16
FACET_W = 0.162
FACET_D = 0.24
FACET_H = 2.42
FACET_GAP = 0.0035
# Ceiling slot the blade of light falls through (x0, x1, y0, y1).
SLOT = (1.5, 3.9, 3.15, 7.35)
CEIL = 5.15


def extra_args(p):
    p.add_argument("--s", type=float, default=0.2)
    p.add_argument("--tags", default="")
    p.add_argument("--bake-size", type=int, default=1536)
    p.add_argument("--still-scale", type=float, default=1.0)


args = cli.parse([extra_args])
LAYER_RES = (int(1600 * args.still_scale), int(1000 * args.still_scale))
PANO_RES = (int(2048 * args.still_scale), int(1024 * args.still_scale))
OUT, PUB = cli.scene_dirs(SCENE_ID)


def lin(hex_color):
    h = hex_color.lstrip("#")
    return tuple((int(h[i : i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))


def to_three(v):
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


PAL = {
    "day": {
        "wall": lin("#d5dedc"),
        "ceil": lin("#e7eeec"),
        "floor": lin("#c3ccc9"),
        "plinth": lin("#2c3338"),
        "frame": lin("#edf2f0"),
    },
    "night": {
        "wall": lin("#8e99a6"),
        "ceil": lin("#7a8694"),
        "floor": lin("#6a7582"),
        "plinth": lin("#242a32"),
        "frame": lin("#c5d0dc"),
    },
}

# World accent colors, matching src/lib/worlds.ts day palettes (sites, apps, play, create, shop).
TINTS = ["#8fd08a", "#5cc3d2", "#ff5c9d", "#a9dcff", "#ffb85f"]
LABELS = ["Sites", "Apps", "Play", "Create", "Studio Shop"]


def box(name, size, center):
    """Axis-aligned box. `size` is full extent, `center` is its middle."""
    o = geo.primitive("cube", name, size=1.0)
    o.data.transform(Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
    o.location = Vector(center)
    return o


def lights(variant):
    if variant == "day":
        # Above the slot, tilted so the blade lands on the far wall and the glass.
        scene.area_light("slot", (MONO_X, 2.4, 7.6), rot_deg=(62, 0, 8), size=3.2, size_y=0.42, power=2400, color=(0.92, 0.95, 1.0))
        scene.sun_light("fill", rot_deg=(72, 0, -40), strength=0.28, color=(0.82, 0.88, 1.0), angle_deg=6)
    else:
        scene.area_light("moon", (MONO_X - 0.2, 2.2, 7.8), rot_deg=(64, 0, 6), size=2.4, size_y=0.32, power=1600, color=(0.72, 0.82, 1.0))
        scene.point_light("uplight", (MONO_X, MONO_Y, 0.04), power=90, radius=0.5, color=(1.0, 0.74, 0.5))
        scene.sun_light("fill", rot_deg=(80, 0, 20), strength=0.12, color=(0.6, 0.7, 1.0))


def sky(variant):
    if variant == "day":
        scene.world_sky(sun_elevation_deg=62, sun_rotation_deg=24, strength=0.22, air=1.6, dust=0.25)
    else:
        scene.world_color((0.03, 0.04, 0.08), 0.35)


def build_facets():
    """Five chamfered slabs. Each object's origin is the centre of its base."""
    glass = mat.glass("glass", tint=(0.97, 0.98, 1.0), rough=0.012, ior=1.5)
    objs = []
    homes = []
    span = FACET_W + FACET_GAP
    for i in range(5):
        o = geo.primitive("cube", f"facet_{i}", size=1.0)
        # Cube is -0.5..0.5. Scale, then lift so the base sits on z=0.
        o.data.transform(Matrix.Translation((0, 0, FACET_H / 2)) @ Matrix.Diagonal((FACET_W, FACET_D, FACET_H, 1.0)))
        x = MONO_X + (i - 2) * span
        o.location = (x, MONO_Y, PLINTH_H)
        geo.bevel(o, width=0.011, segments=2, angle_deg=35)
        geo.apply_all(o)
        geo.smooth(o, 28)
        mat.assign(o, glass)
        export.tag(o, index=i, label=LABELS[i])
        objs.append(o)
        homes.append(to_three((x, MONO_Y, PLINTH_H)))
    return objs, homes


def build_room(variant):
    """Walls, ceiling with one slot, plinth. Returns (shell_parts, floor)."""
    pal = PAL[variant]
    wall_m = mat.principled(f"wall_{variant}", base=pal["wall"], rough=0.72, specular=0.25)
    ceil_m = mat.principled(f"ceil_{variant}", base=pal["ceil"], rough=0.8, specular=0.15)
    frame_m = mat.principled(f"frame_{variant}", base=pal["frame"], rough=0.45, specular=0.35)
    plinth_m = mat.principled(f"plinth_{variant}", base=pal["plinth"], rough=0.28, specular=0.45)
    floor_m = mat.principled(f"floor_{variant}", base=pal["floor"], rough=0.18, specular=0.55)

    parts = []
    # Floor slab, top face on z=0.
    floor = box("floor", (18, 24, 0.24), (0.4, 5.2, -0.12))
    mat.assign(floor, floor_m)

    def wall(name, size, center):
        o = box(name, size, center)
        mat.assign(o, wall_m)
        parts.append(o)
        return o

    wall("wall_l", (0.4, 20, CEIL), (-7.2, 5.0, CEIL / 2))
    wall("wall_r", (0.4, 20, CEIL), (8.0, 5.0, CEIL / 2))
    wall("wall_back", (15.6, 0.4, CEIL), (0.4, 15.2, CEIL / 2))
    wall("wall_front", (15.6, 0.4, CEIL), (0.4, -4.6, CEIL / 2))

    ceil = box("ceiling", (15.6, 20.2, 0.28), (0.4, 5.3, CEIL + 0.14))
    # Cut the light slot.
    sx0, sx1, sy0, sy1 = SLOT
    cut = box("slot_cut", (sx1 - sx0, sy1 - sy0, 1.4), ((sx0 + sx1) / 2, (sy0 + sy1) / 2, CEIL + 0.14))
    boo = ceil.modifiers.new("slot", "BOOLEAN")
    boo.operation = "DIFFERENCE"
    boo.solver = "EXACT"
    boo.object = cut
    geo.apply_all(ceil)
    bpy.data.objects.remove(cut, do_unlink=True)
    mat.assign(ceil, ceil_m)
    parts.append(ceil)

    # A thin stone lip around the slot, so the opening reads as built, not cut.
    t = 0.08
    zf = CEIL - 0.04
    for name, size, center in (
        ("lip_n", (sx1 - sx0 + t * 2, t, 0.1), ((sx0 + sx1) / 2, sy1 + t / 2, zf)),
        ("lip_s", (sx1 - sx0 + t * 2, t, 0.1), ((sx0 + sx1) / 2, sy0 - t / 2, zf)),
        ("lip_w", (t, sy1 - sy0, 0.1), (sx0 - t / 2, (sy0 + sy1) / 2, zf)),
        ("lip_e", (t, sy1 - sy0, 0.1), (sx1 + t / 2, (sy0 + sy1) / 2, zf)),
    ):
        lip = box(name, size, center)
        mat.assign(lip, frame_m)
        parts.append(lip)

    plinth = box("plinth", (1.28, 0.62, PLINTH_H), (MONO_X, MONO_Y, PLINTH_H / 2))
    geo.bevel(plinth, width=0.008, segments=1, angle_deg=35)
    geo.apply_all(plinth)
    mat.assign(plinth, plinth_m)
    parts.append(plinth)
    return parts, floor


# Camera: wide and low at the front-left, then a slow 35-degree push toward the glass.
KEYS = [
    # s, pos, look, fov. Look stays left of the glass so the headline has an open wall.
    (0.00, (-3.15, -0.7, 1.58), (-0.55, 4.2, 1.15), 42),
    (0.28, (-1.7, 0.35, 1.5), (0.05, 4.55, 1.28), 38),
    (0.55, (-0.15, 1.35, 1.44), (0.7, 4.85, 1.38), 34),
    (0.82, (0.85, 2.05, 1.38), (1.2, 5.0, 1.45), 32),
    (1.05, (1.35, 2.45, 1.34), (1.55, 5.05, 1.5), 30),
]


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.08
    cam.data.clip_end = 80
    rails.key(cam, [{"s": s + OFFSET, "pos": p, "look": l, "fov": f} for s, p, l, f in KEYS])
    return cam


def step_room():
    scene.reset()
    facets, homes = build_facets()
    export.glb(OUT / "facets.glb", facets)
    slot = {
        "x0": SLOT[0],
        "x1": SLOT[1],
        "y0": to_three((0, SLOT[3], CEIL))[2],
        "y1": to_three((0, SLOT[2], CEIL))[2],
        "ceil": CEIL,
    }
    # three z is -blender y, so the slot's near/far swap.
    layout = {
        "facets": [{"name": f"facet_{i}", "label": LABELS[i], "tint": TINTS[i], "home": homes[i]} for i in range(5)],
        "focus": to_three((MONO_X, MONO_Y, PLINTH_H + FACET_H * 0.46)),
        "slot": {"x0": SLOT[0], "x1": SLOT[1], "z0": min(slot["y0"], slot["y1"]), "z1": max(slot["y0"], slot["y1"]), "ceil": CEIL},
        "sun": to_three((0.15, -0.55, 0.82)),
    }
    (PUB / "hi" / "layout.json").write_text(json.dumps(layout, indent=1))
    cli.log("facets", len(facets), "homes", homes)


def stage(variant, with_glass=True):
    scene.reset()
    spp = 16 if args.preview else (args.samples or 64)
    sc = scene.cycles(samples=spp, bounces=6, res=(1600, 1000))
    scene.view("AgX", look="AgX - Medium High Contrast", exposure=-0.15 if variant == "day" else 0.2)
    sky(variant)
    lights(variant)
    parts, floor = build_room(variant)
    facets = build_facets()[0] if with_glass else []
    cam = build_camera()
    return sc, cam, {"back": parts + [floor], "mid": facets}


def step_bake():
    size = 768 if args.preview else args.bake_size
    spp = 24 if args.preview else (args.samples or 96)
    for variant in args.variants:
        scene.reset()
        scene.cycles(samples=spp, bounces=5, res=(1600, 1000))
        sky(variant)
        lights(variant)
        parts, floor = build_room(variant)
        build_facets()
        shell = bake.bake_group(parts, "shell", OUT / f"bake-{variant}", size=size, samples=spp, roughness=0.62)
        # White albedo so the floor map is irradiance. The shell and glass stay as occluders.
        mat.assign(floor, mat.principled("floor_white", base=(0.72, 0.74, 0.73), rough=0.2))
        fl = bake.bake_group([floor], "floor", OUT / f"bake-{variant}", size=size, samples=spp, roughness=0.22)
        export.glb(OUT / f"room-{variant}.glb", [shell, fl])
        cli.log("baked", variant, "shell", geo.triangle_count(shell), "floor", geo.triangle_count(fl))


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail", S_MAX)


def step_preview():
    for variant in args.variants:
        sc, cam, _bands = stage(variant)
        rails.set_at(args.s + OFFSET)
        sc.render.resolution_x, sc.render.resolution_y = 1280, 800
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png", samples=args.samples or 32)


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else [0.0, 0.5, 1.0]
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        for s in tags:
            tag = f"{variant}-s{int(round(s * 100)):03d}"
            rails.set_at(s + OFFSET)
            render.layers(
                cam,
                s + OFFSET,
                [("back", bands["back"]), ("mid", bands["mid"])],
                OUT / "layers",
                tag,
                res=LAYER_RES,
                samples=sc.cycles.samples,
            )
            info_path = OUT / "layers" / f"{tag}.json"
            info = json.loads(info_path.read_text())
            info["s"] = s
            info_path.write_text(json.dumps(info, indent=1))


def step_pano():
    for variant in args.variants:
        _sc, _cam, _bands = stage(variant, with_glass=False)
        loc = Vector((-0.6, 1.4, 1.6))
        png = OUT / f"pano-{variant}.png"
        yaw = math.degrees(math.atan2(MONO_X - loc.x, MONO_Y - loc.y))
        render.panorama(png, loc, res=PANO_RES, samples=args.samples or (24 if args.preview else 48), look_yaw_deg=yaw)
        cli.log("pano", variant)


STEPS = {
    "room": step_room,
    "bake": step_bake,
    "rail": step_rail,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name != "preview" or "preview" in args.steps.split(",")):
        fn()
