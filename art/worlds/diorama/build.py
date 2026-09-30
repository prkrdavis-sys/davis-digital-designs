"""Homepage diorama: a tilt-shift tabletop island of every world.

Steps:
  rail      camera rail -> rails.json + layout.json
  preview   Cycles stills at --s (half res unless --samples)
  bake      static island GI -> terrain-<variant>.glb
  layers    Low Resources depth layers (re-runnable once minis land)
  pano      4096x2048 equirect from the middle of the island
  mini      tiny island for other dioramas -> lo/mini.glb

`layers` and `pano` rebuild the island and HEAD-check
public/worlds/<scene>/lo/mini.glb, so they can be re-rendered after the
other worlds merge their miniatures.
"""

import json
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402
from ddd.bake import EMISSIVE_HEADROOM  # noqa: E402
from ddd.cli import CACHE, PUBLIC_WORLDS  # noqa: E402

import layout as L  # noqa: E402
import look  # noqa: E402

SCENE_ID = "diorama"
HDRI = CACHE / "polyhaven" / "hdri" / "venice_sunset" / "venice_sunset_2k.hdr"


def extra_args(p):
    p.add_argument("--s", default="0.05,1.15,2.0")
    p.add_argument("--tags", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)


def n2(x, y, s=1.0):
    return (
        math.sin(x * 3.17 * s + y * 1.71 * s) * 0.42
        + math.sin(x * 6.83 * s - y * 4.19 * s) * 0.27
        + math.sin(x * 13.1 * s + y * 9.07 * s) * 0.11
    )


def ellipse(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2


def island_field(x, y):
    """Positive inside land. Offset lobes + noisy coast, three islets, causeways."""
    e1 = 1.0 - ellipse(x, y, 1.55, -1.85, 3.55, 3.05)
    e2 = 1.0 - ellipse(x, y, -1.85, 1.55, 3.45, 2.95)
    main = max(e1, e2) + 0.14 * n2(x, y, 0.32)
    bite = max(0.0, 1.0 - ellipse(x, y, 3.85, 3.7, 1.7, 1.5))
    main -= 0.22 * bite
    for _pid, px, py, *_rest in L.PLOTS:
        d2 = (x - px) ** 2 + (y - py) ** 2
        main = max(main, 1.0 - d2 / (1.25 ** 2))
    ev = 1.0 - ellipse(x, y, 0.38, 6.48, 1.52, 1.38)
    du = 1.0 - ellipse(x, y, -6.18, -3.78, 1.48, 1.32)
    pl = 1.0 - ellipse(x, y, 6.38, -2.32, 1.32, 1.18)
    b_ev = 1.0 - ellipse(x, y, 0.55, 4.55, 0.48, 1.35)
    b_du = 1.0 - ellipse(x, y, -4.55, -2.85, 1.45, 0.42)
    b_pl = 1.0 - ellipse(x, y, 4.35, -2.95, 1.45, 0.38)
    return max(main, ev, du, pl, b_ev * 0.9, b_du * 0.9, b_pl * 0.9)


def pond_field(x, y):
    return 1.0 - ellipse(x, y, L.POND["cx"], L.POND["cy"], L.POND["rx"], L.POND["ry"])


def height_at(x, y, presence=None):
    p = island_field(x, y) if presence is None else presence
    if p <= 0.0:
        return -0.02
    h = 0.08 + 0.34 * max(0.0, p) ** 1.05 + 0.08 * n2(x, y, 0.48)
    for pid, px, py, *_ in L.PLOTS:
        d2 = (x - px) ** 2 + (y - py) ** 2
        h += 0.16 * math.exp(-d2 / (0.62 if pid in ("everest", "dunes", "planes") else 0.88))
    pond = pond_field(x, y)
    if pond > 0.0:
        bowl = min(1.0, pond)
        h = h * (1.0 - bowl * 0.92) + 0.012 * bowl
    if 0.0 < p < 0.22:
        h += 0.09 * (p / 0.22) * (1.0 - p / 0.22) * 4.0
    if pid_near_everest(x, y):
        h += 0.28 * max(0.0, 1.0 - ellipse(x, y, 0.38, 6.48, 0.85, 0.75))
    return h


def pid_near_everest(x, y):
    return (x - 0.38) ** 2 + (y - 6.48) ** 2 < 2.6


def pad_top(px, py):
    return height_at(px, py) + L.PAD_H * 0.55


# --------------------------------------------------------------------------
# Terrain
def make_island(name="island", res=86, extent=9.4):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=extent)
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        p = island_field(x, y)
        v.co.z = height_at(x, y, p) if p > -0.04 else -0.06
    dead = [f for f in bm.faces if sum(1 for v in f.verts if island_field(v.co.x, v.co.y) < -0.03 or pond_field(v.co.x, v.co.y) > 0.28) >= 3]
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.edges.ensure_lookup_table()
    boundary = [e for e in bm.edges if e.is_boundary]
    if boundary:
        ret = bmesh.ops.extrude_edge_only(bm, edges=boundary)
        verts = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
        for v in verts:
            v.co.z = -0.18
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = geo.obj_from_bmesh(name, bm)
    geo.displace_noise(o, strength=0.018, scale=0.55, detail=2, name="soil")
    geo.apply_all(o)
    geo.smooth(o, 55)
    return o


