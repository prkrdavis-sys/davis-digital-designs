"""Inside the machine: a giant pinball table for the Play page.

Steps (run with --steps a,b,...):
  art      playfield + backglass artwork (shader nodes + text, ortho-rendered to textures)
  bake     per variant: Cycles GI bake of the playfield and cabinet -> playfield-<variant>.glb;
           live hardware (chrome, plastics, inserts, bumpers, flippers) -> hardware.glb
  data     pinball.json (layout, ball circuits, ramp ride) for the runtime
  rail     camera rail -> rails.json
  preview  one Cycles still at --s (half res with --preview)
  top      top-down layout check
  layers   Low Resources depth layers + posters for every tag (day/night)
  pano     360 view from the middle of the playfield
  mini     small table on legs for the homepage diorama

Layout, ball circuits and the camera math live in pinball_model.py.
"""

import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import pinball_model as pm  # noqa: E402
import shapes as sh  # noqa: E402
from ddd import bake, cli, export, geo, mat, rails, render, scene  # noqa: E402
from shader import Graph  # noqa: E402

SCENE_ID = "pinball"


def extra_args(p):
    p.add_argument("--s", type=float, default=0.0)
    p.add_argument("--tags", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)
CACHE = cli.CACHE

SUP = pathlib.Path("/System/Library/Fonts/Supplemental")
F_BLACK = SUP / "Arial Black.ttf"
F_COND = SUP / "DIN Condensed Bold.ttf"
F_ROUND = SUP / "Arial Rounded Bold.ttf"
WOOD = CACHE / "polyhaven/texture/ash_veneer/ash_veneer_diffuse_2k.png"
HDRI = CACHE / "polyhaven/hdri/studio_small_09/studio_small_09_2k.hdr"
ART = OUT / "playfield_art.png"
BACKGLASS_ART = OUT / "backglass_art.png"

C = {k: pm.lin(v) for k, v in pm.PALETTE.items()}
INK = pm.lin("#0b0418")


def reset():
    """Factory-reset the file and forget cached datablocks from the previous scene."""
    scene.reset()
    _flat_mats.clear()


def dim(c, k):
    return tuple(x * k for x in c)


# ==========================================================================
# Artwork: shader nodes + text, rendered top-down to textures.
def emit_mat(name, color, strength=1.0):
    m = bpy.data.materials.new(name)
    Graph(m).emit(color, strength)
    return m


_flat_mats = {}


def flat_mat(color):
    key = tuple(round(c, 4) for c in color)
    if key not in _flat_mats:
        _flat_mats[key] = emit_mat(f"flat_{len(_flat_mats)}", color)
    return _flat_mats[key]


def paint(o, color):
    mat.assign(o, flat_mat(color))
    return o


def playfield_art_material():
    m = bpy.data.materials.new("playfield_art")
    g = Graph(m)
    x, y = g.xy()
    # Base: deep indigo -> royal violet -> cobalt up the table.
    col = g.ramp(
        y / 12.0,
        [(0.0, pm.lin("#12072e")), (0.22, pm.lin("#2a0f66")), (0.5, pm.lin("#43179a")), (0.78, pm.lin("#2a2bbd")), (1.0, pm.lin("#12319e"))],
    )
    # Starburst around the logo: alternating pink / violet rays fading out.
    cx, cy = 0.45, 6.9
    dx, dy = x - cx, y - cy
    r = g.length(dx, dy)
    ang = g.atan2(dy, dx)
    rays = g.gt(g.sin(ang * 18.0), 0.0)
    fall = g.smooth(5.6, 1.4, r)
    col = g.mix(col, C["pink"], rays * fall * 0.62)
    col = g.mix(col, pm.lin("#7a3cff"), (1.0 - rays) * fall * 0.35)
    # Sun disk behind the logo with an ink and a yellow ring.
    disk = g.lt(r, 1.72)
    col = g.mix(col, g.ramp(r / 1.72, [(0.0, pm.lin("#ffb03d")), (0.55, pm.lin("#ff7a4a")), (1.0, pm.lin("#ff4f8f"))]), disk)
    col = g.mix(col, INK, g.inside(r, 1.72, 1.8))
    col = g.mix(col, C["yellow"], g.inside(r, 1.8, 1.86))
    # Second burst under PLAY.
    bx, by = x - 0.0, y - 2.72
    rb = g.length(bx, by)
    rays_b = g.gt(g.sin(g.atan2(by, bx) * 14.0 + 0.3), 0.0)
    fb = g.lt(rb, 1.42)
    col = g.mix(col, C["yellow"], rays_b * fb)
    col = g.mix(col, C["orange"], (1.0 - rays_b) * fb)
    col = g.mix(col, INK, g.inside(rb, 1.42, 1.5))
    col = g.mix(col, C["cyan"], g.inside(rb, 1.5, 1.55))
    # Halftone dots: big at the flippers, shrinking up the table; again at the top.
    p = 0.105
    u = (x + y) * (0.7071 / p)
    v = (x - y) * (0.7071 / p)
    fu, fv = g.fract(u) - 0.5, g.fract(v) - 0.5
    d = g.length(fu, fv)
    grow = g.smooth(4.2, 0.4, y) * 0.52 + g.smooth(9.6, 12.0, y) * 0.46
    dots = g.lt(d, grow) * (1.0 - fb) * (1.0 - disk)
    col = g.mix(col, C["cyan"], dots * 0.55)
    # Fine blueprint grid in the middle of the table.
    gx = g.abs(g.fract(x * 2.0) - 0.5)
    gy = g.abs(g.fract(y * 2.0) - 0.5)
    grid = g.max(g.gt(gx, 0.485), g.gt(gy, 0.485)) * g.smooth(2.0, 3.4, y) * g.smooth(9.4, 8.0, y) * (1.0 - disk)
    col = g.mix(col, C["cyan"], grid * 0.22)
    # Racing stripes along the left wall and the plunger lane.
    ys = g.inside(y, 1.2, 8.8)
    for x0, x1, c in ((-2.97, -2.9, "pink"), (-2.87, -2.83, "yellow"), (-2.8, -2.77, "cyan"), (2.4, 2.44, "pink"), (2.33, 2.37, "yellow"), (2.27, 2.3, "cyan")):
        col = g.mix(col, C[c], g.inside(x, x0, x1) * ys)
    # Scattered sparkle stars.
    vd, vc = g.voronoi(g.coord("Object"), 2.6)
    sparkle = g.lt(vd, 0.028) * g.gt(g.red(vc), 0.55) * (1.0 - disk)
    col = g.mix(col, (1.0, 0.97, 0.9), sparkle * 0.9)
    # Bare wood in the plunger lane.
    wood_uv = g.vec(y * 0.16, x * 0.16)
    wood = g.image(WOOD, wood_uv)
    col = g.mix(col, g.mix(wood, (0.8, 0.62, 0.42), 0.15, "MULTIPLY"), g.gt(x, 2.475))
    col = g.mix(col, INK, g.inside(x, 2.46, 2.475))
    g.emit(col)
    return m


