"""Cycles stills for the Low Resources mode, posters, and door panoramas.

layers(): renders one RGBA image per depth band from a rail position. Each
band is rendered with every other object invisible to camera rays only, so
shadows, reflections and bounce light stay consistent across layers. At
runtime the layers are stacked on planes at their depths and parallax with
scroll and cursor (the 2.5D diorama). posters are composited from layers.
"""

import json
import math
import pathlib

import bpy
from mathutils import Vector

from . import rails
from .cli import log


def _mesh_like(o):
    return o.type in {"MESH", "CURVE", "SURFACE", "META", "FONT", "VOLUME", "POINTCLOUD", "CURVES"}


def still(path, samples=None):
    sc = bpy.context.scene
    if samples:
        sc.cycles.samples = samples
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if sc.render.film_transparent else "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path


def _band_depth(cam, objs):
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    ds = []
    for o in objs:
        if not _mesh_like(o):
            continue
        corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        center = sum(corners, Vector()) / 8
        d = (center - cpos).dot(fwd)
        if d > 0.01:
            ds.append(d)
    if not ds:
        return None
    ds.sort()
    return ds[len(ds) // 2]


def layers(cam, s, bands, out_dir, tag, res=(1920, 1200), samples=96, overscan=1.08, depths=None):
    """bands: list of (band_name, [objects]) ordered back -> front.

    The back band also renders the world background. `depths` optionally
    overrides the plane distance for each band (meters from camera).
    """
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    rails.set_at(s)
    base_lens = cam.data.lens
    # Render slightly wider than the runtime camera so parallax never reveals an edge.
    fov = cam.data.angle_y
    cam.data.lens = (cam.data.sensor_height / 2) / math.tan(math.atan(math.tan(fov / 2) * overscan))
    sc.render.resolution_x, sc.render.resolution_y = res
    everything = [o for o in sc.objects if _mesh_like(o)]
    prev_vis = {o.name: o.visible_camera for o in everything}
    manifest_layers = []
    for i, (band, objs) in enumerate(bands):
        names = {o.name for o in objs}
        for o in everything:
            o.visible_camera = o.name in names
        sc.render.film_transparent = i > 0
        file = out_dir / f"{tag}-{band}.png"
        log("layer", tag, band, f"{len(objs)} objs")
        still(file, samples)
        d = (depths or {}).get(band) or _band_depth(cam, objs) or 50.0 * (len(bands) - i)
        manifest_layers.append({"band": band, "file": file.name, "depth": round(d, 3)})
    for o in everything:
        o.visible_camera = prev_vis[o.name]
    sc.render.film_transparent = False
    rails.set_at(s)
    loc, rot, _ = (rails._Z2Y @ cam.matrix_world).decompose()
    info = {
        "tag": tag,
        "s": s,
        "fov": math.degrees(2 * math.atan(math.tan(fov / 2) * overscan)),
        "aspect": res[0] / res[1],
        "p": [round(loc.x, 4), round(loc.y, 4), round(loc.z, 4)],
        "q": [round(rot.x, 5), round(rot.y, 5), round(rot.z, 5), round(rot.w, 5)],
        "layers": manifest_layers,
    }
    cam.data.lens = base_lens
    (out_dir / f"{tag}.json").write_text(json.dumps(info, indent=1))
    return info


def panorama(path, location, res=(4096, 2048), samples=128, look_yaw_deg=0.0):
    """Equirectangular 360 render from a point (for door portals)."""
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("pano")
    cd.type = "PANO"
    if hasattr(cd, "panorama_type"):
        cd.panorama_type = "EQUIRECTANGULAR"
    else:
        cd.cycles.panorama_type = "EQUIRECTANGULAR"
    co = bpy.data.objects.new("pano", cd)
    sc.collection.objects.link(co)
    co.location = location
    co.rotation_euler = (math.radians(90), 0, math.radians(look_yaw_deg - 90))
    prev_cam = sc.camera
    sc.camera = co
    prev_res = (sc.render.resolution_x, sc.render.resolution_y)
    sc.render.resolution_x, sc.render.resolution_y = res
    still(path, samples)
    sc.camera = prev_cam
    sc.render.resolution_x, sc.render.resolution_y = prev_res
    bpy.data.objects.remove(co, do_unlink=True)
    return path
