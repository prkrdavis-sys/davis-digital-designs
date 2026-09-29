"""Featured work: a luminous marble hall where the featured projects hang as
lit, framed artworks.

Steps (run with --steps a,b,...):
  covers    featured projects (content/work/*.mdx) -> covers.json
  bake      per variant: hall shell, ceiling, furniture + floor lightmap -> hall-<v>.glb
  gallery   live PBR pieces (frames, lights, sculptures, stanchions) -> gallery.glb, layout.json
  rail      camera rail -> rails.json (rail time = scene s + OFFSET)
  preview   quick Cycles still at --s
  layers    Low Resources depth layers + posters (day/night)
  pano      360 from the middle of the hall
  mini      a tiny framed painting on an easel for the homepage diorama

Blender coordinates: the hall runs along +Y, artworks hang on the right
wall (+X). three.js = (x, z, -y).
"""

import json
import math
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "doors"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import classic as cl  # noqa: E402
import gallery as gl  # noqa: E402
import robust  # noqa: E402
from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402

robust.install()

SCENE_ID = "museum"
OFFSET = 0.15
S_MAX = 1.30


def extra_args(p):
    p.add_argument("--s", type=float, default=0.5)
    p.add_argument("--tags", default="")
    p.add_argument("--bake-size", type=int, default=2048)
    p.add_argument("--still-scale", type=float, default=1.0, help="resolution factor for layers and pano (quick passes)")


args = cli.parse([extra_args])
LAYER_RES = (int(1920 * args.still_scale), int(1200 * args.still_scale))
PANO_RES = (int(4096 * args.still_scale), int(2048 * args.still_scale))
OUT, PUB = cli.scene_dirs(SCENE_ID)
REPO = HERE.parents[2]
lin = cl.lin

HALL = {"x": 7.0, "y0": -10.0, "y1": 40.0, "ceil": 9.9, "col_x": 5.8, "col_h": 7.2, "col_r": 0.36, "bay": 6.5, "bay0": 0.0}
RIGHT_BAYS = [0.0, 6.5, 13.0, 19.5, 26.0]
LEFT_BAYS = [3.25, 16.25, 29.25]
ART_Z = 2.35
CANVAS_H = 1.45
CELL = 1.75
SKY_CELLS = [6, 14, 22]  # first ceiling row of each skylight (4 rows each)

PAL = {
    "day": {
        "wall": lin("#d9c7c1"),
        "wainscot": lin("#3b3a40"),
        "stone": lin("#f1ece6"),
        "stone_vein": lin("#c9bfb7"),
        "ceiling": lin("#f4efe7"),
        "gilt_trim": lin("#d6b06a"),
        "sky": lin("#bcd4ff"),
        "sun": (1.0, 0.93, 0.82),
        "sun_strength": 6.5,
        "spot": 260.0,
        "far": [lin("#fff5e6"), lin("#ffe9d2"), lin("#fff8ee")],
        "sky_strength": 0.9,
    },
    "night": {
        "wall": lin("#8c7f86"),
        "wainscot": lin("#1d1c22"),
        "stone": lin("#d6d2da"),
        "stone_vein": lin("#8e8a98"),
        "ceiling": lin("#bdb8c6"),
        "gilt_trim": lin("#c29a55"),
        "sky": lin("#0a1030"),
        "sun": (0.55, 0.66, 1.0),
        "sun_strength": 0.9,
        "spot": 420.0,
        "far": [lin("#1a1a38"), lin("#2a2550"), lin("#1a1a38")],
        "sky_strength": 0.25,
    },
}
SUN_DIR = {"day": Vector((-0.42, 0.22, 0.88)).normalized(), "night": Vector((-0.3, -0.25, 0.92)).normalized()}


def to_three(v):
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


# --------------------------------------------------------------------------
def read_featured(limit=6):
    """Mirror src/lib/content.ts getFeaturedProjects: year desc, featured, first `limit`."""
    items = []
    for f in sorted((REPO / "content" / "work").glob("*.mdx")):
        if f.name.startswith("_"):
            continue
        text = f.read_text()
        m = re.match(r"---\n(.*?)\n---", text, re.S)
        if not m:
            continue
        fm = {}
        for line in m.group(1).splitlines():
            mm = re.match(r'^(\w+):\s*(.*?)\s*(#.*)?$', line)
            if mm:
                fm[mm.group(1)] = mm.group(2).strip().strip('"')
        if fm.get("draft") == "true":
            continue
        items.append({"slug": f.stem, "title": fm.get("title", f.stem), "category": fm.get("category", ""), "year": int(fm.get("year", "0") or 0), "cover": fm.get("cover", ""), "featured": fm.get("featured") == "true", "accent": fm.get("accent", "#c9a86a")})
    items.sort(key=lambda p: -p["year"])
    feat = [p for p in items if p["featured"]]
    return (feat if len(feat) >= 3 else items)[:limit]