def art_objects():
    """Painted shapes and lettering on top of the procedural base (flat emission)."""
    z = [0.001]

    def lvl():
        z[0] += 0.0005
        return z[0]

    def sticker(name, body, font, size, x, y, fill, outline=INK, shadow=None, shear=0.0, spacing=1.0, rot=0.0, ow=0.045, sw=None):
        if shadow is not None:
            paint(sh.text(name + "_sh", body, font, size, x + size * 0.07, y - size * 0.08, lvl(), rot, offset_=sw or ow, shear=shear, spacing=spacing), shadow)
        if outline is not None:
            paint(sh.text(name + "_ol", body, font, size, x, y, lvl(), rot, offset_=ow, shear=shear, spacing=spacing), outline)
        paint(sh.text(name, body, font, size, x, y, lvl(), rot, shear=shear, spacing=spacing), fill)

    def arrow_bed(x, y0, y1, w, border):
        pts = [(0, y1), (w * 0.62, y1 - w * 0.7), (w * 0.34, y1 - w * 0.7), (w * 0.34, y0), (-w * 0.34, y0), (-w * 0.34, y1 - w * 0.7), (-w * 0.62, y1 - w * 0.7)]
        pts = sh.fillet(sh.transform(pts, x=x), 0.04, 3)
        paint(sh.flat("bed_b", sh.offset(sh.ccw(pts), 0.035), lvl()), border)
        paint(sh.flat("bed", sh.ccw(pts), lvl()), dim(INK, 1.6))

    arrow_bed(-1.22, 3.95, 5.55, 0.5, C["cyan"])
    arrow_bed(-2.72, 5.1, 6.78, 0.44, C["pink"])
    arrow_bed(2.02, 5.85, 7.35, 0.4, C["yellow"])

    # Insert bezels: ink ring + a dark tint of the lamp colour (the lit lamp sits on top at runtime).
    for kind, x, y, rot, size, color, group in pm.INSERTS:
        base = sh.ccw(sh.transform(sh.insert_shape(kind, size), x, y, rot))
        paint(sh.flat("bezel", sh.offset(base, 0.03), lvl()), INK)
        paint(sh.flat("socket", base, lvl()), dim(C[color], 0.3))

    # Logo.
    sticker("davis", "DAVIS", F_BLACK, 0.95, 0.45, 7.22, C["yellow"], shadow=C["pink"], shear=0.14, ow=0.05, sw=0.08)
    sticker("digital", "DIGITAL", F_BLACK, 0.6, 0.45, 6.46, C["cyan"], shadow=pm.lin("#5b2dd6"), shear=0.14, ow=0.045, sw=0.07)
    sticker("designs", "D E S I G N S", F_COND, 0.26, 0.45, 5.98, (1.0, 0.96, 0.9), outline=INK, ow=0.03)
    sticker("play", "PLAY", F_BLACK, 0.62, 0.0, 2.74, (1.0, 0.98, 0.94), outline=C["pink"], shadow=INK, shear=0.1, ow=0.045, sw=0.1)
    # Lane labels.
    for body, x, y, size, c, rot in (
        ("RAMP", -1.22, 3.74, 0.17, C["cyan"], 0),
        ("ORBIT", -2.72, 4.9, 0.15, C["pink"], 0),
        ("SPINNER", -2.7, 7.12, 0.12, (1, 1, 1), 0),
        ("LOCK", 2.02, 5.65, 0.15, C["yellow"], 0),
        ("JACKPOT", 0.1, 3.95, 0.14, C["yellow"], 0),
        ("SHOOT AGAIN", 0.0, 1.48, 0.13, (1, 1, 1), 0),
        ("DAVIS DIGITAL DESIGNS  ·  EST. 2026", 0.0, 1.08, 0.075, dim((1, 1, 1), 0.8), 0),
        ("TARGETS", -1.72, 4.7, 0.12, C["yellow"], 90),
    ):
        sticker("lbl", body, F_COND, size, x, y, c, outline=INK, ow=0.02)
    for k, ch in enumerate("MULTIBALL"):
        x = -0.62 + k * (2.14 / 8)
        sticker("mb", ch, F_COND, 0.11, x, 5.44, (1, 1, 1), outline=INK, ow=0.015)
    for x in (-0.15, 0.55, 1.25):
        sticker("d", "D", F_BLACK, 0.2, x, 10.35, (1, 1, 1), outline=INK, ow=0.02)
    # Inlane rails painted as dashed white lines.
    for guide in pm.INLANE_GUIDES:
        for a, b in zip(guide, guide[1:]):
            n = int(math.dist(a, b) / 0.12)
            for k in range(0, n, 2):
                p0 = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
                p1 = (a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n)
                off = -0.18 if guide[0][0] < 0 else 0.18
                paint(sh.flat("dash", sh.ribbon([(p0[0] + off, p0[1]), (p1[0] + off, p1[1])], 0.03), lvl()), dim((1, 1, 1), 0.85))


def step_art():
    reset()
    sc = scene.cycles(samples=24, bounces=0, denoise=False, res=(2048, 4096))
    sc.render.filter_size = 1.2
    scene.view("Standard")
    scene.world_color((0, 0, 0), 0)
    plane = sh.flat("art", [(-3, 0), (3, 0), (3, 12), (-3, 12)], 0.0)
    mat.assign(plane, playfield_art_material())
    art_objects()
    cam = scene.camera()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 12.0
    cam.location = (0, 6, 5)
    cam.rotation_euler = (0, 0, 0)
    render.still(ART)
    cli.log("playfield art", ART)

    # Backglass: a synthwave sunset over a neon grid, with the studio name in chrome-candy letters.
    reset()
    bw, bh = pm.BACKGLASS["size"]
    res = (2048, int(round(2048 * bh / bw)))
    sc = scene.cycles(samples=24, bounces=0, denoise=False, res=res)
    sc.render.filter_size = 1.2
    scene.view("Standard")
    scene.world_color((0, 0, 0), 0)
    plane = sh.flat("bg", [(-bw / 2, -bh / 2), (bw / 2, -bh / 2), (bw / 2, bh / 2), (-bw / 2, bh / 2)], 0.0)
    mat.assign(plane, backglass_material(bw, bh))
    backglass_objects(bw, bh)
    cam = scene.camera()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = bh
    cam.location = (0, 0, 5)
    render.still(BACKGLASS_ART)
    cli.log("backglass art", BACKGLASS_ART)


HORIZON = -0.72


def backglass_material(bw, bh):
    m = bpy.data.materials.new("backglass_art")
    g = Graph(m)
    x, y = g.xy()
    sky = g.ramp((y + bh / 2) / bh, [(0.0, pm.lin("#2b0b4f")), (0.45, pm.lin("#5a1a8f")), (0.75, pm.lin("#2a1670")), (1.0, pm.lin("#0e0a3a"))])
    r = g.length(x, y - HORIZON)
    rays = g.gt(g.sin(g.atan2(y - HORIZON, x) * 22.0), 0.0) * g.gt(y, HORIZON)
    col = g.mix(sky, C["pink"], rays * g.smooth(4.2, 1.0, r) * 0.45)
    # Sun with horizontal cut bands in its lower half.
    sun = g.lt(r, 1.28) * g.gt(y, HORIZON)
    band_gap = g.lt(g.fract((y - HORIZON) * 9.0), 0.3) * g.lt(y, HORIZON + 0.6)
    sun_col = g.ramp((y - HORIZON) / 1.28, [(0.0, C["pink"]), (0.45, pm.lin("#ff7a4a")), (1.0, C["yellow"])])
    col = g.mix(col, sun_col, sun * (1.0 - band_gap))
    # Perspective grid floor below the horizon.
    depth = 1.0 / g.max(HORIZON - y, 0.02)
    gz = g.abs(g.fract(depth * 0.9) - 0.5)
    gxl = g.abs(g.fract(x * depth * 0.35) - 0.5)
    under = g.lt(y, HORIZON)
    floor = g.ramp((y + bh / 2) / (HORIZON + bh / 2), [(0.0, pm.lin("#12062a")), (1.0, pm.lin("#3a0f5e"))])
    col = g.mix(col, floor, under)
    lines = g.max(g.gt(gz, 0.5 - 0.04 * g.min(depth * 0.25, 1.0)), g.gt(gxl, 0.47)) * under
    col = g.mix(col, C["cyan"], lines * 0.9)
    col = g.mix(col, (1, 1, 1), g.inside(y, HORIZON - 0.012, HORIZON + 0.012) * 0.9)
    # Stars.
    vd, vc = g.voronoi(g.coord("Object"), 5.0)
    col = g.mix(col, (1, 0.95, 0.9), g.lt(vd, 0.03) * g.gt(g.red(vc), 0.5) * g.gt(y, HORIZON + 0.2) * (1.0 - sun))
    # Border frame.
    ex = g.max(g.abs(x) - (bw / 2 - 0.16), g.abs(y) - (bh / 2 - 0.16))
    col = g.mix(col, INK, g.gt(ex, 0.0))
    col = g.mix(col, C["pink"], g.inside(ex, -0.04, -0.015))
    col = g.mix(col, C["yellow"], g.inside(ex, 0.05, 0.07))
    g.emit(col)
    return m


