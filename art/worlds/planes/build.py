"""Paper planes over a sunset cloud sea (Contact page).

Steps (run with --steps a,b,...):
  print       printed paper atlas (notebook, airmail, graph, dot grid) + the mini's sheet
  plane       folded paper dart -> plane.glb (geometry, sheet UVs, crease AO colors)
  mini        paper plane on a walnut stand for the homepage diorama
  rail        camera rail -> rails.json
  atlas       relightable Cycles cloud impostors -> clouds.png + clouds.json
  preview     quick Cycles still of the full scene at --s
  layers      Low Resources depth layers + posters (day/night)
  pano        360 view above the cloud sea
  cloudtest   look-dev render of the cloudscape only

Units: 1 = one paper plane's length. three.js coordinates in the data
(pl_common.b() converts to Blender).
"""

import math
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Matrix, Vector  # noqa: E402

import pl_clouds as cl  # noqa: E402
import pl_flock as fl  # noqa: E402
import pl_paper as pp  # noqa: E402
from pl_common import WORLD, b, key_light, lin, light_dir, render_safe, sky_world  # noqa: E402
from ddd import cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "planes"
CACHE = HERE.parents[1] / ".cache"
FIBER = CACHE / "ambientcg" / "Paper001" / "Paper001_1K-JPG_Color.jpg"
WALNUT = CACHE / "polyhaven" / "texture" / "black_walnut_veneer_01"


def extra_args(p):
    p.add_argument("--s", type=float, default=0.0)
    p.add_argument("--tags", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)


# --------------------------------------------------------------------------
def step_print():
    scene.reset()
    atlas, cells = pp.print_atlas(FIBER)
    pp.save_png(atlas, OUT / "paper.png", "paper")
    pp.save_png(cells[1], OUT / "mini_paper.png", "mini_paper")
    cli.log("print atlas", OUT / "paper.png")


def step_plane():
    scene.reset()
    o = pp.plane_mesh("plane")
    m = mat.principled("paper", base=(1, 1, 1), rough=0.75)
    mat.assign(o, m)
    cli.log("plane tris", geo.triangle_count(o), "dims", [round(x, 3) for x in o.dimensions])
    export.glb(OUT / "plane.glb", [o])


def step_mini():
    scene.reset()
    objs = []
    plane = pp.plane_mesh("mini_plane")
    plane.data.transform(Matrix.Scale(0.82, 4))
    paper = mat.principled("mini_paper", base=(1, 1, 1), rough=0.72, sheen=0.25)
    t = mat.image_node(paper, OUT / "mini_paper.png", "sRGB")
    paper.node_tree.links.new(t.outputs["Color"], mat.bsdf_of(paper).inputs["Base Color"])
    mat.assign(plane, paper)
    plane.matrix_world = Matrix.LocRotScale(Vector((0.0, 0.0, 0.84)), Euler((math.radians(11), math.radians(-13), math.radians(-18)), "XYZ"), None)
    objs.append(plane)

    base = geo.primitive("cylinder", "mini_base", radius=0.3, depth=0.07, segments=64)
    base.location.z = 0.035
    geo.bevel(base, width=0.012, segments=3, angle_deg=40)
    geo.apply_all(base)
    geo.set_origin_world(base)
    geo.smooth(base, 40)
    walnut = mat.pbr("walnut", {k: WALNUT / f"black_walnut_veneer_01_{v}_1k.png" for k, v in (("diffuse", "diffuse"), ("rough", "rough"), ("normal", "normal"))}, scale=0.6, coat=0.4, coat_rough=0.15)
    mat.assign(base, walnut)
    objs.append(base)

    # Brass rod from the base to the keel.
    keel = plane.matrix_world @ Vector((0.0, 0.02, -0.05))
    rod = geo.tube("mini_rod", [(0.02, -0.03, 0.07), tuple(keel)], radius=0.009, segments=12)
    mat.assign(rod, mat.principled("brass", base=(0.96, 0.74, 0.42), metal=1.0, rough=0.28))
    objs.append(rod)
    foot = geo.primitive("cylinder", "mini_foot", radius=0.028, depth=0.012, segments=24)
    foot.location = (0.02, -0.03, 0.076)
    geo.set_origin_world(foot)
    mat.assign(foot, mat.principled("brass2", base=(0.96, 0.74, 0.42), metal=1.0, rough=0.3))
    objs.append(foot)

    # A little clay cloud on the base, which the plane is gliding over.
    puffs = []
    for k, (x, y, z, r) in enumerate([(-0.13, 0.06, 0.1, 0.07), (-0.05, 0.08, 0.12, 0.085), (0.04, 0.09, 0.1, 0.065), (-0.09, 0.0, 0.095, 0.055), (0.0, 0.02, 0.09, 0.05)]):
        s = geo.primitive("sphere", f"puff{k}", u=28, v=14, radius=r)
        s.location = (x, y, z)
        geo.set_origin_world(s)
        puffs.append(s)
    cloud = geo.join(puffs, "mini_cloud")
    geo.smooth(cloud, 180)
    mat.assign(cloud, mat.principled("cloud_clay", base=lin("#fff4ee"), rough=0.6, sheen=0.5, sheen_tint=lin("#ffd9c7"), subsurface=0.2, subsurface_scale=0.05))
    objs.append(cloud)
    cli.log("mini tris", sum(geo.triangle_count(o) for o in objs), "height", round(max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box), 3))
    export.glb(OUT / "mini.glb", objs)


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 20000
    rails.key(cam, [{"s": k["s"], "pos": tuple(b(k["pos"])), "look": tuple(b(k["look"])), "fov": k["fov"], "roll": k["roll"]} for k in fl.rail_keys()])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", fl.S_MAX)
    cli.log("rail written", PUB / "rails.json")