def cover_aspect(url):
    p = REPO / "public" / url.lstrip("/")
    try:
        import struct

        with open(p, "rb") as fh:
            head = fh.read(24)
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            w, h = struct.unpack(">II", head[16:24])
            return w / h
    except OSError:
        pass
    return 1.6


def hangings():
    """Where each featured cover hangs: right-wall bays first, extras on the left wall."""
    covers = read_featured()
    out = []
    for i, c in enumerate(covers):
        aspect = max(1.0, min(1.9, cover_aspect(c["cover"])))
        right = i < len(RIGHT_BAYS)
        y = RIGHT_BAYS[i] if right else LEFT_BAYS[(i - len(RIGHT_BAYS)) % len(LEFT_BAYS)]
        style = "gilded" if i % 2 == 0 else "modern"
        out.append({**c, "aspect": round(aspect, 4), "right": right, "y": y, "style": style, "cw": round(CANVAS_H * aspect, 4), "ch": CANVAS_H})
    return out


def step_covers():
    data = [{k: h[k] for k in ("slug", "title", "category", "year", "cover", "aspect")} for h in hangings()]
    (PUB / "covers.json").write_text(json.dumps(data, indent=1))
    cli.log("covers", [d["slug"] for d in data])


def art_matrix(h):
    """Canvas frame: local -Y faces into the hall, origin at the canvas centre on the wall."""
    x = HALL["x"] - 0.02
    if h["right"]:
        return Matrix.Translation((x - 0.001, h["y"], ART_Z)) @ Matrix.Rotation(math.radians(-90), 4, "Z")
    return Matrix.Translation((-x + 0.001, h["y"], ART_Z)) @ Matrix.Rotation(math.radians(90), 4, "Z")