def gradient_mat(name, stops, y0, y1):
    m = bpy.data.materials.new(name)
    g = Graph(m)
    _, y = g.xy()
    g.emit(g.ramp((y - y0) / (y1 - y0), stops))
    return m


def backglass_objects(bw, bh):
    z = [0.001]

    def lvl():
        z[0] += 0.0005
        return z[0]

    def logo(body, size, x, y, fill_mat, depth_col, spacing=1.0):
        # Stepped extrusion shadow, ink outline, white rim, gradient fill.
        for k in range(9, 0, -1):
            paint(sh.text("ex", body, F_BLACK, size, x + k * size * 0.009, y - k * size * 0.014, lvl(), shear=0.12, offset_=size * 0.075, spacing=spacing), dim(depth_col, 0.35 + 0.05 * (9 - k)))
        paint(sh.text("ol", body, F_BLACK, size, x, y, lvl(), shear=0.12, offset_=size * 0.075, spacing=spacing), INK)
        paint(sh.text("rim", body, F_BLACK, size, x, y, lvl(), shear=0.12, offset_=size * 0.035, spacing=spacing), (1, 0.97, 0.92))
        t = sh.text("fill", body, F_BLACK, size, x, y, lvl(), shear=0.12, spacing=spacing)
        mat.assign(t, fill_mat)

    logo("DAVIS", 1.3, 0.0, 1.0, gradient_mat("davis_fill", [(0.0, pm.lin("#ff5c9d")), (0.5, pm.lin("#ff9a3d")), (1.0, pm.lin("#fff08a"))], 0.45, 1.5), pm.lin("#b0206f"), 1.02)
    logo("DIGITAL", 0.74, 0.0, 0.0, gradient_mat("digital_fill", [(0.0, pm.lin("#2f7bff")), (0.6, pm.lin("#3edcff")), (1.0, pm.lin("#d9fbff"))], -0.3, 0.3), pm.lin("#3a1fb0"), 1.02)
    plate = sh.fillet([(-1.25, -1.72), (1.25, -1.72), (1.25, -1.32), (-1.25, -1.32)], 0.12, 4)
    paint(sh.flat("plate_b", sh.offset(sh.ccw(plate), 0.03), lvl()), C["cyan"])
    paint(sh.flat("plate", sh.ccw(plate), lvl()), INK)
    paint(sh.text("designs", "D E S I G N S", F_COND, 0.34, 0.0, -1.52, lvl()), (1, 0.97, 0.92))
    paint(sh.text("mb", "M U L T I B A L L", F_COND, 0.2, 0.0, 1.78, lvl()), C["cyan"])
    # Chrome ball illustrations.
    for bx, by, br in ((-2.05, -1.2, 0.36), (2.25, 1.35, 0.24), (-2.3, 1.55, 0.16)):
        m = bpy.data.materials.new("ball_ill")
        g = Graph(m)
        x, y = g.xy()
        rr = g.length(x - (bx - br * 0.3), y - (by + br * 0.35)) / (br * 1.3)
        g.emit(g.ramp(rr, [(0.0, (1, 1, 1)), (0.25, (0.8, 0.82, 0.9)), (0.7, (0.2, 0.18, 0.35)), (1.0, (0.55, 0.5, 0.8))]))
        paint(sh.flat("ball_ol", sh.circle(bx, by, br + 0.03, 48), lvl()), INK)
        mat.assign(sh.flat("ball", sh.circle(bx, by, br, 48), lvl()), m)
    # "PLAY!" burst badge.
    burst = sh.star(2.1, -1.3, 0.52, 0.4, points=14, rot_deg=0)
    paint(sh.flat("burst_ol", sh.offset(sh.ccw(burst), 0.035), lvl()), INK)
    paint(sh.flat("burst", burst, lvl()), C["yellow"])
    paint(sh.text("play", "PLAY!", F_BLACK, 0.26, 2.1, -1.3, lvl(), rot_deg=-12, offset_=0.0), C["pink"])


# ==========================================================================
# Table materials (Cycles). The runtime rebuilds equivalents in three.js.
class Mats:
    def __init__(self, variant):
        self.v = variant
        self.night = variant == "night"
        self.cache = {}

    def get(self, key):
        if key not in self.cache:
            self.cache[key] = self.make(key)
        return self.cache[key]

    def make(self, key):
        n = self.night
        if key == "playfield":
            m = bpy.data.materials.new("playfield")
            g = Graph(m)
            uv = g.node("ShaderNodeUVMap")
            uv.uv_map = "UVMap"
            art = g.image(ART, uv.outputs[0], extension="EXTEND")
            g.principled(base=art, rough=0.32, coat=1.0, coat_rough=0.02, specular=0.5)
            return m
        if key == "chrome":
            return mat.principled("chrome", base=(0.93, 0.93, 0.96), metal=1.0, rough=0.07)
        if key == "chrome_dark":
            return mat.principled("chrome_dark", base=(0.5, 0.5, 0.55), metal=1.0, rough=0.2)
        if key == "rubber":
            return mat.principled("rubber", base=(0.9, 0.88, 0.84), rough=0.62, sheen=0.3)
        if key == "rubber_black":
            return mat.principled("rubber_black", base=(0.02, 0.02, 0.025), rough=0.5)
        if key.startswith("rubber_"):
            return mat.principled(key, base=C[key[7:]], rough=0.45, coat=0.3)
        if key == "white_plastic":
            return mat.principled("white_plastic", base=(0.92, 0.9, 0.88), rough=0.25, coat=0.6, coat_rough=0.1)
        if key.startswith("plastic_"):
            c = C[key[8:]]
            return mat.principled(key, base=c, transmission=0.85, rough=0.08, ior=1.49, emission=c, emission_strength=0.6 if n else 0.0)
        if key.startswith("post_"):
            return mat.principled(key, base=C[key[5:]], rough=0.18, coat=1.0, coat_rough=0.05, subsurface=0.2)
        if key == "ink_white":
            return mat.principled("ink_white", base=(0.96, 0.95, 0.92), rough=0.35)
        if key.startswith("insert_"):
            c = C[key[7:]]
            return mat.principled(key, base=c, rough=0.1, coat=1.0, transmission=0.3, emission=c, emission_strength=9.0 if n else 2.2)
        if key.startswith("cap_"):
            c = C[key[4:]]
            return mat.principled(key, base=c, rough=0.15, coat=1.0, transmission=0.4, emission=c, emission_strength=7.0 if n else 1.6)
        if key == "bumper_body":
            return mat.principled("bumper_body", base=(0.95, 0.95, 0.95), transmission=0.7, rough=0.3, emission=(1.0, 0.85, 0.7), emission_strength=1.5 if n else 0.2)
        if key == "metal_dark":
            return mat.principled("metal_dark", base=(0.03, 0.028, 0.04), metal=0.7, rough=0.35)
        if key.startswith("target_"):
            return mat.principled(key, base=C[key[7:]], rough=0.2, coat=1.0, emission=C[key[7:]], emission_strength=0.8 if n else 0.0)
        if key == "bulb":
            return mat.emission("bulb", (1.0, 0.78, 0.52), 14.0 if n else 5.0)
        if key.startswith("neon_"):
            return mat.emission(key, C[key[5:]], 26.0 if n else 3.0)
        if key == "ramp_plastic":
            return mat.principled("ramp_plastic", base=pm.lin("#b8f4ff"), transmission=0.92, rough=0.05, ior=1.49, emission=C["cyan"], emission_strength=0.35 if n else 0.0)
        if key == "wall":
            m = bpy.data.materials.new("wall")
            g = Graph(m)
            _, y = g.xy()
            base = g.ramp(y / 12.0, [(0.0, pm.lin("#1b0b3a")), (1.0, pm.lin("#1c2a80"))])
            stripes = g.gt(g.fract(y * 0.8), 0.86)
            g.principled(base=g.mix(base, C["pink"], stripes * 0.7), rough=0.3, coat=0.8, coat_rough=0.05)
            return m
        if key == "apron":
            m = bpy.data.materials.new("apron")
            g = Graph(m)
            x, y = g.xy()
            base = g.ramp((x + 3) / 5.5, [(0.0, pm.lin("#ff5c9d")), (0.5, pm.lin("#9b6bff")), (1.0, pm.lin("#3edcff"))])
            stripe = g.gt(g.fract((x + y) * 1.4), 0.8)
            g.principled(base=g.mix(base, dim(INK, 1.5), stripe * 0.45), rough=0.25, coat=1.0, coat_rough=0.05, metal=0.2)
            return m
        if key == "card":
            return mat.principled("card", base=(0.95, 0.93, 0.88), rough=0.5)
        if key == "ink":
            return mat.principled("ink", base=INK, rough=0.5)
        if key == "backbox":
            return mat.principled("backbox", base=pm.lin("#160a2c"), rough=0.3, coat=0.8, coat_rough=0.08)
        if key == "backglass":
            m = bpy.data.materials.new("backglass")
            g = Graph(m)
            uv = g.node("ShaderNodeUVMap")
            uv.uv_map = "UVMap"
            img = g.image(BACKGLASS_ART, uv.outputs[0], extension="EXTEND")
            g.principled(base=(0, 0, 0), emission=img, emission_strength=2.6 if n else 1.3, rough=0.05, specular=0.5)
            return m
        if key == "dmd":
            return mat.principled("dmd", base=(0.01, 0.005, 0.0), rough=0.1, emission=pm.lin("#ff7a1a"), emission_strength=0.08)
        if key == "dmd_text":
            return mat.emission("dmd_text", pm.lin("#ff8a24"), 5.0 if n else 3.0)
        if key == "speaker":
            return mat.principled("speaker", base=(0.015, 0.012, 0.02), rough=0.7)
        if key == "ball":
            return mat.principled("ball", base=(0.95, 0.95, 0.97), metal=1.0, rough=0.03)
        if key == "print":
            return mat.principled("print", base=(0.98, 0.97, 0.94), rough=0.3)
        if key.startswith("chase_"):
            return mat.emission(key, C[key[6:]], 10.0 if n else 3.5)
        raise KeyError(key)