def step_atlas():
    import pl_atlas

    pl_atlas.build(OUT, PUB, samples=args.samples or (12 if args.preview else 24))


# --------------------------------------------------------------------------
# Full scene for Cycles stills (layers, posters, pano, preview).
def build_clouds(center, near_r=420, far=True, towers=True):
    objs = {"near": [], "far": [], "towers": []}
    t0 = time.time()
    sea_mat = cl.cloud_material("sea", density=0.9, erosion=0.95, gain=1.8, scale=0.1, billow=0.45, anisotropy=0.3)
    near = cl.sea_spheres(0, near_r, 24.0, 11, center=center)
    objs["near"].append(cl.sphere_cloud("sea_near", near, sea_mat, voxel=3.0, blur_iters=1, dilate=1))
    if far:
        far_s = cl.sea_spheres(near_r - 20, 2600, 70.0, 12, relief=12.0, center=center, lumps_per=2)
        far_mat = cl.cloud_material("sea_far", density=0.6, erosion=0.8, gain=1.8, scale=0.03, anisotropy=0.3)
        objs["far"].append(cl.sphere_cloud("sea_far", far_s, far_mat, voxel=10.0, blur_iters=1, dilate=1))
    if towers:
        tmat = cl.cloud_material("tower", density=1.0, erosion=0.85, gain=1.8, scale=0.045, billow=0.4, anisotropy=0.3)
        for k, (x, z, h, _cell) in enumerate(WORLD["clouds"]["towers"]):
            p = b((x, 0, z))
            sp = cl.tower_spheres(100 + k, h, h * 0.7, base=(p.x, p.y, -12.0))
            objs["towers"].append(cl.sphere_cloud(f"tower{k}", sp, tmat, voxel=max(2.0, h / 60), blur_iters=1, dilate=1))
    cli.log("clouds staged in", round(time.time() - t0, 1))
    return objs


_plane_src = {}


def plane_instance(name, cell, variant):
    if "mesh" not in _plane_src:
        src = pp.plane_mesh("plane_src")
        _plane_src["mesh"] = src.data
        bpy.data.objects.remove(src, do_unlink=True)
        _plane_src["mats"] = [pp.paper_material(f"paper{c}", OUT / "paper.png", cell=c, translucency=0.35) for c in range(4)]
    o = bpy.data.objects.new(name, _plane_src["mesh"])
    bpy.context.scene.collection.objects.link(o)
    if not o.material_slots:
        o.data.materials.append(None)
    o.material_slots[0].link = "OBJECT"
    o.material_slots[0].material = _plane_src["mats"][cell]
    return o


def trail(name, tail, back, length=11.0, variant="day"):
    """Faint contrail streaming back from the tail (Blender space)."""
    pts = [tail + back * (length * (k / 20) ** 1.1) + Vector((0, 0, -0.25 * (k / 20) ** 2)) for k in range(21)]
    radii = [0.015 + 0.14 * (k / 20) ** 1.3 for k in range(21)]
    o = geo.tube(name, pts, radii=radii, segments=8, caps=False)
    fade = o.data.attributes.new("fade", "FLOAT", "POINT")
    ys = np.array([(v.co - tail).length / length for v in o.data.vertices], dtype=np.float32)
    fade.data.foreach_set("value", np.clip(1.0 - ys, 0, 1) ** 1.6)
    m = bpy.data.materials.get(f"trail_{variant}")
    if m is None:
        m = bpy.data.materials.new(f"trail_{variant}")
        if hasattr(m, "use_nodes"):
            m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "fade"
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*lin("#fff1e6" if variant == "day" else "#c9d2ff"), 1)
        em.inputs["Strength"].default_value = 1.4 if variant == "day" else 0.5
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = 0.35
        nt.links.new(at.outputs["Fac"], mul.inputs[0])
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(mul.outputs[0], mix.inputs[0])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    mat.assign(o, m)
    return o