# --------------------------------------------------------------------------
def build_hall(variant):
    """Static architecture split into bake groups: (walls, ceiling, furniture)."""
    pal = PAL[variant]
    h = HALL
    stone = cl.marble(f"stone_{variant}", pal["stone"], pal["stone_vein"], scale=1.1, rough=0.3, vein_amount=0.45)
    dark = cl.marble(f"dark_{variant}", pal["wainscot"], [min(1, c * 2.4) for c in pal["wainscot"]], scale=1.6, rough=0.2, vein_amount=0.5)
    wall = cl.plaster(f"wall_{variant}", pal["wall"], variation=0.04, scale=2.0, rough=0.9)
    ceil = cl.plaster(f"ceil_{variant}", pal["ceiling"], variation=0.03)
    trim = mat.principled(f"trim_{variant}", base=pal["gilt_trim"], rough=0.35, metal=0.0)
    walls, ceiling, furn = [], [], []
    L = h["y1"] - h["y0"]
    ym = (h["y0"] + h["y1"]) / 2
    for s in (-1, 1):
        x = s * h["x"]
        w = cl.box("wall", (0.4, L, h["ceil"]), (x + s * 0.2, ym, h["ceil"] / 2))
        mat.assign(w, wall)
        walls.append(w)
        wc = cl.box("wainscot", (0.06, L, 1.1), (x - s * 0.03, ym, 0.55))
        mat.assign(wc, dark)
        walls.append(wc)
        rail = cl.moulding("dado", L, [(-s * u, v) for u, v in [(0.0, 0.0), (0.05, 0.01), (0.06, 0.04), (0.035, 0.07), (0.0, 0.08)]], (x - s * 0.06, h["y0"], 1.08))
        mat.assign(rail, stone)
        walls.append(rail)
        base = cl.moulding("skirt", L, [(-s * u, v) for u, v in [(0.0, 0.0), (0.09, 0.0), (0.09, 0.12), (0.07, 0.16), (0.0, 0.2)]], (x - s * 0.06, h["y0"], 0.0))
        mat.assign(base, stone)
        walls.append(base)
        crown = cl.moulding("crown", L, [(-s * u, v) for u, v in [(0.0, 0.0), (0.04, 0.02), (0.1, 0.1), (0.22, 0.2), (0.3, 0.32), (0.3, 0.38), (0.0, 0.38)]], (x, h["y0"], h["ceil"] - 0.38))
        mat.assign(crown, stone)
        walls.append(crown)
        # Columns + entablature on each side, with cross beams back to the wall.
        cx = s * h["col_x"]
        for k in range(8):
            y = -3.25 + h["bay"] * k
            if y > h["y1"] - 1:
                break
            c = cl.column(f"col_{s}_{k}", h["col_h"], h["col_r"], (cx, y, 0.0), flutes=18, order="ionic")
            mat.assign(c, stone)
            walls.append(c)
            beam = cl.box("xbeam", (h["x"] - h["col_x"] + 0.3, 0.7, 1.1), ((cx + x) / 2, y, h["col_h"] + 0.55), bevel=0.01)
            mat.assign(beam, stone)
            walls.append(beam)
        for part, dz, dh, dw in (("architrave", 0.0, 0.5, 0.95), ("frieze", 0.5, 0.45, 0.85), ("cornice", 0.95, 0.2, 1.15)):
            e = cl.box(part, (dw, L, dh), (cx, ym, h["col_h"] + dz + dh / 2), bevel=0.008)
            mat.assign(e, stone)
            walls.append(e)
        gb = cl.box("gilt_band", (0.87, L, 0.05), (cx, ym, h["col_h"] + 0.72))
        mat.assign(gb, trim)
        walls.append(gb)
    # End walls: far one pierced by a grand arch onto the next (bright) gallery.
    for y, name, hole in ((h["y1"], "far", True), (h["y0"], "near", True)):
        wb = cl.box(f"{name}_wall", (2 * h["x"] + 0.8, 0.6, h["ceil"]), (0, y + (0.3 if y > 0 else -0.3), h["ceil"] / 2))
        if hole:
            cut = cl.arch_panel(f"{name}_cut", 2.2 if name == "far" else 1.4, 4.2 if name == "far" else 2.6, 0.0, n_arc=48, base=-0.5)
            sol = cut.modifiers.new("s", "SOLIDIFY")
            sol.thickness = 3.0
            sol.offset = 0.0
            geo.apply_all(cut)
            cut.location = (0, y, 0)
            boo = wb.modifiers.new("hole", "BOOLEAN")
            boo.operation = "DIFFERENCE"
            boo.solver = "EXACT"
            boo.object = cut
            geo.apply_all(wb)
            bpy.data.objects.remove(cut, do_unlink=True)
        mat.assign(wb, wall)
        walls.append(wb)
        ring = cl.arch_ring(f"{name}_arch", 2.2 if name == "far" else 1.4, 4.2 if name == "far" else 2.6, 0.0, 0.35, -0.35, 0.35, n_arc=48)
        cl.place(ring, (0, y + (0.3 if y > 0 else -0.3), 0), 0)
        mat.assign(ring, stone)
        walls.append(ring)
    # Coffered ceiling: ribs on a grid, stepped coffers with rosettes, skylight openings.
    nx = int(round(2 * h["x"] / CELL))
    ny = int(round(L / CELL))
    sky_rows = set()
    for r0 in SKY_CELLS:
        sky_rows.update(range(r0, r0 + 4))
    x0 = -h["x"]
    y0 = h["y0"]
    slab_parts = []
    for iy in range(ny):
        for ix in range(nx):
            cxp = x0 + (ix + 0.5) * CELL
            cyp = y0 + (iy + 0.5) * CELL
            skylight = iy in sky_rows and 2 <= ix <= nx - 3
            if skylight:
                continue
            slab_parts.append(cl.box("slab", (CELL, CELL, 0.2), (cxp, cyp, h["ceil"] + 0.1)))
            inner = cl.box("coffer_step", (CELL - 0.5, CELL - 0.5, 0.08), (cxp, cyp, h["ceil"] - 0.04))
            slab_parts.append(inner)
            ros = cl.lathe("rosette", [(0.0, 0.0), (0.16, 0.0), (0.18, -0.02), (0.12, -0.05), (0.05, -0.07), (0.0, -0.08)], 16, (cxp, cyp, h["ceil"] - 0.08))
            slab_parts.append(ros)
    for ix in range(nx + 1):
        xx = x0 + ix * CELL
        slab_parts.append(cl.box("rib_x", (0.26, L, 0.42), (xx, ym, h["ceil"] - 0.21)))
    for iy in range(ny + 1):
        yy = y0 + iy * CELL
        slab_parts.append(cl.box("rib_y", (2 * h["x"], 0.26, 0.42), (0, yy, h["ceil"] - 0.21)))
    slab = geo.join(slab_parts, "ceiling_grid")
    mat.assign(slab, ceil)
    ceiling.append(slab)
    # Skylight lanterns: glazed hipped roofs with mullions above each opening.
    glass = mat.principled(f"skyglass_{variant}", base=(0.95, 0.97, 1.0), transmission=1.0, rough=0.02)
    iron = mat.principled(f"skyiron_{variant}", base=(0.05, 0.05, 0.055), metal=1.0, rough=0.4)
    for r0 in SKY_CELLS:
        ya, yb = y0 + r0 * CELL, y0 + (r0 + 4) * CELL
        xa, xb = x0 + 2 * CELL, x0 + (nx - 2) * CELL
        curb = cl.box("curb", (xb - xa + 0.3, yb - ya + 0.3, 0.9), ((xa + xb) / 2, (ya + yb) / 2, h["ceil"] + 0.45))
        hole = cl.box("curb_hole", (xb - xa, yb - ya, 2.0), ((xa + xb) / 2, (ya + yb) / 2, h["ceil"] + 0.45))
        boo = curb.modifiers.new("hole", "BOOLEAN")
        boo.operation = "DIFFERENCE"
        boo.object = hole
        geo.apply_all(curb)
        bpy.data.objects.remove(hole, do_unlink=True)
        mat.assign(curb, ceil)
        ceiling.append(curb)
        roof = geo.obj_from_mesh("skyroof", [(xa, ya, h["ceil"] + 0.9), (xb, ya, h["ceil"] + 0.9), (xb, yb, h["ceil"] + 0.9), (xa, yb, h["ceil"] + 0.9), ((xa + xb) / 2, ya + 0.8, h["ceil"] + 2.1), ((xa + xb) / 2, yb - 0.8, h["ceil"] + 2.1)], [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)])
        mat.assign(roof, glass)
        roof["glass"] = True
        ceiling.append(roof)
        for k in range(9):
            t = k / 8
            xm = xa + (xb - xa) * t
            m1 = geo.tube("mull", [(xm, ya, h["ceil"] + 0.9), ((xa + xb) / 2 + (xm - (xa + xb) / 2) * 0.0, ya + 0.8, h["ceil"] + 2.1)], radius=0.02, segments=6)
            m2 = geo.tube("mull", [(xm, yb, h["ceil"] + 0.9), ((xa + xb) / 2, yb - 0.8, h["ceil"] + 2.1)], radius=0.02, segments=6)
            for o in (m1, m2):
                mat.assign(o, iron)
                ceiling.append(o)
        for k in range(1, 7):
            yy = ya + (yb - ya) * k / 7
            for sgn in (-1, 1):
                edge = xa if sgn < 0 else xb
                m3 = geo.tube("mull", [(edge, yy, h["ceil"] + 0.9), ((xa + xb) / 2, min(max(yy, ya + 0.8), yb - 0.8), h["ceil"] + 2.1)], radius=0.02, segments=6)
                mat.assign(m3, iron)
                ceiling.append(m3)
    # Furniture that never moves: benches, plinths, side-wall colour fields.
    furn.append(gl.bench("bench_a", (2.2, 6.5, 0.0)))
    furn.append(gl.bench("bench_b", (2.2, 19.5, 0.0)))
    for name, loc, size in (("plinth_bust", (2.9, 9.75, 0.0), (0.62, 0.62, 1.2)), ("plinth_horse", (2.9, 22.75, 0.0), (0.7, 0.7, 1.05)), ("plinth_statue", (0.0, 35.2, 0.0), (1.9, 1.9, 0.9))):
        furn.append(gl.plinth(name, loc, size, stone))
    fields = [
        [lin("#ffb3cf"), lin("#ffd9a8"), lin("#fff1dd")],
        [lin("#9dbcff"), lin("#c8b6ff"), lin("#ffe0f0")],
        [lin("#ffe08f"), lin("#ff9cc2"), lin("#8fa8ff")],
    ]
    for k, y in enumerate(LEFT_BAYS):
        cf = gl.color_field(f"field{k}", 2.6, 3.4, fields[k % 3], seed=k)
        cf.data.transform(Matrix.Translation((-h["x"] + 0.03, y, 3.3)) @ Matrix.Rotation(math.radians(90), 4, "Z"))
        furn.append(cf)
        fr = gl.modern_frame(f"fieldframe{k}", 2.6, 3.4, wood="frame_oak")[0]
        for o in fr:
            o.data.transform(Matrix.Translation((-h["x"] + 0.03, y, 3.3)) @ Matrix.Rotation(math.radians(90), 4, "Z"))
            furn.append(o)
    return walls, ceiling, furn