def make_table():
    o = geo.primitive("cylinder", "table", radius=L.TABLE_R, depth=L.TABLE_H, segments=96)
    o.location.z = -L.TABLE_H * 0.5 - 0.01
    geo.bevel(o, width=0.045, segments=3, angle_deg=40)
    geo.apply_all(o)
    geo.smooth(o, 35)
    return o


def make_pond():
    o = geo.primitive("cylinder", "pond", radius=1.0, depth=0.05, segments=48)
    sx, sy = L.POND["rx"] * 1.08, L.POND["ry"] * 1.08
    o.data.transform(Matrix.Diagonal((sx, sy, 1.0, 1.0)))
    o.location = (L.POND["cx"], L.POND["cy"], L.POND["z"])
    bpy.context.view_layer.update()
    cli.log("pond dims", [round(x, 3) for x in o.dimensions], "at", [round(x, 3) for x in o.location])
    return o


def _polyline_pts(xy, z_fn, n=None):
    pts = []
    for i, (x, y) in enumerate(xy):
        pts.append((x, y, z_fn(x, y)))
    return pts


def make_path(xy, name, radius=0.15):
    dense = []
    for i in range(len(xy) - 1):
        a, b = xy[i], xy[i + 1]
        steps = max(3, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.26))
        for k in range(steps):
            t = k / steps
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    dense.append(xy[-1])
    pts = []
    for x, y in dense:
        if pond_field(x, y) > 0.15:
            continue
        if island_field(x, y) < 0.04:
            continue
        pts.append((x, y, height_at(x, y) + 0.02))
    if len(pts) < 2:
        return None
    o = geo.tube(name, pts, radius=radius, segments=7, caps=True)
    geo.set_origin_world(o)
    for v in o.data.vertices:
        ground = height_at(v.co.x, v.co.y) + 0.016
        v.co.z = ground + max(-0.02, min(0.03, (v.co.z - ground) * 0.25))
    geo.smooth(o, 70)
    return o


def make_bridge(a, b, name):
    pts = []
    for k in range(13):
        t = k / 12
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        z = max(height_at(x, y), 0.08) + 0.42 * math.sin(t * math.pi) + 0.04
        pts.append((x, y, z))
    deck = geo.tube(f"{name}_deck", pts, radius=0.09, segments=8)
    rail_l, rail_r = [], []
    for k, p in enumerate(pts):
        t = k / 12
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        sx, sy = -dy / ln * 0.11, dx / ln * 0.11
        rail_l.append((p[0] + sx, p[1] + sy, p[2] + 0.07))
        rail_r.append((p[0] - sx, p[1] - sy, p[2] + 0.07))
    r1 = geo.tube(f"{name}_r1", rail_l, radius=0.018, segments=6)
    r2 = geo.tube(f"{name}_r2", rail_r, radius=0.018, segments=6)
    o = geo.join([deck, r1, r2], name)
    geo.smooth(o, 40)
    return o


def make_tree(name, kind, scale):
    h = 0.52 * scale
    trunk = geo.primitive("cylinder", f"{name}_t", radius=0.026 * scale, depth=h * 0.55, segments=8)
    trunk.location.z = h * 0.22
    if kind == "pine":
        top = geo.primitive("cylinder", f"{name}_f", radius=0.18 * scale, radius2=0.02, depth=h * 0.78, segments=8)
        top.location.z = h * 0.58
    else:
        top = geo.primitive("ico", f"{name}_f", radius=0.20 * scale, subdiv=2)
        top.location.z = h * 0.58
    o = geo.join([trunk, top], name)
    geo.smooth(o, 50)
    return o