def stage_planes(variant, cam):
    objs = []
    anchor = WORLD["flock"]["anchor"]
    for i, sl in enumerate(fl.slots()):
        h = sl["home"]
        p = b((anchor[0] + h[0], anchor[1] + h[1], anchor[2] + h[2]))
        bank = math.sin(sl["phase"]) * 0.35 - 0.15
        yaw = math.sin(sl["phase"] * 1.7) * 0.12
        pitch = math.sin(sl["phase"] * 2.3) * 0.06
        o = plane_instance(f"plane{i}", sl["print"], variant)
        rot = Euler((pitch, bank, yaw), "XYZ")
        o.matrix_world = Matrix.LocRotScale(p, rot, Vector([sl["scale"]] * 3))
        objs.append(o)
        tail = o.matrix_world @ Vector((0, -0.45, 0))
        objs.append(trail(f"trail{i}", tail, Vector((0, -1, 0)), 10.0 + sl["tint"] * 6, variant))
        if variant == "night":
            lan = pp.lantern(f"lantern{i}", strength=60.0)
            lan.location = o.matrix_world @ Vector((0, 0.05, -0.26))
            objs.append(lan)
    # A hero plane close to the camera, right of centre.
    q = cam.matrix_world.to_quaternion()
    hp = cam.matrix_world.translation + q @ Vector((1.25, -0.55, -3.6))
    o = plane_instance("hero", 1, variant)
    o.matrix_world = Matrix.LocRotScale(hp, Euler((0.05, -0.32, 0.18), "XYZ"), None)
    objs.append(o)
    objs.append(trail("hero_trail", o.matrix_world @ Vector((0, -0.45, 0)), Vector((0.08, -1, -0.02)).normalized(), 12.0, variant))
    if variant == "night":
        lan = pp.lantern("hero_lantern", strength=60.0)
        lan.location = o.matrix_world @ Vector((0, 0.05, -0.26))
        objs.append(lan)
    return objs


def stage(s, variant, res=(1920, 1200), samples=None):
    scene.reset()
    _plane_src.clear()
    sc = scene.cycles(samples=samples or args.samples or (12 if args.preview else 20), bounces=8, res=res)
    cl.volume_settings(sc, 5)
    sc.cycles.adaptive_threshold = 0.04
    scene.view("AgX", look="AgX - Punchy" if variant == "day" else "AgX - High Contrast", exposure=0.25 if variant == "day" else 0.4)
    sky_world(variant, strength=1.0 if variant == "day" else 1.3)
    key_light(variant)
    cam = build_camera()
    rails.set_at(s)
    bpy.context.view_layer.update()
    cpos = cam.matrix_world.translation
    clouds = build_clouds((cpos.x, cpos.y))
    planes = stage_planes(variant, cam)
    return sc, cam, clouds, planes


TAGS = [0.2, 1.3, 2.05, 2.9]


def step_preview():
    for variant in args.variants:
        sc, cam, clouds, planes = stage(args.s, variant, res=(960, 600))
        t0 = time.time()
        render_safe(render.still, OUT / f"preview-{variant}-{args.s:.2f}.png")
        cli.log("preview", variant, args.s, "in", round(time.time() - t0, 1), "s")


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    anchor = np.array(WORLD["flock"]["anchor"])
    for variant in args.variants:
        for s in tags:
            sc, cam, clouds, planes = stage(s, variant)
            back = clouds["near"] + clouds["far"] + clouds["towers"]
            cp = np.array(fl.rail_keys()[0]["pos"])
            for k in fl.rail_keys():
                if k["s"] <= s:
                    cp = np.array(k["pos"])
            flock_d = float(np.clip(np.linalg.norm(anchor - cp), 8, 60))
            t0 = time.time()
            render_safe(render.layers, cam, s, [("back", back), ("front", planes)], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 400.0, "front": flock_d})
            cli.log("layers", variant, s, "in", round(time.time() - t0, 1), "s")


def step_pano():
    s = 0.75
    for variant in args.variants:
        sc, cam, clouds, planes = stage(s, variant, samples=args.samples or 16)
        rails.set_at(s)
        loc = cam.matrix_world.translation.copy()
        d = light_dir(variant)
        yaw = math.degrees(math.atan2(d.y, d.x))
        png = OUT / f"pano-{variant}.png"
        render_safe(render.panorama, png, loc, res=(4096, 2048), samples=sc.cycles.samples, look_yaw_deg=yaw)
        cli.log("pano", variant, png)


def step_cloudtest():
    variant = args.variants[0]
    scene.reset()
    sc = scene.cycles(samples=args.samples or 16, bounces=8, res=(960, 600))
    cl.volume_settings(sc, 5)
    scene.view("AgX", look="AgX - Punchy" if variant == "day" else "AgX - High Contrast", exposure=0.25)
    sky_world(variant, strength=1.0)
    key_light(variant)
    build_clouds((0.0, 0.0), far=False)
    cam = build_camera()
    rails.set_at(args.s)
    render_safe(render.still, OUT / f"cloudtest-{variant}.png")


STEPS = {
    "print": step_print,
    "plane": step_plane,
    "mini": step_mini,
    "rail": step_rail,
    "atlas": step_atlas,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "cloudtest": step_cloudtest,
}
EXPLICIT = {"preview", "cloudtest"}

for name, fn in STEPS.items():
    if (name in EXPLICIT and name in args.steps.split(",")) or (name not in EXPLICIT and cli.want(args, name)):
        fn()
