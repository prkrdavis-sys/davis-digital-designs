"""OpenImageDenoise for baked lightmaps, through Blender's compositor.

    blender -b --factory-startup --python denoise.py -- in.exr out.png [exposure]

Reads a linear float bake, denoises it, and writes 8-bit sRGB (Standard view
transform) at the given exposure. Runs in its own Blender process so the
calling build scene is never re-rendered.
"""

import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]
src, dst = args[0], args[1]
exposure = float(args[2]) if len(args) > 2 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
img = bpy.data.images.load(src)
w, h = img.size
sc.render.engine = "CYCLES"
sc.cycles.samples = 1
sc.cycles.device = "CPU"
sc.render.resolution_x, sc.render.resolution_y = w, h
sc.render.resolution_percentage = 100
sc.render.use_compositing = True
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam

tree = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
sc.compositing_node_group = tree
n_img = tree.nodes.new("CompositorNodeImage")
n_img.image = img
dn = tree.nodes.new("CompositorNodeDenoise")
out = tree.nodes.new("NodeGroupOutput")
tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
tree.links.new(n_img.outputs["Image"], dn.inputs["Image"])
tree.links.new(dn.outputs["Image"], out.inputs[0])

vs = sc.view_settings
vs.view_transform = "Standard"
vs.look = "None"
vs.exposure = exposure
vs.gamma = 1.0
fs = sc.render.image_settings
fs.file_format = "PNG"
fs.color_mode = "RGB"
fs.color_depth = "8"
sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
print("[ddd] denoised", dst)
