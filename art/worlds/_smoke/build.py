"""Pipeline smoke test: exercises every ddd helper at low quality."""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "lib"))
from ddd import bake, cli, export, geo, inflate, mat, rails, render, scene  # noqa: E402

args = cli.parse()
out, pub = cli.scene_dirs("_smoke")
scene.reset()
scene.cycles(samples=16, res=(640, 400))
scene.view("AgX")
scene.world_sky(sun_elevation_deg=12, strength=0.6)
scene.sun_light("sun", rot_deg=(50, 0, 40), strength=3)

floor = geo.primitive("grid", "floor", x=4, y=4, size=6)
mat.assign(floor, mat.principled("floor", base=(0.8, 0.75, 0.7), rough=0.9))
box = geo.primitive("cube", "box", size=1.2)
box.location = (0, 0, 0.6)
mat.assign(box, mat.clay("clay", (0.9, 0.5, 0.4)))

blob = geo.primitive("cube", "blob", size=1.0)
blob.location = (2, 1, 1.2)
inflate.pillow("blob", blob, levels=3, pressure=5, frames=12)
mat.assign(blob, mat.inflatable("vinyl", (0.3, 0.5, 1.0)))

baked = bake.bake_group([floor, box], "static", out / "bake", size=256, samples=16)
export.glb(out / "smoke.glb", [baked, blob])

cam = scene.camera(lens=35)
rails.key(cam, [
    {"s": 0.0, "pos": (6, -6, 3), "look": (0, 0, 0.5), "fov": 40},
    {"s": 1.0, "pos": (-4, -7, 2), "look": (1, 0, 1), "fov": 32, "roll": 5},
])
rails.export(cam, pub / "rails.json", 1.0)
render.layers(cam, 0.5, [("back", [baked]), ("front", [blob])], out / "layers", "mid", res=(640, 400), samples=16)
cli.log("smoke ok")