def build_floor(variant, white=False):
    h = HALL
    if white:
        m = mat.principled(f"floor_white_{variant}", base=(0.8, 0.8, 0.8), rough=0.9)
    else:
        pal = PAL[variant]
        m = cl.floor_tiles(f"floor_{variant}", pal["stone"], lin("#3a383d") if variant == "day" else lin("#2a2830"), lin("#c9a45a"), tile=2.0, rough=0.05, vein=pal["stone_vein"])
    pieces = []
    ys = np.linspace(h["y0"], h["y1"], 5)
    for k in range(4):
        p = geo.primitive("grid", f"floor{k}", x=12, y=12, size=0.5)
        p.data.transform(Matrix.Translation((0, float(ys[k] + ys[k + 1]) / 2, 0.0)) @ Matrix.Diagonal((2 * h["x"], float(ys[k + 1] - ys[k]), 1.0, 1.0)))
        pieces.append(p)
    f = geo.join(pieces, "floor")
    mat.assign(f, m)
    return f


def build_gallery(variant=None, hang=None):
    """Live pieces: frames, picture lights, sculptures, stanchions. Returns (objects, layout)."""
    gl.materials()
    objs = []
    layout = {"art": [], "shafts": [], "spots": []}
    hang = hang if hang is not None else hangings()
    for i, hgi in enumerate(hang):
        Mw = art_matrix(hgi)
        if hgi["style"] == "gilded":
            parts, ohw, ohh = gl.gilded_frame(f"frame{i}", hgi["cw"], hgi["ch"])
        else:
            parts, ohw, ohh = gl.modern_frame(f"frame{i}", hgi["cw"], hgi["ch"], wood="frame_black" if i % 4 == 1 else "frame_oak")
        lamp = gl.picture_light(f"plight{i}", min(1.2, hgi["cw"] * 0.5))
        for o in lamp:
            o.data.transform(Matrix.Translation((0, 0, ohh + 0.18)))
        parts += lamp
        for o in parts:
            o.data.transform(Mw)
        frame = geo.join(parts, f"frame_{i}")
        objs.append(frame)
        center = Mw @ Vector((0, 0, 0))
        normal = (Mw.to_3x3() @ Vector((0, -1, 0))).normalized()
        right = (Mw.to_3x3() @ Vector((1, 0, 0))).normalized()
        placard = Mw @ Vector((ohw + 0.38, -0.005, -0.85))
        layout["art"].append({"slug": hgi["slug"], "center": to_three(center), "normal": to_three(normal), "right": to_three(right), "w": hgi["cw"], "h": hgi["ch"], "placard": to_three(placard), "style": hgi["style"]})
        # Gallery spot on the soffit of the entablature, aimed at the canvas.
        src = Vector((HALL["col_x"] * (1 if hgi["right"] else -1) * 0.93, hgi["y"] - 0.6, HALL["col_h"] - 0.05))
        layout["spots"].append({"pos": to_three(src), "target": to_three(center)})
        can = cl.cylinder(f"can{i}", 0.07, 0.22, (0, 0, 0), segments=16)
        d = (center - src).normalized()
        can.matrix_world = Matrix.Translation(src) @ d.to_track_quat("-Z", "Y").to_matrix().to_4x4()
        geo.set_origin_world(can)
        mat.assign(can, gl._m["can"])
        objs.append(can)
    # Sculptures.
    objs.append(gl.sculpture("marble_bust_01", (2.9, 9.75, 1.2), 0.82, yaw=-70))
    objs.append(gl.sculpture("horse_head", (2.9, 22.75, 1.05), 0.8, yaw=-60))
    objs.append(gl.sculpture("gothic_statue", (0.0, 35.2, 0.9), 2.3, yaw=180))
    # Stanchions + velvet ropes in front of the second and fourth artworks, and around the statue.
    posts, ropes = [], []
    for i in (1, 3):
        if i >= len(hang) or not hang[i]["right"]:
            continue
        y = hang[i]["y"]
        xs = HALL["x"] - 1.0
        a, b = (xs, y - 1.7, 0.0), (xs, y + 1.7, 0.0)
        posts += [gl.stanchion(f"post{i}a", a), gl.stanchion(f"post{i}b", b)]
        ropes.append(gl.rope(f"rope{i}", (a[0], a[1], 0.95), (b[0], b[1], 0.95)))
    ring = [(-1.6, 33.6), (1.6, 33.6), (1.6, 36.8), (-1.6, 36.8)]
    for k, (x, y) in enumerate(ring):
        posts.append(gl.stanchion(f"spost{k}", (x, y, 0.0)))
    for k in range(3):
        (xa, ya), (xb, yb) = ring[k], ring[k + 1]
        ropes.append(gl.rope(f"srope{k}", (xa, ya, 0.95), (xb, yb, 0.95)))
    objs.append(geo.join(posts, "stanchions"))
    objs.append(geo.join(ropes, "ropes"))
    # Light shafts: each skylight projected down along the sun (runtime draws these as volumes).
    for r0 in SKY_CELLS:
        ya, yb = HALL["y0"] + r0 * CELL, HALL["y0"] + (r0 + 4) * CELL
        xa, xb = -HALL["x"] + 2 * CELL, HALL["x"] - 2 * CELL
        layout["shafts"].append({"top": [to_three((xa, ya, HALL["ceil"])), to_three((xb, ya, HALL["ceil"])), to_three((xb, yb, HALL["ceil"])), to_three((xa, yb, HALL["ceil"]))]})
    layout["sun"] = {v: to_three(SUN_DIR[v]) for v in ("day", "night")}
    return objs, layout