# ==========================================================================
# Table geometry
class Table:
    """Builds the whole machine. `baked` objects get lit by the Cycles bake,
    `live` objects keep real-time materials (roles become GLB node names)."""

    def __init__(self, variant):
        self.m = Mats(variant)
        self.variant = variant
        self.baked = []
        self.live = []  # (role, obj)
        self.balls = []

    def add(self, o, key, role=None, bakeable=False):
        mat.assign(o, self.m.get(key))
        if bakeable:
            self.baked.append(o)
        else:
            self.live.append((role or key, o))
        return o

    def build(self):
        self.playfield()
        self.cabinet()
        self.apron()
        self.guides()
        self.slings()
        self.flippers()
        self.bumpers()
        self.lanes()
        self.targets()
        self.spinner()
        self.plastics()
        self.inserts()
        self.ramp()
        self.lamps()
        self.backbox()
        return self

    # --- playfield + cabinet
    def playfield(self):
        o = sh.flat("playfield", [(-3, 0), (3, 0), (3, 12), (-3, 12)], 0.0)
        uv = o.data.uv_layers.new(name="UVMap")
        for loop in o.data.loops:
            co = o.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = ((co.x + 3) / 6, co.y / 12)
        mat.assign(o, self.m.get("playfield"))
        self.pf = o

    def cabinet(self):
        for side in (-1, 1):
            x0, x1 = (-3.24, -3.0) if side < 0 else (3.0, 3.24)
            self.add(sh.box("wall", x0, x1, -1.7, 12.3, -0.4, pm.WALL_H, bevel=0.01), "wall", bakeable=True)
            self.add(sh.box("siderail", x0 - 0.02, x1 + 0.02, -1.7, 12.3, pm.WALL_H, pm.WALL_H + 0.07, bevel=0.025), "chrome")
            self.add(sh.tube(f"neon_{side}", [(side * 2.965, y, 0.78) for y in np.linspace(0.9, 8.8, 40)], 0.022, 10), "neon_pink" if side < 0 else "neon_cyan", role="neon_pink" if side < 0 else "neon_cyan")
        self.add(sh.box("backwall", -3.24, 3.24, 12.0, 12.3, -0.4, pm.WALL_H, bevel=0.01), "wall", bakeable=True)
        self.add(sh.box("frontwall", -3.24, 3.24, -1.9, -1.7, -0.4, pm.WALL_H, bevel=0.01), "wall", bakeable=True)
        self.add(sh.box("lockdown", -3.26, 3.26, -1.95, -1.55, pm.WALL_H, pm.WALL_H + 0.1, bevel=0.04), "chrome")
        # Orbit guide band around the top, and the inner walls.
        outer = sh.arc(*pm.ORBIT_C, pm.ORBIT_R, 0, 180, 64)
        self.add(sh.prism("orbit", sh.ribbon(outer, 0.035), 0.0, 0.42, bevel=0.008), "chrome")
        inner = [(pm.LEFT_ORBIT_WALL_X, 6.35)] + sh.arc(*pm.ORBIT_C, -pm.LEFT_ORBIT_WALL_X, 180, 138, 16)
        self.add(sh.prism("orbit_in", sh.ribbon(inner, 0.035), 0.0, 0.36, bevel=0.008), "chrome")
        plunger = list(pm.PLUNGER_WALL) + sh.arc(*pm.ORBIT_C, 2.5, -14, 24, 12)
        self.add(sh.prism("plunger_wall", sh.ribbon(plunger, 0.05), 0.0, 0.38, bevel=0.01), "chrome")
        # Plunger rod + tip.
        self.add(sh.tube("plunger", [(pm.PLUNGER_X, -1.9, 0.16), (pm.PLUNGER_X, 0.24, 0.16)], 0.05, 16), "chrome")
        self.add(self._y_cyl("plunger_tip", pm.PLUNGER_X, 0.28, 0.16, 0.1, 0.08), "rubber_black", bakeable=True)
        self.add(self._y_cyl("plunger_knob", pm.PLUNGER_X, -2.15, 0.35, 0.2, 0.24), "rubber_red")

    def _y_cyl(self, name, x, y, z, r, length):
        o = geo.primitive("cylinder", name, radius=r, depth=length, segments=24)
        o.data.transform(Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        geo.smooth(o, 45)
        return o

    def apron(self):
        pts = [(-3.0, -1.7), (2.46, -1.7), (2.46, 0.92), (1.95, 0.92), (0.78, 0.46), (-0.78, 0.46), (-1.95, 0.92), (-3.0, 0.92)]
        self.add(sh.prism("apron", sh.fillet(pts, 0.1, 4), 0.0, 0.24, bevel=0.03), "apron", bakeable=True)
        for cx in (-1.85, 1.2):
            card = sh.fillet([(cx - 0.62, -1.2), (cx + 0.62, -1.2), (cx + 0.62, -0.25), (cx - 0.62, -0.25)], 0.06, 3)
            self.add(sh.prism("card", card, 0.24, 0.246), "card", bakeable=True)
        for cx, lines in ((-1.85, ["DAVIS DIGITAL DESIGNS", "3 BALLS PER PLAY", "REPLAY AT 2,500,000"]), (1.2, ["RAMP LIGHTS LOCK", "LOCK 3 FOR MULTIBALL", "SPINNER BUILDS JACKPOT"])):
            for k, line in enumerate(lines):
                self.add(sh.text("card_txt", line, F_COND, 0.13 if k == 0 else 0.1, cx, -0.45 - k * 0.24, 0.247), "ink", bakeable=True)

    # --- guides, posts, rubbers
    def post(self, x, y, color="yellow", h=0.5, rubber=True):
        self.add(sh.prism("post", sh.star(x, y, 0.07, 0.055, points=6, rot_deg=0), 0.0, h, bevel=0.008), f"post_{color}", bakeable=True)
        self.add(sh.cylinder("post_cap", x, y, h, h + 0.035, 0.05, 16, bevel=0.01), "chrome")
        if rubber:
            ring = [(x + 0.1 * math.cos(a), y + 0.1 * math.sin(a), 0.16) for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)]
            self.add(sh.tube("post_rubber", ring, 0.035, 10, closed=True), "rubber", bakeable=True)

    def guides(self):
        for guide in pm.INLANE_GUIDES:
            self.add(sh.prism("inlane", sh.ribbon(guide, 0.05), 0.0, 0.3, bevel=0.01), "chrome")
            self.post(*guide[0], color="pink")
        # Outlane walls curving down into the apron.
        for side in (-1, 1):
            if side < 0:
                line = [(-2.98, 3.2), (-2.98, 1.6), (-2.6, 1.05), (-1.98, 0.93)]
            else:
                line = [(2.44, 1.6), (2.2, 1.1), (1.96, 0.93)]
            self.add(sh.prism("outlane", sh.ribbon(line, 0.05), 0.0, 0.3, bevel=0.01), "chrome")
        self.post(pm.LEFT_ORBIT_WALL_X, 6.35, "cyan")

    def slings(self):
        for k, tri in enumerate(pm.SLINGS):
            body = sh.fillet(sh.ccw(tri), 0.08, 5)
            self.add(sh.prism("sling", body, 0.0, 0.28, bevel=0.02), "white_plastic", bakeable=True)
            self.add(sh.tube("sling_rubber", [(x, y, 0.15) for x, y in sh.offset(body, 0.05)], 0.045, 10, closed=True), "rubber", bakeable=True)
            for x, y in tri:
                self.post(x, y, "pink" if k == 0 else "cyan", rubber=False)

    def flippers(self):
        for k, f in enumerate(pm.FLIPPERS):
            px, py = f["pivot"]
            a = math.radians(f["rest"])
            tip = (px + math.cos(a) * f["length"], py + math.sin(a) * f["length"])
            outline = sh.hull2((px, py), pm.FLIPPER_R[0], tip, pm.FLIPPER_R[1])
            body = sh.prism(f"flipper_{k}", outline, 0.012, pm.FLIPPER_H, bevel=0.02)
            rub = sh.tube(f"flipper_rubber_{k}", [(x, y, 0.085) for x, y in sh.offset(outline, 0.028)], 0.046, 10, closed=True)
            cap = sh.cylinder(f"flipper_cap_{k}", px, py, pm.FLIPPER_H, pm.FLIPPER_H + 0.03, 0.06, 20, bevel=0.01)
            self.add(body, "white_plastic", role=f"flipper_{k}")
            self.add(rub, f"rubber_{f['rubber']}", role=f"flipper_rubber_{k}")
            self.add(cap, "chrome", role=f"flipper_cap_{k}")

    def bumpers(self):
        for k, b in enumerate(pm.BUMPERS):
            x, y = b["pos"]
            self.add(sh.cylinder("bumper_base", x, y, 0.0, 0.05, pm.BUMPER_R, 40, bevel=0.012), "white_plastic", bakeable=True)
            self.add(sh.cylinder(f"bumper_body_{k}", x, y, 0.05, 0.38, 0.29, 36), "bumper_body", role="bumper_body")
            skirt = sh.cylinder(f"bumper_skirt_{k}", x, y, 0.1, 0.16, 0.37, 40, r_top=0.31, bevel=0.01)
            self.add(skirt, "chrome", role=f"bumper_skirt_{k}")
            ring = [(x + 0.4 * math.cos(a), y + 0.4 * math.sin(a), 0.06) for a in np.linspace(0, 2 * math.pi, 48, endpoint=False)]
            self.add(sh.tube(f"bumper_ring_{k}", ring, 0.022, 8, closed=True), f"insert_{b['color']}", role=f"bumper_ring_{k}")
            cap = sh.cylinder(f"bumper_cap_{k}", x, y, 0.38, 0.5, 0.34, 40, bevel=0.035)
            self.add(cap, f"cap_{b['color']}", role=f"bumper_cap_{k}")
            self.add(sh.prism(f"bumper_star_{k}", sh.star(x, y, 0.2, 0.09), 0.5, 0.506), "print", role=f"bumper_star_{k}")
            for a in (30, 150, 270):
                r = math.radians(a)
                self.add(sh.tube("bumper_rod", [(x + 0.33 * math.cos(r), y + 0.33 * math.sin(r), 0.0), (x + 0.33 * math.cos(r), y + 0.33 * math.sin(r), 0.14)], 0.012, 8), "chrome")

    def lanes(self):
        for x in pm.TOP_LANE_X:
            self.add(sh.prism("lane_guide", sh.hull2((x, pm.TOP_LANE_Y[0]), 0.035, (x, pm.TOP_LANE_Y[1]), 0.035, 6), 0.0, 0.3, bevel=0.01), "chrome")
            self.post(x, pm.TOP_LANE_Y[0] - 0.02, "yellow")
        for x in (-0.15, 0.55, 1.25):
            self.add(sh.prism("rollover", sh.star(x, 10.62, 0.11, 0.05), 0.003, 0.03, bevel=0.005), "chrome")

    def targets(self):
        xs = [x for x, _ in pm.DROP_TARGETS]
        ys = [y for _, y in pm.DROP_TARGETS]
        self.add(sh.box("target_bank", min(xs) - 0.28, min(xs) - 0.06, min(ys) - 0.26, max(ys) + 0.26, 0.0, 0.16, bevel=0.02), "metal_dark", bakeable=True)
        for k, (x, y) in enumerate(pm.DROP_TARGETS):
            o = sh.prism(f"target_{k}", sh.fillet([(-0.03, -0.16), (0.03, -0.16), (0.03, 0.16), (-0.03, 0.16)], 0.012, 2), 0.0, 0.34, bevel=0.015)
            o.data.transform(Matrix.Translation((x, y, 0)))
            self.add(o, "target_yellow", role=f"target_{k}")

    def spinner(self):
        x, y = pm.SPINNER
        w = pm.SPINNER_W
        for sx in (x - w / 2 - 0.04, x + w / 2 + 0.04):
            self.add(sh.cylinder("spinner_post", sx, y, 0.0, 0.5, 0.025, 12), "chrome")
        self.add(sh.tube("spinner_wire", [(x - w / 2 - 0.05, y, 0.44), (x + w / 2 + 0.05, y, 0.44)], 0.018, 10), "chrome")
        plate = sh.box("spinner", x - w / 2, x + w / 2, y - 0.014, y + 0.014, 0.16, 0.42, bevel=0.008)
        self.add(plate, "chrome_dark", role="spinner")
        deco = sh.box("spinner_deco", x - w / 2 + 0.04, x + w / 2 - 0.04, y - 0.017, y + 0.017, 0.2, 0.38)
        self.add(deco, "target_pink", role="spinner_deco")

    def plastic(self, pts, color, z, posts=()):
        pts = sh.fillet(sh.ccw(pts), 0.09, 4)
        self.add(sh.prism("plastic", pts, z, z + 0.022, bevel=0.006), f"plastic_{color}", role=f"plastic_{color}")
        outer, inner = sh.offset(pts, -0.035), sh.offset(pts, -0.07)
        self.add(sh.band("print", outer, inner, z + 0.0235), "print", role="print")
        c = np.mean(np.array(pts), axis=0)
        self.add(sh.prism("print_star", sh.star(c[0], c[1], 0.12, 0.05), z + 0.022, z + 0.025), "print", role="print")
        for x, y in posts:
            self.post(x, y, color, h=z, rubber=False)

    def plastics(self):
        for k, tri in enumerate(pm.SLINGS):
            self.plastic(sh.offset(sh.ccw(tri), 0.14), "pink" if k == 0 else "cyan", 0.535)
        self.plastic([(-2.2, 9.1), (-0.95, 9.35), (-0.62, 10.2), (-1.3, 10.95), (-2.15, 10.5)], "violet", 0.64, posts=[(-2.0, 9.3), (-1.05, 10.45)])
        self.plastic([(1.9, 9.95), (2.4, 9.85), (2.42, 10.95), (2.0, 11.2), (1.74, 10.5)], "yellow", 0.62, posts=[(2.25, 10.1)])
        self.plastic([(-2.95, 3.35), (-2.3, 3.35), (-2.3, 3.95), (-2.95, 4.3)], "cyan", 0.5, posts=[(-2.8, 3.8)])
        self.plastic([(2.08, 3.35), (2.44, 3.35), (2.44, 4.05), (2.1, 3.85)], "pink", 0.5)

    def inserts(self):
        for i, (kind, x, y, rot, size, color, group) in enumerate(pm.INSERTS):
            o = sh.prism(f"insert_{i}", sh.transform(sh.insert_shape(kind, size), x, y, rot), 0.0005, 0.004)
            export.tag(o, color=pm.PALETTE[color], group=group, index=i)
            self.add(o, f"insert_{color}", role=f"insert_{i}")

    def lamps(self):
        for i, (x, y, z) in enumerate(pm.gi_lamps()):
            self.add(sh.sphere(f"gi_{i}", (x, y, z), 0.045, 16, 8), "bulb", role="gi")
            self.add(sh.cylinder("gi_socket", x, y, 0.0, z - 0.02, 0.035, 12), "metal_dark", bakeable=True)

    # --- ramp + corkscrew habitrail
    def ramp(self):
        path = pm.ramp_path()
        marks = pm.ramp_marks(path)
        self.ramp_path, self.ramp_marks = path, marks
        # Plastic channel up the left side.
        prof = [(-0.28, 0.26), (-0.28, 0.0), (0.28, 0.0), (0.28, 0.26)]
        us = np.arange(0.0, marks["plastic_end"] + 0.3, 0.08)
        self.add(self._sweep("ramp_plastic", path, us, prof, thickness=0.022), "ramp_plastic", role="ramp_plastic")
        for side in (-1, 1):
            edge = [path.at(u) + path.frame(u)[2] * 0.28 * side + path.frame(u)[1] * 0.26 for u in us]
            self.add(sh.tube("ramp_edge", edge, 0.016, 8), f"rubber_{'pink' if side < 0 else 'yellow'}", role="ramp_edge")
        # Four-wire wireform from the plastic's end to the inlane.
        wires = [(-0.1, 0.02), (0.1, 0.02), (-0.195, 0.2), (0.195, 0.2)]
        u0 = marks["plastic_end"] - 0.15
        us = np.arange(u0, path.length - 0.02, 0.05)
        for k, (lat, up) in enumerate(wires):
            pts = [path.at(u) + path.frame(u)[2] * lat + path.frame(u)[1] * up for u in us]
            self.add(sh.tube(f"wire_{k}", pts, 0.021, 10), "chrome")
        hoop = [tuple(q[:2]) for q in pm.catmull([(-0.195, 0.2, 0), (-0.205, 0.09, 0), (-0.15, -0.01, 0), (0.0, -0.045, 0), (0.15, -0.01, 0), (0.205, 0.09, 0), (0.195, 0.2, 0)], per_unit=120)]
        k = 0
        for u in np.arange(u0 + 0.1, path.length - 0.1, 0.42):
            t, n, r = path.frame(u)
            p = path.at(u)
            self.add(sh.tube("hoop", [p + r * a + n * b for a, b in hoop], 0.013, 8), "chrome")
            in_cork = marks["cork_start"] - 0.2 < u < marks["cork_end"] + 0.2
            near_bumper = any(math.dist(b["pos"], (p[0], p[1])) < pm.BUMPER_R + 0.2 for b in pm.BUMPERS)
            if k % 5 == 2 and p[2] > 0.3 and not in_cork and not near_bumper:
                base = Vector((p[0], p[1], 0.0))
                top = Vector(p + n * -0.045)
                self.add(sh.tube("ramp_post", [base, top], 0.028, 12), "chrome")
                self.add(sh.cylinder("ramp_foot", p[0], p[1], 0.0, 0.03, 0.07, 16, bevel=0.01), "chrome")
            k += 1
        # Plastic ramp legs.
        for u in (marks["plastic_end"] * 0.55, marks["plastic_end"] * 0.95):
            p = path.at(u)
            for side in (-1, 1):
                q = p + path.frame(u)[2] * 0.24 * side
                self.add(sh.tube("ramp_leg", [(q[0], q[1], 0.0), (q[0], q[1], q[2] - 0.02)], 0.022, 10), "chrome")
        # Corkscrew spine and spokes.
        cx, cy = pm.CORK_C
        self.add(sh.tube("cork_spine", [(cx, cy, 0.0), (cx, cy, pm.CORK_Z[0] + 0.35)], 0.05, 16), "chrome")
        self.add(sh.cylinder("cork_foot", cx, cy, 0.0, 0.04, 0.12, 20, bevel=0.01), "chrome")
        self.add(sh.sphere("cork_top", (cx, cy, pm.CORK_Z[0] + 0.36), 0.075, 20, 10), "chrome")
        for u in np.arange(marks["cork_start"], marks["cork_end"], math.pi * pm.CORK_R / 2):
            t, n, r = path.frame(u)
            p = path.at(u)
            inner = p + r * 0.2 * (1 if (Vector((cx, cy, 0)) - Vector((p[0], p[1], 0))).dot(Vector(r)) > 0 else -1) + n * 0.12
            self.add(sh.tube("spoke", [(cx, cy, inner[2]), inner], 0.014, 8), "chrome")

    def _sweep(self, name, path, us, profile, thickness=0.02):
        verts, faces = [], []
        m = len(profile)
        for i, u in enumerate(us):
            t, n, r = path.frame(u)
            p = path.at(u)
            for a, b in profile:
                verts.append(tuple(p + r * a + n * b))
            if i:
                for j in range(m - 1):
                    a0, a1 = (i - 1) * m + j, (i - 1) * m + j + 1
                    faces.append((a0, a1, a1 + m, a0 + m))
        o = geo.obj_from_mesh(name, verts, faces)
        geo.modifier(o, "SOLIDIFY", thickness=thickness, offset=0.0)
        geo.apply_all(o)
        geo.smooth(o, 50)
        return o

    # --- backbox
    def backbox(self):
        y0 = pm.BACKBOX_Y
        bw, bh = pm.BACKGLASS["size"]
        bx, by, bz = pm.BACKGLASS["center"]
        body = sh.box("backbox", -3.3, 3.3, y0, y0 + 0.8, pm.WALL_H, 7.0, bevel=0.06)
        # Only the front and sides are ever seen; drop back-facing polygons to save bake texels.
        self._drop_faces(body, lambda n: n.y > 0.7)
        self.add(body, "backbox", bakeable=True)
        self.add(sh.box("bb_trim", -3.34, 3.34, y0 - 0.05, y0 + 0.02, 7.0, 7.08, bevel=0.02), "chrome")
        # Topper sign.
        topper = sh.fillet([(-2.2, 7.1), (2.2, 7.1), (2.2, 7.95), (-2.2, 7.95)], 0.3, 6)
        tp = sh.prism("topper", topper, -0.08, 0.0, bevel=0.02)
        tp.data.transform(Matrix.Translation((0, y0 + 0.35, 0)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        self.add(tp, "backbox", bakeable=True)
        for body_, c, dx, size in (("PLAY", "neon_pink", -0.35, 0.62), ("!", "neon_yellow", 1.02, 0.62)):
            t = sh.text("topper_txt", body_, F_ROUND, size, 0, 0, 0.0, extrude=0.02)
            t.data.transform(Matrix.Translation((dx, y0 + 0.24, 7.52)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
            self.add(t, c, role=c)
        # Backglass + chase lights.
        g = sh.flat("backglass", [(-bw / 2, -bh / 2), (bw / 2, -bh / 2), (bw / 2, bh / 2), (-bw / 2, bh / 2)], 0.0)
        uv = g.data.uv_layers.new(name="UVMap")
        for loop in g.data.loops:
            co = g.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (co.x / bw + 0.5, co.y / bh + 0.5)
        g.data.transform(Matrix.Translation((bx, by - 0.02, bz)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        self.add(g, "backglass", role="backglass")
        self.add(sh.box("bg_frame_t", -bw / 2 - 0.12, bw / 2 + 0.12, y0 - 0.1, y0 + 0.02, bz + bh / 2, bz + bh / 2 + 0.12, bevel=0.02), "chrome")
        self.add(sh.box("bg_frame_b", -bw / 2 - 0.12, bw / 2 + 0.12, y0 - 0.1, y0 + 0.02, bz - bh / 2 - 0.12, bz - bh / 2, bevel=0.02), "chrome")
        per = []
        cols = ["pink", "yellow", "cyan"]
        w2, h2 = bw / 2 + 0.06, bh / 2 + 0.06
        for k in range(15):
            per.append((-w2 + 2 * w2 * k / 14, h2))
            per.append((-w2 + 2 * w2 * k / 14, -h2))
        for k in range(1, 10):
            per.append((-w2, -h2 + 2 * h2 * k / 10))
            per.append((w2, -h2 + 2 * h2 * k / 10))
        for i, (px, pz) in enumerate(per):
            o = sh.sphere(f"chase_{i}", (px, y0 - 0.13, bz + pz), 0.05, 12, 8)
            export.tag(o, index=i, color=pm.PALETTE[cols[i % 3]])
            self.add(o, f"chase_{cols[i % 3]}", role=f"chase_{i}")
        # Speaker panel with the DMD.
        dx, dy, dz = pm.DMD["center"]
        dw, dh = pm.DMD["size"]
        panel = sh.box("speaker_panel", -3.1, 3.1, y0 - 0.06, y0, pm.WALL_H + 0.1, 2.2, bevel=0.02)
        self.add(panel, "speaker", bakeable=True)
        for sx in (-2.05, 2.05):
            grille = sh.cylinder("grille", 0, 0, -0.01, 0.01, 0.42, 40)
            grille.data.transform(Matrix.Translation((sx, y0 - 0.07, dz)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
            self.add(grille, "metal_dark", bakeable=True)
            ring = [(sx + 0.45 * math.cos(a), y0 - 0.08, dz + 0.45 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 40, endpoint=False)]
            self.add(sh.tube("grille_ring", ring, 0.025, 8, closed=True), "chrome")
        d = sh.flat("dmd", [(-dw / 2, -dh / 2), (dw / 2, -dh / 2), (dw / 2, dh / 2), (-dw / 2, dh / 2)], 0.0)
        uv = d.data.uv_layers.new(name="UVMap")
        for loop in d.data.loops:
            co = d.data.vertices[loop.vertex_index].co
            uv.data[loop.index].uv = (co.x / dw + 0.5, co.y / dh + 0.5)
        d.data.transform(Matrix.Translation((dx, dy - 0.08, dz)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        self.add(d, "dmd", role="dmd")
        t = sh.text("dmd_txt", "DAVIS DIGITAL", F_COND, 0.3, 0, 0, 0.0)
        t.data.transform(Matrix.Translation((dx, dy - 0.085, dz)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
        self.add(t, "dmd_text", role="dmd_text_still")
        self.add(sh.box("dmd_bezel", -dw / 2 - 0.08, dw / 2 + 0.08, y0 - 0.075, y0 - 0.06, dz - dh / 2 - 0.08, dz + dh / 2 + 0.08), "chrome")

    def _drop_faces(self, o, pred):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(f.normal)], context="FACES")
        bm.to_mesh(o.data)
        bm.free()

    # --- balls
    def add_balls(self, positions):
        for i, p in enumerate(positions):
            self.balls.append(self.add(sh.sphere(f"ball_{i}", tuple(p), pm.BALL_R, 48, 24), "ball", role="ball"))


# ==========================================================================
# Lighting
def lights(variant, table=None):
    if variant == "day":
        scene.world_hdri(HDRI, strength=0.35, rotation_deg=40, blur_background=pm.lin("#f6eef6"))
        scene.area_light("softbox", (0.0, 5.5, 9.0), size=7.0, size_y=11.0, power=1600, color=(1.0, 0.97, 0.94))
        for sx in (-2.4, 2.4):
            scene.area_light(f"tube_{sx}", (sx, 5.5, 4.4), size=0.25, size_y=13.0, power=260, color=(0.9, 0.95, 1.0))
        scene.area_light("front_fill", (0.0, -5.0, 3.0), rot_deg=(65, 0, 0), size=6.0, size_y=2.0, power=160, color=(1.0, 0.9, 0.95))
    else:
        scene.world_color(pm.lin("#07040f"), 1.0)
        for i, (x, y, z) in enumerate(pm.gi_lamps()):
            scene.point_light(f"gi_{i}", (x, y, z + 0.05), power=9.0, radius=0.05, color=(1.0, 0.72, 0.45))
        for b in pm.BUMPERS:
            scene.point_light("bumper", (b["pos"][0], b["pos"][1], 0.3), power=18.0, radius=0.2, color=C[b["color"]])
        scene.area_light("fill", (0.0, 5.5, 7.0), size=6.0, size_y=10.0, power=220, color=(0.55, 0.5, 1.0))
        scene.area_light("backglass_spill", (0.0, 11.9, 4.3), rot_deg=(90, 0, 0), size=5.6, size_y=4.0, power=500, color=(1.0, 0.55, 0.8))
        for side, c in ((-1, "pink"), (1, "cyan")):
            scene.area_light(f"neon_{side}", (side * 2.9, 4.8, 0.78), rot_deg=(0, -90 * side, 0), size=0.06, size_y=8.0, power=160, color=C[c])


# ==========================================================================
# Bake + export
def bake_lightmap(table, variant, samples):
    """Diffuse irradiance on the playfield (no albedo): the runtime multiplies it
    with the full-resolution artwork, so one art texture serves day and night."""
    o = table.pf
    img = bpy.data.images.new(f"pf_{variant}", 1024, 2048, alpha=False, float_buffer=True)
    nt = o.data.materials[0].node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    for nd in nt.nodes:
        nd.select = False
    tex.select = True
    nt.nodes.active = tex
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.margin = 8
    for ob in sc.objects:
        ob.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    cli.log("baking playfield lightmap", variant, samples)
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=8, use_clear=True)
    path = OUT / variant / "lightmap.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    bake.save_srgb(img, path, exposure=-1.0)
    return path


def strip_hidden(objs):
    """Drop faces nobody sees (undersides, outer cabinet skins) so the bake atlas spends texels on visible ones."""
    for o in objs:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        mw = o.matrix_world
        dead = []
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            n = (mw.to_3x3() @ f.normal).normalized()
            if n.z < -0.7 or c.z < -0.05 or (abs(c.x) > 3.1 and n.x * c.x > 0.7) or (c.y < -1.75 and n.y < -0.7):
                dead.append(f)
        if len(dead) < len(bm.faces):
            bmesh.ops.delete(bm, geom=dead, context="FACES")
        bm.to_mesh(o.data)
        bm.free()


def join_roles(live):
    """Merge static live parts that share a role; animated parts keep their own node."""
    solo = ("flipper", "bumper_skirt", "bumper_cap", "bumper_star", "bumper_ring", "target_", "spinner", "insert_", "chase_", "backglass", "dmd")
    groups = {}
    for role, o in live:
        groups.setdefault(role, []).append(o)
    out = []
    for role, objs in groups.items():
        if role.startswith(solo) or len(objs) == 1:
            for o in objs:
                o.name = role if len(objs) == 1 else o.name
                out.append(o)
        else:
            out.append(geo.join(objs, role))
    return out


def step_bake():
    first = True
    for variant in args.variants:
        reset()
        sc = scene.cycles(samples=32, bounces=6, res=(1920, 1200))
        # Other worlds share the GPU; big bakes are reliable on the CPU.
        sc.cycles.device = "CPU"
        table = Table(variant).build()
        lights(variant, table)
        samples = args.samples or (48 if args.preview else 320)
        bake_lightmap(table, variant, samples)
        strip_hidden(table.baked)
        cab = bake.bake_group(table.baked, "cabinet", OUT / variant, size=2048, samples=max(32, samples // 2), exposure=-1.0)
        export.glb(OUT / f"cabinet-{variant}.glb", [cab])
        if first:
            nodes = [o for o in join_roles(table.live) if not o.name.startswith(("ball", "dmd_text_still"))]
            export.glb(OUT / "hardware.glb", nodes)
            first = False


def step_data():
    meta = pm.export_runtime(PUB / "hi" / "pinball.json")
    cli.log("pinball.json", len(meta["ramp"]["points"]) // 3, "ramp samples")


# ==========================================================================
# Camera + stills
def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.02
    cam.data.clip_end = 400
    rails.key(cam, pm.camera_keys(), interpolation="LINEAR")
    return cam


def step_rail():
    reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", pm.S_MAX)
    cli.log("rail written")


def stage(s, variant):
    reset()
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 72), bounces=6, res=(1920, 1200))
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - Punchy")
    table = Table(variant).build()
    table.add_balls(pm.still_balls(s))
    lights(variant, table)
    cam = build_camera()
    rails.set_at(s)
    back = [table.pf] + table.baked
    mid = [o for _, o in table.live]
    return sc, cam, {"back": back, "mid": mid}


TAGS = [0.0, 0.55, 1.25, 1.6, 2.2, 2.6, 3.4, 3.9]


def step_preview():
    for variant in args.variants:
        sc, cam, bands = stage(args.s, variant)
        if args.preview:
            sc.render.resolution_x, sc.render.resolution_y = 960, 600
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png")


def step_top():
    for variant in args.variants:
        reset()
        scene.cycles(samples=args.samples or 24, bounces=4, res=(1000, 2200))
        scene.view("AgX", look="AgX - Medium High Contrast")
        table = Table(variant).build()
        table.add_balls(pm.still_balls(3.9))
        lights(variant, table)
        cam = scene.camera()
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 15.0
        cam.location = (0, 5.8, 20)
        render.still(OUT / f"top-{variant}.png")


def step_layers():
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        for s in tags:
            sc, cam, bands = stage(s, variant)
            render.layers(cam, s, [("back", bands["back"]), ("mid", bands["mid"])], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples)


def step_pano():
    for variant in args.variants:
        sc, cam, bands = stage(2.2, variant)
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, (0.3, 6.2, 0.9), res=(4096, 2048), samples=args.samples or 64, look_yaw_deg=90)
        cli.log("pano", variant, png)


# ==========================================================================
def step_mini():
    """A toy pinball table on chrome legs, about one unit tall, standing at the origin."""
    reset()
    parts = []
    s = 0.075  # table units -> mini units
    tilt = math.radians(6.5)
    top_z = 0.62

    def place(o, z_lift=0.0):
        o.data.transform(Matrix.Translation((0, 0, top_z + z_lift)) @ Matrix.Rotation(tilt, 4, "X") @ Matrix.Scale(s, 4) @ Matrix.Translation((0, -6.0, 0)))
        return o

    # Cabinet body.
    body = sh.box("cab", -3.3, 3.3, -2.0, 12.4, -3.2, 0.95, bevel=0.15)
    mat.assign(body, mat.principled("cab", base=pm.lin("#1a0b36"), rough=0.3, coat=1.0, coat_rough=0.05))
    parts.append(place(body))
    pf = sh.flat("pf", [(-3, 0), (3, 0), (3, 12), (-3, 12)], 0.955)
    uv = pf.data.uv_layers.new(name="UVMap")
    for loop in pf.data.loops:
        co = pf.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x + 3) / 6, co.y / 12)
    m = mat.principled("mini_pf", rough=0.15, coat=1.0)
    t = mat.image_node(m, ART, "sRGB", uv_map="UVMap")
    m.node_tree.links.new(t.outputs["Color"], mat.bsdf_of(m).inputs["Base Color"])
    mat.assign(pf, m)
    parts.append(place(pf))
    # Stripe decal around the cabinet.
    for side in (-1, 1):
        st = sh.box("stripe", side * 3.31 - 0.01, side * 3.31 + 0.01, -1.9, 12.3, -1.6, -1.1)
        mat.assign(st, mat.principled("stripe", base=C["pink"], rough=0.3, coat=1.0))
        parts.append(place(st))
    # Bumpers, flippers, a ball.
    for b in pm.BUMPERS:
        cap = sh.cylinder("cap", b["pos"][0], b["pos"][1], 0.95, 1.6, pm.BUMPER_R, 20, bevel=0.08)
        mat.assign(cap, mat.principled("cap", base=C[b["color"]], rough=0.2, coat=1.0, emission=C[b["color"]], emission_strength=0.6))
        parts.append(place(cap))
    for f in pm.FLIPPERS:
        px, py = f["pivot"]
        a = math.radians(f["rest"])
        tip = (px + math.cos(a) * f["length"], py + math.sin(a) * f["length"])
        fl = sh.prism("fl", sh.hull2((px, py), 0.2, tip, 0.1, 6), 0.95, 1.25)
        mat.assign(fl, mat.principled("fl", base=(0.95, 0.93, 0.9), rough=0.3))
        parts.append(place(fl))
    ball = sh.sphere("ball", (0.8, 4.0, 1.25), 0.3, 20, 10)
    mat.assign(ball, mat.chrome("ball_m", rough=0.05))
    parts.append(place(ball))
    # Backbox with the backglass art.
    bb = sh.box("bb", -3.3, 3.3, 12.0, 12.9, 0.95, 8.4, bevel=0.15)
    mat.assign(bb, mat.principled("bb", base=pm.lin("#1a0b36"), rough=0.3, coat=1.0))
    parts.append(place(bb))
    bw, bh = pm.BACKGLASS["size"]
    g = sh.flat("bg", [(-bw / 2, -bh / 2), (bw / 2, -bh / 2), (bw / 2, bh / 2), (-bw / 2, bh / 2)], 0.0)
    uv = g.data.uv_layers.new(name="UVMap")
    for loop in g.data.loops:
        co = g.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x / bw + 0.5, co.y / bh + 0.5)
    g.data.transform(Matrix.Translation((0, 11.98, 5.2)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    m = mat.principled("mini_bg", base=(0, 0, 0), rough=0.1, emission_strength=1.2)
    t = mat.image_node(m, BACKGLASS_ART, "sRGB", uv_map="UVMap")
    m.node_tree.links.new(t.outputs["Color"], mat.bsdf_of(m).inputs["Emission Color"])
    mat.assign(g, m)
    parts.append(place(g))
    # Legs (not tilted), from the floor to under the cabinet.
    chrome = mat.chrome("legs", rough=0.12)
    for lx in (-0.22, 0.22):
        for ly, top in ((-0.42, 0.34), (0.45, 0.43)):
            leg = sh.cylinder("leg", lx, ly, 0.0, top, 0.018, 12, r_top=0.024)
            mat.assign(leg, chrome)
            parts.append(leg)
            foot = sh.cylinder("foot", lx, ly, 0.0, 0.02, 0.035, 12)
            mat.assign(foot, chrome)
            parts.append(foot)
    o = geo.join(parts, "mini_pinball")
    zmin = min((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    o.data.transform(Matrix.Translation((0, 0, -zmin)))
    cli.log("mini tris", geo.triangle_count(o), "dims", [round(x, 3) for x in o.dimensions])
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "art": step_art,
    "bake": step_bake,
    "data": step_data,
    "rail": step_rail,
    "preview": step_preview,
    "top": step_top,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview", "top") or name in args.steps):
        fn()
