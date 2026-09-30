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
    """Positive inside land. Main kidney + three islets + bridge causeways."""
    e1 = 1.0 - ellipse(x, y, 0.32, -0.42, 4.95, 4.45)
    e2 = 1.0 - ellipse(x, y, -0.55, 1.28, 3.85, 3.55)
    main = max(e1, e2) - 0.1 * max(0.0, 1.0 - ellipse(x, y, 3.4, 3.9, 2.1, 1.9))
    ev = 1.0 - ellipse(x, y, 0.38, 6.48, 1.58, 1.42)
    du = 1.0 - ellipse(x, y, -6.18, -3.78, 1.52, 1.36)
    pl = 1.0 - ellipse(x, y, 6.38, -2.32, 1.36, 1.22)
    b_ev = 1.0 - ellipse(x, y, 0.75, 4.95, 0.55, 1.55)
    b_du = 1.0 - ellipse(x, y, -4.75, -2.75, 1.55, 0.48)
    b_pl = 1.0 - ellipse(x, y, 4.45, -3.05, 1.55, 0.42)
    return max(main, ev, du, pl, b_ev * 0.85, b_du * 0.85, b_pl * 0.85)


def pond_field(x, y):
    return 1.0 - ellipse(x, y, L.POND["cx"], L.POND["cy"], L.POND["rx"], L.POND["ry"])


def height_at(x, y, presence=None):
    p = island_field(x, y) if presence is None else presence
    if p <= 0.0:
        return -0.02
    h = 0.10 + 0.22 * max(0.0, p) ** 1.15 + 0.045 * n2(x, y, 0.55)
    for pid, px, py, *_ in L.PLOTS:
        d2 = (x - px) ** 2 + (y - py) ** 2
        h += 0.10 * math.exp(-d2 / (0.72 if pid in ("everest", "dunes", "planes") else 0.95))
    pond = pond_field(x, y)
    if pond > 0.0:
        bowl = min(1.0, pond)
        h = h * (1.0 - bowl * 0.92) + 0.012 * bowl
    if 0.0 < p < 0.22:
        h += 0.07 * (p / 0.22) * (1.0 - p / 0.22) * 4.0
    if pid_near_everest(x, y):
        h += 0.18 * max(0.0, 1.0 - ellipse(x, y, 0.38, 6.48, 0.85, 0.75))
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
    dead = [f for f in bm.faces if sum(1 for v in f.verts if island_field(v.co.x, v.co.y) < -0.03) >= 3]
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
    o = geo.primitive("grid", "pond", x=28, y=22, size=1.0)
    sx, sy = L.POND["rx"] * 1.02, L.POND["ry"] * 1.02
    o.scale = (sx, sy, 1.0)
    o.location = (L.POND["cx"], L.POND["cy"], L.POND["z"])
    geo.apply_all(o)
    for v in o.data.vertices:
        x = o.location.x + v.co.x
        y = o.location.y + v.co.y
        v.co.z += 0.008 * n2(x * 2.2, y * 2.2)
    return o


def _polyline_pts(xy, z_fn, n=None):
    pts = []
    for i, (x, y) in enumerate(xy):
        pts.append((x, y, z_fn(x, y)))
    return pts


def make_path(xy, name, radius=0.15):
    def z(x, y):
        return max(L.POND["z"] + 0.02, height_at(x, y) + 0.012)

    dense = []
    for i in range(len(xy) - 1):
        a, b = xy[i], xy[i + 1]
        steps = max(3, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.28))
        for k in range(steps):
            t = k / steps
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    dense.append(xy[-1])
    o = geo.tube(name, _polyline_pts(dense, z), radius=radius, segments=8, caps=True)
    # Flatten into a gravel ribbon.
    for v in o.data.vertices:
        v.co.z = (v.co.z - o.location.z) * 0.18 + o.location.z
    # Re-seat onto terrain after flatten (tube was built in world space).
    geo.set_origin_world(o)
    for v in o.data.vertices:
        v.co.z = z(v.co.x, v.co.y) + 0.006
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
    for i in range(48):
        a = i / 48 * math.tau + 0.27
        r = 4.15 + 0.35 * math.sin(i * 2.3)
        x, y = r * math.cos(a) * 1.04, r * math.sin(a) * 0.92
        if island_field(x, y) < 0.18 or pond_field(x, y) > 0.05:
            continue
        if any((x - p[1]) ** 2 + (y - p[2]) ** 2 < 0.85 for p in L.PLOTS):
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