def sky_world(variant):
    pal = PAL[variant]
    w = scene.world_color(pal["sky"], strength=pal["sky_strength"])
    return w


def lights(variant, hang):
    pal = PAL[variant]
    d = SUN_DIR[variant]
    sun = scene.sun_light("sun", strength=pal["sun_strength"], color=pal["sun"], angle_deg=1.2 if variant == "day" else 0.6)
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    for i, hgi in enumerate(hang):
        Mw = art_matrix(hgi)
        center = Mw @ Vector((0, 0, 0))
        src = Vector((HALL["col_x"] * (1 if hgi["right"] else -1) * 0.93, hgi["y"] - 0.6, HALL["col_h"] - 0.05))
        dirv = (center - src).normalized()
        sp = scene.spot_light(f"spot{i}", src, (0, 0, 0), power=pal["spot"], spot_deg=34, blend=0.55, radius=0.05, color=(1.0, 0.88, 0.72))
        sp.rotation_euler = dirv.to_track_quat("-Z", "Y").to_euler()
        # Picture light washing down the canvas.
        pl = scene.area_light(f"plight{i}", Mw @ Vector((0, -0.34, hgi["ch"] / 2 + 0.45)), size=hgi["cw"] * 0.5, size_y=0.05, power=18.0 if variant == "day" else 30.0, color=(1.0, 0.85, 0.65))
        pl.rotation_euler = ((Mw.to_3x3() @ Vector((0, 0.5, -1))).normalized()).to_track_quat("-Z", "Y").to_euler()
    # Sculpture spots.
    for loc, tgt, pw in (((0.0, 24.0, 7.1), (2.9, 22.75, 1.5), 180), ((0.0, 11.0, 7.1), (2.9, 9.75, 1.6), 180), ((0.0, 30.0, 7.1), (0.0, 35.2, 2.2), 420)):
        sp = scene.spot_light("sculpt", loc, (0, 0, 0), power=pw * (1.4 if variant == "night" else 1.0), spot_deg=22, blend=0.5, radius=0.05, color=(1.0, 0.9, 0.78))
        sp.rotation_euler = (Vector(tgt) - Vector(loc)).normalized().to_track_quat("-Z", "Y").to_euler()
    # The next gallery glows through the far arch.
    for y in (HALL["y1"] + 3.0,):
        card = geo.primitive("grid", "far_glow", x=2, y=2, size=1.0)
        card.scale = (8, 7, 1)
        card.rotation_euler = (math.pi / 2, 0, 0)
        card.location = (0, y, 4)
        geo.apply_all(card)
        geo.set_origin_world(card)
        mat.assign(card, cl.emissive_gradient(f"far_{variant}", pal["far"], strength=3.0 if variant == "day" else 1.2, axis="Z"))
        card["band"] = "back"
    if variant == "day":
        # Bright sky above the skylights.
        for r0 in SKY_CELLS:
            ya, yb = HALL["y0"] + r0 * CELL, HALL["y0"] + (r0 + 4) * CELL
            sky = geo.primitive("grid", "skycard", x=2, y=2, size=1.0)
            sky.scale = ((2 * HALL["x"] - 4 * CELL) / 2 + 1, (yb - ya) / 2 + 1, 1)
            sky.location = (0, (ya + yb) / 2, HALL["ceil"] + 6)
            sky.rotation_euler = (math.pi, 0, 0)
            geo.apply_all(sky)
            geo.set_origin_world(sky)
            mat.assign(sky, mat.emission("skycard", lin("#dfe9ff"), 2.0))
            sky["band"] = "back"
            sky.visible_shadow = False