def place_trees():
    out = []
    n = 0
    for i in range(56):
        a = i / 56 * math.tau + 0.27
        x = y = None
        for r in (6.4, 5.7, 5.0, 4.3, 3.6, 3.0):
            tx, ty = r * math.cos(a), r * math.sin(a) * 0.95
            if island_field(tx, ty) > 0.2 and pond_field(tx, ty) < 0.0:
                if any((tx - p[1]) ** 2 + (ty - p[2]) ** 2 < 0.85 for p in L.PLOTS):
                    continue
                x, y = tx, ty
                break
        if x is None:
            continue
        # Keep the CTA close-up clear of foreground trees.
        if x > 1.2 and y < -2.6:
            continue
        kind = "pine" if i % 3 else "round"
        o = make_tree(f"tree_{n}", kind, 0.85 + (i % 5) * 0.08)
        o.location = (x, y, height_at(x, y))
        o.rotation_euler.z = i * 0.7
        o["kind"] = kind
        out.append(o)
        n += 1
    # A few extras on the islets.
    for k, (x, y, sc) in enumerate(((0.9, 6.9, 0.7), (-6.6, -3.3, 0.55), (6.7, -1.85, 0.6), (-4.2, 2.6, 0.9))):
        if island_field(x, y) < 0.1:
            continue
        o = make_tree(f"tree_x{k}", "pine" if k % 2 else "round", sc)
        o.location = (x, y, height_at(x, y))
        o["kind"] = "pine" if k % 2 else "round"
        out.append(o)
    return out


def make_pad(name, x, y):
    z = height_at(x, y)
    o = geo.primitive("cylinder", name, radius=L.PAD_R, depth=L.PAD_H, segments=32)
    o.location = (x, y, z + L.PAD_H * 0.35)
    geo.bevel(o, width=0.018, segments=2)
    geo.apply_all(o)
    geo.smooth(o, 40)
    return o


def make_lantern(name, x, y):
    pole = geo.primitive("cylinder", f"{name}_p", radius=0.014, depth=0.46, segments=8)
    pole.location = (x, y, height_at(x, y) + 0.22)
    bulb = geo.primitive("ico", f"{name}_b", radius=0.032, subdiv=1)
    bulb.location = (x, y, height_at(x, y) + 0.48)
    shade = geo.primitive("cylinder", f"{name}_s", radius=0.05, radius2=0.04, depth=0.04, segments=8)
    shade.location = (x, y, height_at(x, y) + 0.52)
    o = geo.join([pole, bulb, shade], name)
    return o


