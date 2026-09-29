"""Figma-ad style inflatables: run a cloth sim with internal pressure on a
closed, subdivided mesh so it puffs up with soft, slightly droopy seams."""

import bpy

from . import geo


def inflate(obj, pressure=6.0, frames=24, shrink=0.0, quality=6, stiffness=8.0, seam_crease=True):
    """Inflate `obj` in place and apply the result.

    Works best on a quad mesh with even edge lengths (remesh or subdivide first).
    Pressure pushes the surface out between the stiffer seam edges, which gives
    the pillowy look of vinyl inflatables.
    """
    sc = bpy.context.scene
    sc.frame_set(0)
    cloth = obj.modifiers.new("inflate", "CLOTH")
    s = cloth.settings
    s.quality = quality
    s.mass = 0.3
    s.tension_stiffness = stiffness
    s.compression_stiffness = stiffness
    s.shear_stiffness = stiffness * 0.5
    s.bending_stiffness = 0.05
    s.use_pressure = True
    s.uniform_pressure_force = pressure
    s.shrink_min = shrink
    s.effector_weights.gravity = 0.0
    s.air_damping = 3.0
    cloth.collision_settings.use_collision = False
    cloth.collision_settings.use_self_collision = False
    cloth.point_cache.frame_start = 0
    cloth.point_cache.frame_end = frames + 1
    for f in range(0, frames + 1):
        sc.frame_set(f)
    geo.apply_all(obj)
    sc.frame_set(0)
    return obj


def pillow(name, base_obj, levels=3, pressure=6.0, frames=24):
    """Subdivide a blocky base shape into an even quad mesh, then inflate it."""
    geo.modifier(base_obj, "SUBSURF", levels=levels, render_levels=levels, subdivision_type="SIMPLE")
    geo.apply_all(base_obj)
    base_obj.name = name
    inflate(base_obj, pressure=pressure, frames=frames)
    geo.smooth(base_obj, 180)
    return base_obj