def shafts(variant, layout):
    """Cycles volume shafts (god rays) under the skylights, for stills only."""
    d = Vector(SUN_DIR[variant])
    vm = bpy.data.materials.new(f"shaft_{variant}")
    if hasattr(vm, "use_nodes"):
        vm.use_nodes = True
    nt = vm.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.035 if variant == "day" else 0.05
    vol.inputs["Anisotropy"].default_value = 0.35
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    objs = []
    for sh in layout["shafts"]:
        top = [Vector((p[0], -p[2], p[1])) for p in sh["top"]]
        t = top[0].z / d.z
        bot = [p - d * t for p in top]
        o = geo.obj_from_mesh("shaft", top + bot, [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])
        mat.assign(o, vm)
        objs.append(o)
    return objs


def canvases(hang):
    objs = []
    for i, hgi in enumerate(hang):
        img_path = REPO / "public" / hgi["cover"].lstrip("/")
        m = mat.principled(f"canvas{i}", base=(1, 1, 1), rough=0.6)
        if img_path.exists():
            tex = mat.image_node(m, img_path, "sRGB")
            m.node_tree.links.new(tex.outputs["Color"], mat.bsdf_of(m).inputs["Base Color"])
        o = geo.primitive("grid", f"canvas{i}", x=2, y=2, size=0.5)
        o.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Diagonal((hgi["cw"], hgi["ch"], 1, 1)))
        # Grid UVs come out mirrored after the rotation; set them explicitly.
        uv = o.data.uv_layers.active or o.data.uv_layers.new()
        for poly in o.data.polygons:
            for li in poly.loop_indices:
                co = o.data.vertices[o.data.loops[li].vertex_index].co
                uv.data[li].uv = (co.x / hgi["cw"] + 0.5, co.z / hgi["ch"] + 0.5)
        o.data.transform(art_matrix(hgi))
        mat.assign(o, m)
        objs.append(o)
        sub = f"{hgi['category'].upper()}  ·  {hgi['year']}"
        pl = cl.box(f"placard{i}", (0.3, 0.012, 0.16), (0, 0, 0), bevel=0.003)
        Mw = art_matrix(hgi)
        ohw = hgi["cw"] / 2 + 0.3
        loc = Mw @ Vector((ohw + 0.38, -0.006, -0.85))
        yaw = -90 if hgi["right"] else 90
        cl.place(pl, loc, yaw)
        mat.assign(pl, gl.M("plaque", base=lin("#1c1a1e"), rough=0.35, coat=0.4))
        objs.append(pl)
        objs += gl.placard_text(f"placard{i}", hgi["title"], sub, Mw @ Vector((ohw + 0.38, -0.02, -0.85)), yaw)
    return objs