def lantern_sites():
    pts = []
    for i in range(0, len(L.PATH) - 1, 2):
        a, b = L.PATH[i], L.PATH[(i + 1) % (len(L.PATH) - 1)]
        x, y = (a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5
        if pond_field(x, y) > 0.2:
            continue
        pts.append((x, y))
    return pts[:10]


def make_rocks():
    out = []
    spots = [
        (4.4, -3.4, 0.14),
        (-4.6, 2.1, 0.12),
        (1.8, 4.6, 0.1),
        (-2.2, -4.3, 0.11),
        (5.2, 0.8, 0.09),
        (-5.4, -1.2, 0.13),
        (0.9, -4.6, 0.08),
        (-0.6, 5.4, 0.16),
    ]
    for i, (x, y, r) in enumerate(spots):
        if island_field(x, y) < 0.05:
            continue
        o = geo.primitive("ico", f"rock_{i}", radius=r, subdiv=2)
        o.location = (x, y, height_at(x, y) + r * 0.35)
        o.scale = (1.0, 0.85, 0.55)
        o.rotation_euler = (0.2 * i, 0.15 * i, i * 0.6)
        geo.apply_all(o)
        geo.smooth(o, 50)
        out.append(o)
    return out


def make_lilies():
    out = []
    spots = [(0.35, 0.15), (-0.4, 0.35), (0.55, -0.4), (-0.15, -0.55), (0.1, 0.7)]
    for i, (x, y) in enumerate(spots):
        pad = geo.primitive("cylinder", f"lily_{i}", radius=0.11 + i * 0.012, depth=0.012, segments=16)
        pad.location = (L.POND["cx"] + x, L.POND["cy"] + y, L.POND["z"] + 0.01)
        out.append(pad)
    return out


def make_flowers():
    out = []
    colors = [look.lin(c) for c in ("#ff7fb2", "#ffcf4d", "#9dbcff", "#ff9f86", "#8fe0bd")]
    n = 0
    for i in range(70):
        a = i * 2.399 + 0.4
        r = 2.35 + (i % 7) * 0.18
        x, y = L.POND["cx"] + math.cos(a) * r, L.POND["cy"] + math.sin(a) * r * 0.82
        if island_field(x, y) < 0.2 or pond_field(x, y) > 0.02:
            continue
        if any((x - p[1]) ** 2 + (y - p[2]) ** 2 < 0.55 for p in L.PLOTS):
            continue
        bloom = geo.primitive("ico", f"flower_{n}", radius=0.045 + (i % 3) * 0.008, subdiv=1)
        bloom.location = (x, y, height_at(x, y) + 0.04)
        mat.assign(bloom, look.glossy_toy(f"flower_m_{n}", colors[i % 5]))
        out.append(bloom)
        n += 1
    return out


def make_reeds():
    out = []
    for i in range(16):
        a = i / 16 * math.tau + 0.2
        x = L.POND["cx"] + math.cos(a) * (L.POND["rx"] + 0.12)
        y = L.POND["cy"] + math.sin(a) * (L.POND["ry"] + 0.12)
        if island_field(x, y) < 0.05:
            continue
        reed = geo.primitive("cylinder", f"reed_{i}", radius=0.012, depth=0.16 + (i % 4) * 0.03, segments=5)
        reed.location = (x, y, L.POND["z"] + 0.1)
        mat.assign(reed, look.foliage(f"reed_{i}", look.lin("#4a7a38"), "day"))
        out.append(reed)
    return out


def make_dock():
    boards = []
    for i in range(4):
        b = geo.primitive("cube", f"dock_{i}", size=1.0)
        b.scale = (0.18, 0.55, 0.035)
        b.location = (L.POND["cx"] + L.POND["rx"] * 0.72, L.POND["cy"] - 0.85 + i * 0.02, height_at(L.POND["cx"] + L.POND["rx"] * 0.72, L.POND["cy"] - 0.85) + 0.03)
        b.rotation_euler.z = math.radians(-18)
        geo.apply_all(b)
        boards.append(b)
    post = geo.primitive("cylinder", "dock_post", radius=0.03, depth=0.28, segments=8)
    post.location = (L.POND["cx"] + L.POND["rx"] * 0.82, L.POND["cy"] - 1.05, height_at(L.POND["cx"] + L.POND["rx"] * 0.82, L.POND["cy"] - 1.05) + 0.12)
    return geo.join(boards + [post], "dock")


# --------------------------------------------------------------------------
# Miniatures
def _placeholder_mesh(pid, kind, color, glow, night):
    body = None
    if kind == "star":
        body = geo.primitive("ico", f"{pid}_body", radius=0.28, subdiv=2)
        body.scale = (1.0, 1.0, 0.42)
        geo.apply_all(body)
    elif kind == "arch":
        body = geo.primitive("torus", f"{pid}_body", major=0.22, minor=0.055, u=20, v=8)
        body.rotation_euler.x = math.radians(90)
        geo.apply_all(body)
        body.location.z = 0.22
    elif kind == "frame":
        body = geo.primitive("cube", f"{pid}_body", size=1.0)
        body.scale = (0.38, 0.06, 0.48)
        geo.apply_all(body)
        body.location.z = 0.32
    elif kind == "sphere":
        body = geo.primitive("sphere", f"{pid}_body", radius=0.26, u=20, v=12)
        body.location.z = 0.26
    elif kind == "glass":
        body = geo.primitive("cube", f"{pid}_body", size=1.0)
        body.scale = (0.32, 0.22, 0.38)
        geo.apply_all(body)
        body.location.z = 0.28
        geo.bevel(body, width=0.03, segments=2)
        geo.apply_all(body)
    elif kind == "helix":
        pts = []
        for k in range(28):
            t = k / 27
            a = t * math.tau * 2.2
            pts.append((math.cos(a) * 0.14, math.sin(a) * 0.14, t * 0.62))
        body = geo.tube(f"{pid}_body", pts, radius=0.035, segments=7)
    elif kind == "table":
        body = geo.primitive("cube", f"{pid}_body", size=1.0)
        body.scale = (0.42, 0.24, 0.08)
        geo.apply_all(body)
        body.location.z = 0.22
        legs = []
        for sx, sy in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
            lg = geo.primitive("cylinder", f"{pid}_leg{sx}{sy}", radius=0.02, depth=0.16, segments=6)
            lg.location = (sx * 0.16, sy * 0.08, 0.1)
            legs.append(lg)
        body = geo.join([body, *legs], f"{pid}_body")
    elif kind == "globe":
        stem = geo.primitive("cylinder", f"{pid}_stem", radius=0.06, depth=0.1, segments=10)
        stem.location.z = 0.05
        ball = geo.primitive("sphere", f"{pid}_ball", radius=0.22, u=18, v=12)
        ball.location.z = 0.30
        body = geo.join([stem, ball], f"{pid}_body")
    elif kind == "peak":
        body = geo.primitive("cylinder", f"{pid}_body", radius=0.28, radius2=0.02, depth=0.62, segments=8)
        body.location.z = 0.32
    elif kind == "cone":
        body = geo.primitive("cylinder", f"{pid}_body", radius=0.30, radius2=0.04, depth=0.28, segments=12)
        body.location.z = 0.16
        mono = geo.primitive("cube", f"{pid}_m", size=1.0)
        mono.scale = (0.06, 0.06, 0.34)
        geo.apply_all(mono)
        mono.location.z = 0.38
        body = geo.join([body, mono], f"{pid}_body")
    elif kind == "plane":
        body = geo.primitive("cube", f"{pid}_body", size=1.0)
        body.scale = (0.42, 0.18, 0.03)
        geo.apply_all(body)
        body.location.z = 0.28
        body.rotation_euler = (math.radians(12), 0, math.radians(20))
        stand = geo.primitive("cylinder", f"{pid}_st", radius=0.03, depth=0.22, segments=8)
        stand.location.z = 0.12
        body = geo.join([body, stand], f"{pid}_body")
    else:
        body = geo.primitive("ico", f"{pid}_body", radius=0.24, subdiv=2)
        body.location.z = 0.24
    plinth = geo.primitive("cylinder", f"{pid}_plinth", radius=0.30, depth=0.08, segments=20)
    plinth.location.z = 0.04
    mat.assign(plinth, look.clay(f"{pid}_plinth", look.lin("#e8d4c4" if not night else "#6a5a62"), rough=0.62))
    if kind == "glass":
        mat.assign(body, mat.glass(f"{pid}_glass", tint=color, rough=0.04, ior=1.45))
    elif kind == "globe":
        mat.assign(body, mat.glass(f"{pid}_globe", tint=color, rough=0.02, ior=1.5))
    else:
        mat.assign(body, look.glossy_toy(f"{pid}_toy", color, night=night, glow=glow if night else None))
    o = geo.join([plinth, body], f"mini_{pid}")
    geo.smooth(o, 45)
    export.tag(o, plot=pid, placeholder=True)
    return o


def _import_mini(path, pid):
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=str(path))
    except RuntimeError as exc:
        cli.log("mini import failed", pid, exc)
        leftover = [o for o in bpy.data.objects if o not in before]
        for o in leftover:
            bpy.data.objects.remove(o, do_unlink=True)
        return None
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    empties = [o for o in new if o.type != "MESH"]
    if not meshes:
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        return None
    for o in meshes:
        geo.set_origin_world(o)
    o = geo.join(meshes, f"mini_{pid}") if len(meshes) > 1 else meshes[0]
    o.name = f"mini_{pid}"
    for e in empties:
        if e.name in bpy.data.objects:
            bpy.data.objects.remove(e, do_unlink=True)
    geo.set_origin_world(o)
    bpy.context.view_layer.update()
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    extent = max(max(v[i] for v in bb) - min(v[i] for v in bb) for i in range(3))
    if extent > 1.05:
        o.data.transform(Matrix.Scale(0.92 / extent, 4))
        bpy.context.view_layer.update()
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = min(v.z for v in bb)
    o.location.z -= lo
    cli.log("mini size", pid, "extent", round(extent, 3))
    export.tag(o, plot=pid, placeholder=False)
    return o


