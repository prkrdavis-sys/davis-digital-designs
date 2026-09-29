import pathlib

import bpy

from .cli import log

DEFAULTS = dict(
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_cameras=False,
    export_lights=False,
    export_extras=True,
    export_animations=False,
    export_vertex_color="ACTIVE",
    export_attributes=True,
    export_draco_mesh_compression_enable=False,
)


def glb(path, objects, **overrides):
    """Export exactly `objects` to a GLB. Compression happens later in art/optimize.mjs."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.view_layer.update()
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
    valid = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {k: v for k, v in {**DEFAULTS, **overrides}.items() if k in valid}
    bpy.ops.export_scene.gltf(filepath=str(path), **kwargs)
    log("exported", path.name, f"{path.stat().st_size / 1e6:.2f} MB", f"{len(objects)} objects")
    return path


def tag(obj, **extras):
    """Custom properties become glTF `extras`, readable at runtime as object.userData."""
    for k, v in extras.items():
        obj[k] = v
    return obj
