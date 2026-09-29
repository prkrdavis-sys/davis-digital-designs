"""Shared helpers for headless Blender world builds.

Every art/worlds/<scene>/build.py starts with:

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "lib"))
    from ddd import cli, scene, mat, geo, bake, export, rails, render

Coordinates: author in Blender (Z up, meters). The glTF exporter and the
rail/layer exporters convert to three.js (Y up) so everything lines up.
"""