def place_minis(variant):
    night = variant == "night"
    out = []
    for pid, x, y, yaw, kind, day, night_c, glow in L.PLOTS:
        path = PUBLIC_WORLDS / pid / "lo" / "mini.glb"
        color, g = L.palette(pid, variant)
        if path.exists():
            o = _import_mini(path, pid)
            if o is None:
                o = _placeholder_mesh(pid, kind, color, g, night)
            else:
                cli.log("mini import", pid, path)
        else:
            cli.log("mini placeholder", pid)
            o = _placeholder_mesh(pid, kind, color, g, night)
        o.location = (x, y, pad_top(x, y))
        o.rotation_euler.z = math.radians(yaw)
        out.append(o)
        if night:
            look.plot_lamp(f"glow_{pid}", (x, y, pad_top(x, y) + 0.55), look.lin(glow), 18)
    return out


# --------------------------------------------------------------------------
# Materials
def assign_static(parts, variant):
    night = variant == "night"
    mat.assign(parts["island"], look.grass(f"grass_{variant}", variant))
    # Cliff faces get a clay override via a second slot + height-based? Keep one grass
    # material; the underside is in shadow and reads as soil after the bake.
    mat.assign(parts["table"], look.wood(f"table_{variant}", look.lin("#6b3f24" if not night else "#2a1c18"), rough=0.5))
    for p in parts["paths"]:
        mat.assign(p, look.path_gravel(f"path_{variant}", variant))
    for b in parts["bridges"]:
        mat.assign(b, look.wood(f"bridge_{variant}", look.lin("#b8895a" if not night else "#4a3428")))
    mat.assign(parts["dock"], look.wood(f"dock_{variant}", look.lin("#c49862" if not night else "#4a3828")))
    for r in parts["rocks"]:
        mat.assign(r, look.clay(f"rock_{variant}", look.lin("#b8a090" if not night else "#4a4038"), rough=0.78, bump=0.16))
    for lily in parts["lilies"]:
        mat.assign(lily, look.foliage(f"lily_{variant}", look.lin("#6aaa4a" if not night else "#2a5a38"), variant))
    for pad in parts["pads"]:
        mat.assign(pad, look.clay(f"pad_{variant}", look.lin("#e7d3c2" if not night else "#5a4a52"), rough=0.62))
    pine = look.foliage(f"pine_{variant}", look.lin("#2f6a3a" if not night else "#1a3a28"), variant)
    round_f = look.foliage(f"round_{variant}", look.lin("#7cb85a" if not night else "#2a4a32"), variant)
    bark = look.wood(f"bark_{variant}", look.lin("#6a4430" if not night else "#2a1c16"), rough=0.8)
    for t in parts["trees"]:
        mat.assign(t, pine if t.get("kind") == "pine" else round_f)
        if t.data.materials:
            t.data.materials.append(bark)
    glass = look.lamp_glass(f"lamp_{variant}", night)
    iron = look.clay(f"iron_{variant}", look.lin("#3a3030" if not night else "#1a1418"), rough=0.45)
    for ln in parts["lanterns"]:
        mat.assign(ln, iron)
        if ln.data.materials:
            ln.data.materials.append(glass)
        mat.assign(parts["water"], look.water(f"water_{variant}", look.lin("#3a7ab0" if not night else "#102040"), rough=0.08 if not night else 0.14))


