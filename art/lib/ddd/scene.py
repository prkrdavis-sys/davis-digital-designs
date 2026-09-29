import math
import os

import bpy


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.render.fps = 100
    sc.frame_start = 0
    sc.frame_end = 1000
    return sc


def use_gpu():
    """Metal on macOS, OptiX/CUDA/HIP/oneAPI elsewhere, else CPU.
    DDD_DEVICE=CPU forces the CPU."""
    sc = bpy.context.scene
    forced = os.environ.get("DDD_DEVICE", "").upper()
    if forced == "CPU":
        sc.cycles.device = "CPU"
        return "CPU"
    cp = bpy.context.preferences.addons["cycles"].preferences
    kinds = [forced] if forced else ["METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"]
    for kind in kinds:
        try:
            cp.compute_device_type = kind
        except TypeError:
            continue
        cp.get_devices()
        gpus = [d for d in cp.devices if d.type != "CPU"]
        if gpus:
            for d in cp.devices:
                d.use = True
            sc.cycles.device = "GPU"
            return kind
    cp.compute_device_type = "NONE"
    sc.cycles.device = "CPU"
    return "CPU"


def cycles(samples=128, bounces=6, denoise=True, transparent=False, res=(1920, 1080)):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    use_gpu()
    c = sc.cycles
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.max_bounces = bounces
    c.diffuse_bounces = min(bounces, 4)
    c.glossy_bounces = bounces
    c.transmission_bounces = bounces + 4
    c.transparent_max_bounces = 16
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.use_denoising = denoise
    try:
        c.denoiser = "OPENIMAGEDENOISE"
    except TypeError:
        pass
    sc.render.film_transparent = transparent
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return sc


def view(transform="AgX", look="None", exposure=0.0, gamma=1.0):
    vs = bpy.context.scene.view_settings
    vs.view_transform = transform
    try:
        vs.look = look
    except TypeError:
        vs.look = "None"
    vs.exposure = exposure
    vs.gamma = gamma


def world_color(color=(0.05, 0.05, 0.06), strength=1.0):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background") or nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*color, 1.0)
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.get("World Output") or nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def world_hdri(path, strength=1.0, rotation_deg=0.0, blur_background=None):
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value[2] = math.radians(rotation_deg)
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(str(path))
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    if blur_background is None:
        nt.links.new(bg.outputs[0], out.inputs[0])
    else:
        # Lighting from the HDRI, camera sees a flat or blurred color instead.
        light_path = nt.nodes.new("ShaderNodeLightPath")
        cam_bg = nt.nodes.new("ShaderNodeBackground")
        cam_bg.inputs["Color"].default_value = (*blur_background, 1.0)
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(light_path.outputs["Is Camera Ray"], mix.inputs[0])
        nt.links.new(bg.outputs[0], mix.inputs[1])
        nt.links.new(cam_bg.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs[0])
    return w


def world_sky(sun_elevation_deg=8.0, sun_rotation_deg=0.0, strength=1.0, altitude=0.0, air=1.0, dust=1.0, ozone=1.0):
    """Physical Nishita-style sky (Blender's Sky Texture)."""
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    if hasattr(w, "use_nodes"):
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    for t in ("MULTIPLE_SCATTERING", "NISHITA", "SINGLE_SCATTERING"):
        try:
            sky.sky_type = t
            break
        except TypeError:
            continue
    sky.sun_elevation = math.radians(sun_elevation_deg)
    sky.sun_rotation = math.radians(sun_rotation_deg)
    for attr, val in (("altitude", altitude), ("air_density", air), ("dust_density", dust), ("aerosol_density", dust), ("ozone_density", ozone)):
        if hasattr(sky, attr):
            setattr(sky, attr, val)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0])
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def collection(name, parent=None):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in (parent or bpy.context.scene.collection).children:
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def link(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def area_light(name, loc, rot_deg=(0, 0, 0), size=2.0, power=500, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.color = color
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    bpy.context.scene.collection.objects.link(o)
    return o


def sun_light(name, rot_deg=(40, 0, 30), strength=3.0, color=(1, 0.95, 0.9), angle_deg=1.0):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    o = bpy.data.objects.new(name, ld)
    o.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    bpy.context.scene.collection.objects.link(o)
    return o


def point_light(name, loc, power=100, radius=0.1, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "POINT")
    ld.energy = power
    ld.shadow_soft_size = radius
    ld.color = color
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    bpy.context.scene.collection.objects.link(o)
    return o


def spot_light(name, loc, rot_deg, power=500, spot_deg=45, blend=0.3, radius=0.1, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "SPOT")
    ld.energy = power
    ld.spot_size = math.radians(spot_deg)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = color
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = tuple(math.radians(a) for a in rot_deg)
    bpy.context.scene.collection.objects.link(o)
    return o


def camera(name="Camera", lens=35.0):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = "VERTICAL"
    cd.sensor_height = 24.0
    cd.lens = lens
    cd.clip_start = 0.05
    cd.clip_end = 5000
    o = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    return o


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)