def make_dock():
    boards = []
    for i in range(4):
        b = geo.primitive("cube", f"dock_{i}", size=1.0)
        b.scale = (0.18, 0.55, 0.035)
        b.location = (1.35, -0.15 + i * 0.02, L.POND["z"] + 0.03)
        b.rotation_euler.z = math.radians(-18)
        geo.apply_all(b)
        boards.append(b)
    post = geo.primitive("cylinder", "dock_post", radius=0.03, depth=0.28, segments=8)
    post.location = (1.55, -0.35, L.POND["z"] + 0.1)
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
    bpy.ops.import_scene.gltf(filepath=str(path))
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
    # Sit on z=0, keep authored scale. Nudge if the importer left it floating.
    lo = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    if abs(lo) > 0.02:
        o.location.z -= lo
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
    mat.assign(parts["water"], look.water(f"water_{variant}", look.lin("#4a6fa0" if not night else "#0a1224"), rough=0.05 if not night else 0.08))


def build_static():
    island = make_island()
    table = make_table()
    water = make_pond()
    paths = [make_path(L.PATH, "path_main", 0.155)]
    for i, (a, b) in enumerate(L.SPURS):
        paths.append(make_path([a, b], f"path_spur_{i}", 0.11))
    bridges = [make_bridge(a, b, f"bridge_{i}") for i, (a, b) in enumerate(L.SPURS)]
    trees = place_trees()
    pads = [make_pad(f"pad_{p[0]}", p[1], p[2]) for p in L.PLOTS]
    lanterns = [make_lantern(f"lantern_{i}", x, y) for i, (x, y) in enumerate(lantern_sites())]
    rocks = make_rocks()
    lilies = make_lilies()
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
        "dock": dock,
    }


def static_list(parts):
    out = [parts["island"], parts["table"], parts["dock"], *parts["paths"], *parts["bridges"], *parts["trees"], *parts["pads"], *parts["lanterns"], *parts["rocks"], *parts["lilies"]]
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
        (0.92, 155, 4.40, 2.85, g.lerp(c, 0.45), 0.18, 37, 0.2),
        (1.18, 128, 6.10, 4.05, c, 0.08, 36, 0.4),
        (1.48, 102, 7.80, 5.35, c, 0.03, 34, 0.2),
        (1.78, 80, 9.40, 6.55, c, 0.00, 33, 0.0),
        (2.00, 66, 10.80, 7.45, c, 0.00, 32, 0.0),
        (2.20, 56, 11.60, 8.05, c, 0.00, 31, 0.0),
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
        scene.view("AgX", look="AgX - Medium High Contrast", exposure=0.15)
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


def step_bake():
    for variant in args.variants:
        sc, cam, parts, minis = stage(variant)
        # Hide live water and minis from the joined atlas (they stay real-time).
        static = static_list(parts)
        joined = bake.bake_group(static, f"terrain_{variant}", OUT / "bake", size=2048, samples=args.samples or (64 if args.preview else 96), roughness=0.62)
        export.tag(joined, kind="baked", variant=variant)
        export.glb(OUT / f"terrain-{variant}.glb", [joined])


def bands_for(cam, parts, minis):
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    bands = {"back": [parts["table"]], "mid": [parts["island"], parts["water"], parts["dock"], *parts["paths"], *parts["bridges"], *parts["lilies"]], "front": []}
    rest = [*parts["trees"], *parts["pads"], *parts["lanterns"], *parts["rocks"], *minis]
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