def build_static():
    island = make_island()
    table = make_table()
    water = make_pond()
    paths = [p for p in [make_path(L.PATH, "path_main", 0.155)] if p]
    for i, (a, b) in enumerate(L.SPURS):
        p = make_path([a, b], f"path_spur_{i}", 0.11)
        if p:
            paths.append(p)
    bridges = [make_bridge(a, b, f"bridge_{i}") for i, (a, b) in enumerate(L.SPURS)]
    trees = place_trees()
    pads = [make_pad(f"pad_{p[0]}", p[1], p[2]) for p in L.PLOTS]
    lanterns = [make_lantern(f"lantern_{i}", x, y) for i, (x, y) in enumerate(lantern_sites())]
    rocks = make_rocks()
    lilies = make_lilies()
    flowers = make_flowers()
    reeds = make_reeds()
    dock = make_dock()
    return {
        "island": island,
        "table": table,
        "water": water,
        "paths": paths,
        "bridges": bridges,
        "trees": trees,
        "pads": pads,
        "lanterns": lanterns,
        "rocks": rocks,
        "lilies": lilies,
        "flowers": flowers,
        "reeds": reeds,
        "dock": dock,
    }


def static_list(parts):
    # Table is a huge disc — keep it out of the atlas so grass and props get the texels.
    out = [parts["island"], parts["dock"], *parts["paths"], *parts["bridges"], *parts["trees"], *parts["pads"], *parts["lanterns"], *parts["rocks"], *parts["lilies"], *parts["flowers"], *parts["reeds"]]
    return [o for o in out if o is not None]


# --------------------------------------------------------------------------
# Camera
def garden_subject():
    x, y = 2.58, -3.88
    return Vector((x, y, pad_top(x, y) + 0.45))


def island_center():
    return Vector((0.15, 0.1, 0.45))


def orbit_pos(subject, az_deg, radius, height):
    a = math.radians(az_deg)
    return Vector((subject.x + radius * math.cos(a), subject.y + radius * math.sin(a), height))