# --------------------------------------------------------------------------
def step_bake():
    size = 1024 if args.preview else args.bake_size
    spp = 64 if args.preview else (args.samples or 200)
    hang = hangings()
    for variant in args.variants:
        scene.reset()
        scene.cycles(samples=spp, bounces=5, res=(1920, 1200))
        sky_world(variant)
        lights(variant, hang)
        # Live pieces stay in the scene as occluders (frames shadow the wall, statues the floor).
        build_gallery(variant, hang)
        canvases(hang)
        walls, ceiling, furn = build_hall(variant)
        for o in ceiling:
            if o.get("glass"):
                o.visible_shadow = False
        floor = build_floor(variant)
        ceiling = [o for o in ceiling if not o.get("glass")]
        bw = bake.bake_group(walls, "walls", OUT / f"bake-{variant}", size=size, samples=spp)
        bc = bake.bake_group(ceiling, "ceiling", OUT / f"bake-{variant}", size=size, samples=spp)
        bf = bake.bake_group(furn, "furniture", OUT / f"bake-{variant}", size=size // 2, samples=spp)
        white = build_floor(variant, white=True)
        bpy.data.objects.remove(floor, do_unlink=True)
        fl = bake.bake_group([white], "floor", OUT / f"bake-{variant}", size=size, samples=spp)
        cli.log("tris", {o.name: geo.triangle_count(o) for o in (bw, bc, bf, fl)})
        export.glb(OUT / f"hall-{variant}.glb", [bw, bc, bf, fl])


def step_gallery():
    scene.reset()
    objs, layout = build_gallery()
    export.glb(OUT / "gallery.glb", objs)
    (PUB / "hi" / "layout.json").write_text(json.dumps(layout))
    cli.log("gallery", len(objs), "objects", sum(geo.triangle_count(o) for o in objs), "tris")


KEYS = [
    # s,    pos,                 look,              fov, roll
    (-0.15, (-3.2, -8.5, 4.6), (2.2, 16.0, 3.4), 46, -1.5),
    (0.00, (-3.0, -7.0, 4.0), (2.8, 14.0, 3.0), 45, -1.0),
    (0.25, (-2.4, -2.5, 2.7), (6.2, 7.0, 2.4), 42, -0.3),
    (0.50, (-2.0, 3.6, 2.0), (6.6, 13.0, 2.3), 40, 0),
    (0.75, (-1.8, 10.2, 1.9), (6.6, 19.5, 2.4), 40, 0.4),
    (1.00, (-1.6, 16.6, 1.9), (6.4, 26.0, 2.5), 40, 0.8),
    (1.15, (-1.4, 20.5, 2.3), (2.6, 36.0, 2.9), 42, 0.5),
]


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.05
    cam.data.clip_end = 400
    rails.key(cam, [{"s": s + OFFSET, "pos": p, "look": lk, "fov": f, "roll": r} for s, p, lk, f, r in KEYS])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", S_MAX)
    cli.log("rail written", S_MAX)


def stage(variant):
    scene.reset()
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 72), bounces=6, res=(1920, 1200))
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - High Contrast", exposure=0.0 if variant == "day" else 0.3)
    hang = hangings()
    sky_world(variant)
    lights(variant, hang)
    objs, layout = build_gallery(variant, hang)
    art = canvases(hang)
    walls, ceiling, furn = build_hall(variant)
    floor = build_floor(variant)
    vol = shafts(variant, layout)
    cam = build_camera()
    backs = walls + ceiling + [floor] + [o for o in bpy.context.scene.objects if o.get("band") == "back"] + vol
    fronts = objs + art + furn
    return sc, cam, {"back": backs, "mid": fronts}