def rail_keys():
    g = garden_subject()
    c = island_center()
    # az, radius, height, subject, shift, fov, roll — orbit while crane-up.
    raw = [
        (0.00, 232, 2.55, 1.38, g, 0.32, 36, -2.0),
        (0.32, 208, 2.70, 1.52, g, 0.30, 37, -1.2),
        (0.62, 182, 3.15, 1.85, g.lerp(c, 0.15), 0.26, 38, -0.4),
        (0.92, 155, 4.60, 2.55, g.lerp(c, 0.45), 0.18, 37, 0.2),
        (1.18, 128, 6.40, 3.15, c, 0.08, 36, 0.4),
        (1.48, 102, 8.40, 4.05, c, 0.03, 34, 0.2),
        (1.78, 78, 10.60, 5.05, c, 0.00, 33, 0.0),
        (2.00, 62, 13.20, 5.65, c, 0.00, 32, 0.0),
        (2.20, 52, 14.20, 6.05, c, 0.00, 31, 0.0),
    ]
    keys = []
    for s, az, r, h, sub, shift, fov, roll in raw:
        pos = orbit_pos(sub, az, r, h)
        look_at = look.aim_right(pos, sub, shift)
        keys.append({"s": s, "pos": tuple(pos), "look": tuple(look_at), "fov": fov, "roll": roll})
    return keys


def build_camera():
    cam = scene.camera(lens=35)
    cam.data.clip_start = 0.08
    cam.data.clip_end = 220
    rails.key(cam, rail_keys())
    return cam


# --------------------------------------------------------------------------
# Stage
def stage(variant, samples=None):
    scene.reset()
    sc = scene.cycles(samples=samples or args.samples or (20 if args.preview else 48), bounces=6, res=(1920, 1200))
    sc.cycles.transmission_bounces = 10
    if variant == "day":
        scene.view("AgX", look="AgX - Medium High Contrast", exposure=-0.05)
    else:
        scene.view("AgX", look="AgX - High Contrast", exposure=0.25)
    look.studio(variant, HDRI if HDRI.exists() else None)
    parts = build_static()
    assign_static(parts, variant)
    minis = place_minis(variant)
    cam = build_camera()
    return sc, cam, parts, minis


def write_layout():
    plots = []
    for pid, x, y, yaw, kind, day, night_c, glow in L.PLOTS:
        z = pad_top(x, y)
        plots.append(
            {
                "id": pid,
                "p": L.to_three((x, y, z)),
                "yaw": round(math.radians(yaw), 4),
                "kind": kind,
                "day": day,
                "night": night_c,
                "glow": glow,
            }
        )
    data = {
        "sMax": L.S_MAX,
        "pond": {
            "c": L.to_three((L.POND["cx"], L.POND["cy"], L.POND["z"])),
            "rx": L.POND["rx"],
            "rz": L.POND["ry"],
        },
        "table": {"radius": L.TABLE_R, "height": L.TABLE_H},
        "plots": plots,
        "focus": [
            {"s": 0.0, "p": L.to_three(garden_subject())},
            {"s": 0.85, "p": L.to_three(garden_subject().lerp(island_center(), 0.4))},
            {"s": 1.4, "p": L.to_three(island_center())},
            {"s": 2.0, "p": L.to_three(island_center())},
        ],
    }
    path = PUB / "hi" / "layout.json"
    path.write_text(json.dumps(data, indent=1))
    cli.log("layout", path)


# --------------------------------------------------------------------------
# Steps
def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", L.S_MAX)
    write_layout()
    cli.log("rail written", PUB / "rails.json")


def step_preview():
    for variant in args.variants:
        sc, cam, parts, minis = stage(variant)
        if not args.samples:
            sc.render.resolution_percentage = 50
        for s in [float(x) for x in str(args.s).split(",")]:
            rails.set_at(s)
            render.still(OUT / f"preview-{variant}-{s:.2f}.png")
            cli.log("preview", variant, s)


def _ascii_uvs(obj, keep="bake"):
    """Blender 5 can hand back non-utf8 UV names after a big join; force ASCII."""
    for layer in list(obj.data.uv_layers):
        try:
            name = layer.name
        except UnicodeDecodeError:
            name = ""
        if name != keep:
            try:
                layer.name = "src"
            except (UnicodeDecodeError, RuntimeError):
                try:
                    obj.data.uv_layers.remove(layer)
                except Exception:
                    pass
    uv = obj.data.uv_layers.get(keep) or obj.data.uv_layers.new(name=keep)
    try:
        uv.name = keep
    except UnicodeDecodeError:
        pass
    obj.data.uv_layers.active = uv
    return keep