def step_preview():
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        rails.set_at(args.s + OFFSET)
        sc.render.resolution_x, sc.render.resolution_y = 960, 600
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png")


TAGS = [0.0, 0.5, 1.0]


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        for s in tags:
            tag = f"{variant}-s{int(round(s * 100)):03d}"
            render.layers(cam, s + OFFSET, [("back", bands["back"]), ("mid", bands["mid"])], OUT / "layers", tag, res=LAYER_RES, samples=sc.cycles.samples)
            p = OUT / "layers" / f"{tag}.json"
            info = json.loads(p.read_text())
            info["s"] = s
            p.write_text(json.dumps(info, indent=1))


def step_pano():
    for variant in args.variants:
        sc, cam, bands = stage(variant)
        loc = Vector((-0.8, 8.0, 1.75))
        png = OUT / f"pano-{variant}.png"
        yaw = math.degrees(math.atan2(4.0, 7.8))
        render.panorama(png, loc, res=PANO_RES, samples=args.samples or 64, look_yaw_deg=yaw)
        cli.log("pano", variant, png)


def step_mini():
    """A small framed painting on a walnut easel (~1 unit tall, sits on the origin)."""
    scene.reset()
    gl.materials()
    hang = hangings()
    cover = REPO / "public" / (hang[0]["cover"].lstrip("/") if hang else "")
    walnut = mat.principled("mini_walnut", base=lin("#5a3a22"), rough=0.45, coat=0.4)
    parts = []
    # Easel: two front legs leaning back, a rear leg, a ledge and a top bar.
    lean = math.radians(12)
    tilt = math.sin(lean)
    for sx in (-1, 1):
        parts.append(geo.tube("leg", [(sx * 0.3, 0.0, 0.0), (sx * 0.1, tilt * 1.0, 1.0)], radius=0.018, segments=8))
    parts.append(geo.tube("rear", [(0, 0.55, 0.0), (0, tilt * 0.85, 0.85)], radius=0.016, segments=8))
    parts.append(geo.tube("bar", [(-0.26, tilt * 0.2 - 0.01, 0.2), (0.26, tilt * 0.2 - 0.01, 0.2)], radius=0.014, segments=8))
    parts.append(cl.box("ledge", (0.62, 0.08, 0.03), (0, tilt * 0.36 - 0.04, 0.36), bevel=0.004))
    for o in parts:
        mat.assign(o, walnut)
    # Painting leaning back on the easel.
    cw, ch = 0.56, 0.35
    fr, ohw, ohh = gl.gilded_frame("mini_frame", cw, ch)
    canvas = geo.primitive("grid", "mini_canvas", x=2, y=2, size=0.5)
    canvas.data.transform(Matrix.Rotation(math.pi / 2, 4, "X") @ Matrix.Diagonal((cw, ch, 1, 1)))
    uv = canvas.data.uv_layers.active or canvas.data.uv_layers.new()
    for poly in canvas.data.polygons:
        for li in poly.loop_indices:
            co = canvas.data.vertices[canvas.data.loops[li].vertex_index].co
            uv.data[li].uv = (co.x / cw + 0.5, co.z / ch + 0.5)
    cm = mat.principled("mini_canvas", base=(1, 1, 1), rough=0.6)
    if cover.is_file():
        tex = mat.image_node(cm, cover, "sRGB")
        cm.node_tree.links.new(tex.outputs["Color"], mat.bsdf_of(cm).inputs["Base Color"])
    mat.assign(canvas, cm)
    painting = geo.join([canvas] + fr, "mini_painting")
    painting.data.transform(Matrix.Scale(0.62 / (2 * ohw), 4))
    sc_ = 0.62 / (2 * ohw)
    painting.data.transform(Matrix.Translation((0, tilt * (0.39 + ohh * sc_) - 0.08, 0.38 + ohh * sc_ * math.cos(lean))) @ Matrix.Rotation(-lean, 4, "X"))
    o = geo.join(parts + [painting], "mini_museum")
    zmin = min(v.co.z for v in o.data.vertices)
    o.data.transform(Matrix.Translation((0, 0, -zmin)))
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 2) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "covers": step_covers,
    "bake": step_bake,
    "gallery": step_gallery,
    "rail": step_rail,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview",) or "preview" in args.steps):
        fn()