def bake_terrain(objs, name, out_dir, size=2048, samples=72):
    """Local bake_group that never reads uv.name (shared helper can throw UnicodeDecodeError)."""
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    joined = geo.join(objs, name) if len(objs) > 1 else objs[0]
    joined.name = name
    _ascii_uvs(joined, "bake")
    bake._select_only([joined], joined)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
    try:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.003, shape_method="CONCAVE")
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    _ascii_uvs(joined, "bake")
    img = bpy.data.images.new(f"{name}_bake", size, size, alpha=False, float_buffer=True)
    try:
        img.colorspace_settings.name = "Linear Rec.709"
    except TypeError:
        img.colorspace_settings.name = "Linear"
    for m in joined.data.materials:
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
    prev = sc.cycles.samples
    sc.cycles.samples = samples
    sc.render.bake.margin = 12
    sc.render.bake.use_clear = True
    bake._select_only([joined], joined)
    cli.log("baking", name, f"{size}px", f"{samples}spp")
    bpy.ops.object.bake(type="COMBINED", pass_filter={"EMIT", "DIRECT", "INDIRECT", "DIFFUSE"}, margin=12, use_clear=True)
    sc.cycles.samples = prev
    path = out_dir / f"{name}.png"
    bake.save_srgb(img, path, exposure=-1.0)
    baked = mat.principled(f"{name}_baked", base=(0, 0, 0), rough=0.62, metal=0.0, specular=0.5)
    b = mat.bsdf_of(baked)
    t = mat.image_node(baked, path, "sRGB", uv_map="bake")
    baked.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = EMISSIVE_HEADROOM * (2.0 ** (-(-1.0) - 1.0))
    joined.data.materials.clear()
    joined.data.materials.append(baked)
    for layer in list(joined.data.uv_layers):
        try:
            if layer.name != "bake":
                joined.data.uv_layers.remove(layer)
        except UnicodeDecodeError:
            joined.data.uv_layers.remove(layer)
    return joined


def step_bake():
    for variant in args.variants:
        sc, cam, parts, minis = stage(variant)
        # Hide live water and minis from the joined atlas (they stay real-time).
        static = static_list(parts)
        joined = bake_terrain(static, f"terrain_{variant}", OUT / "bake", size=2048, samples=args.samples or (48 if args.preview else 72))
        export.tag(joined, kind="baked", variant=variant)
        export.glb(OUT / f"terrain-{variant}.glb", [joined])


def bands_for(cam, parts, minis):
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    bands = {"back": [parts["table"]], "mid": [parts["island"], parts["water"], parts["dock"], *parts["paths"], *parts["bridges"], *parts["lilies"], *parts["reeds"]], "front": []}
    rest = [*parts["trees"], *parts["pads"], *parts["lanterns"], *parts["rocks"], *parts["flowers"], *minis]
    for o in rest:
        corners = [o.matrix_world @ Vector(cn) for cn in o.bound_box]
        cen = sum(corners, Vector()) / 8
        d = (cen - cpos).dot(fwd)
        if d > 9.5:
            bands["back"].append(o)
        elif d < 3.2:
            bands["front"].append(o)
        else:
            bands["mid"].append(o)
    return bands


TAGS = [0.08, 1.15, 2.00]


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, cam, parts, minis = stage(variant)
        for s in tags:
            rails.set_at(s)
            bpy.context.view_layer.update()
            bands = bands_for(cam, parts, minis)
            order = [(k, bands[k]) for k in ("back", "mid", "front") if bands[k] or k == "back"]
            render.layers(cam, s, order, OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": 28.0})


def step_pano():
    for variant in args.variants:
        sc, cam, parts, minis = stage(variant)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, Vector((0.18, 0.06, 1.55)), res=(4096, 2048), samples=args.samples or 40, look_yaw_deg=90)
        cli.log("pano", variant, png)


def step_mini():
    """A tiny island (~1 unit tall) sitting on a wooden disc at the origin."""
    scene.reset()
    island = make_island("mini_island", res=28, extent=9.4)
    table = make_table()
    pads = [make_pad(f"mini_pad_{p[0]}", p[1], p[2]) for p in L.PLOTS]
    mat.assign(island, look.grass("mini_grass", "day"))
    mat.assign(table, look.wood("mini_table", look.lin("#6b3f24")))
    for i, pad in enumerate(pads):
        pid = L.PLOTS[i][0]
        color, _ = L.palette(pid, "day")
        mat.assign(pad, look.glossy_toy(f"mini_dot_{pid}", color))
    o = geo.join([island, table, *pads], "mini_diorama")
    # Fit into a ~1 unit tall hero, sitting on z=0.
    dims = o.dimensions
    scale = 0.92 / max(dims.z, 0.001)
    o.data.transform(Matrix.Scale(scale, 4))
    lo = min(v.co.z for v in o.data.vertices)
    o.data.transform(Matrix.Translation((0, 0, -lo)))
    geo.decimate(o, min(1.0, 5200 / max(1, geo.triangle_count(o))))
    geo.apply_all(o)
    geo.smooth(o, 50)
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 3) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "rail": step_rail,
    "preview": step_preview,
    "bake": step_bake,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview",) or "preview" in args.steps):
        fn()
