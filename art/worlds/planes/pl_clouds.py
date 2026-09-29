"""Volumetric cumulus for Cycles.

A cloud is a union of spheres (cauliflower cumulus really are) turned into a
density grid by geometry nodes (Points to Volume -> dilate -> box blur). The
material erodes the soft grid with fBm + billowy Voronoi noise at render time,
so the fine detail is independent of the voxel size.
"""

import math
import random

import bpy
import numpy as np

from pl_common import lin


def _gn_tree(name, voxel, blur_width, blur_iters, dilate):
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi = N.new("NodeGroupInput")
    go = N.new("NodeGroupOutput")
    rad = N.new("GeometryNodeInputNamedAttribute")
    rad.data_type = "FLOAT"
    rad.inputs["Name"].default_value = "radius"
    m2p = N.new("GeometryNodeMeshToPoints")
    L.new(gi.outputs[0], m2p.inputs["Mesh"])
    L.new(rad.outputs["Attribute"], m2p.inputs["Radius"])
    p2v = N.new("GeometryNodePointsToVolume")
    p2v.inputs["Density"].default_value = 1.0
    p2v.inputs["Resolution Mode"].default_value = "Size"
    p2v.inputs["Voxel Size"].default_value = voxel
    rin = N.new("GeometryNodeInputRadius")
    L.new(m2p.outputs[0], p2v.inputs["Points"])
    L.new(rin.outputs[0], p2v.inputs["Radius"])
    get = N.new("GeometryNodeGetNamedGrid")
    get.data_type = "FLOAT"
    get.inputs["Name"].default_value = "density"
    get.inputs["Remove"].default_value = True
    L.new(p2v.outputs[0], get.inputs["Volume"])
    grid = get.outputs["Grid"]
    if dilate:
        dl = N.new("GeometryNodeGridDilateAndErode")
        dl.data_type = "FLOAT"
        dl.inputs["Steps"].default_value = dilate
        L.new(grid, dl.inputs["Grid"])
        grid = dl.outputs[0]
    if blur_iters:
        mean = N.new("GeometryNodeGridMean")
        mean.data_type = "FLOAT"
        mean.inputs["Width"].default_value = blur_width
        mean.inputs["Iterations"].default_value = blur_iters
        L.new(grid, mean.inputs["Grid"])
        grid = mean.outputs[0]
    store = N.new("GeometryNodeStoreNamedGrid")
    store.data_type = "FLOAT"
    store.inputs["Name"].default_value = "density"
    L.new(get.outputs["Volume"], store.inputs["Volume"])
    L.new(grid, store.inputs["Grid"])
    setm = N.new("GeometryNodeSetMaterial")
    L.new(store.outputs[0], setm.inputs["Geometry"])
    L.new(setm.outputs[0], go.inputs[0])
    return ng, setm


def sphere_cloud(name, spheres, material, voxel=1.0, blur_width=1, blur_iters=2, dilate=2, coll=None):
    """spheres: (N, 4) array of Blender-space x, y, z, radius."""
    sp = np.asarray(spheres, dtype=np.float32)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in sp[:, :3]], [], [])
    me.update()
    a = me.attributes.new("radius", "FLOAT", "POINT")
    a.data.foreach_set("value", sp[:, 3])
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    ng, setm = _gn_tree(f"{name}_gn", voxel, blur_width, blur_iters, dilate)
    setm.inputs["Material"].default_value = material
    o.data.materials.append(material)
    mod = o.modifiers.new("cloud", "NODES")
    mod.node_group = ng
    return o


def cloud_material(name, density=1.2, erosion=0.75, gain=1.7, scale=0.08, billow=0.35, anisotropy=0.45, color=(1, 1, 1), coord="Object"):
    """Principled Volume whose density is the grid eroded by noise (world-size `scale`)."""
    m = bpy.data.materials.new(name)
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputMaterial")
    vol = N.new("ShaderNodeVolumePrincipled")
    if "Density Attribute" in vol.inputs:
        vol.inputs["Density Attribute"].default_value = ""
    vol.inputs["Color"].default_value = (*color, 1)
    vol.inputs["Anisotropy"].default_value = anisotropy
    L.new(vol.outputs[0], out.inputs["Volume"])

    attr = N.new("ShaderNodeAttribute")
    attr.attribute_name = "density"
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 7.0
    noise.inputs["Roughness"].default_value = 0.58
    L.new(tc.outputs[coord], noise.inputs["Vector"])
    vor = N.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = scale * 1.6
    if "Detail" in vor.inputs:
        vor.inputs["Detail"].default_value = 2.0
    L.new(tc.outputs[coord], vor.inputs["Vector"])

    def math(op, a, b=None, v=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                L.new(x, n.inputs[i])
        return n.outputs[0]

    # shape = n * (1 - billow) + (1 - F1) * billow, around 0.5
    inv = math("SUBTRACT", 1.0, vor.outputs["Distance"])
    shape = math("ADD", math("MULTIPLY", noise.outputs["Fac"], 1.0 - billow), math("MULTIPLY", inv, billow))
    d = math("SUBTRACT", math("MULTIPLY", attr.outputs["Fac"], gain), math("MULTIPLY", math("SUBTRACT", 1.0, shape), erosion))
    d = math("MINIMUM", math("MAXIMUM", d, 0.0), 1.0)
    L.new(math("MULTIPLY", d, density), vol.inputs["Density"])
    return m


# --------------------------------------------------------------------------
# Shapes. All in Blender space (Z up), meters = runtime units.
def tower_spheres(seed, height, width, base=(0.0, 0.0, -8.0), lean=0.12):
    """Cumulus congestus: a leaning core column with cauliflower lumps, widest near the base."""
    rng = random.Random(seed)
    bx, by, bz = base
    out = []
    n = max(6, int(height / (width * 0.18)))
    core = []
    lean_dir = rng.uniform(0, math.tau)
    for k in range(n):
        f = k / (n - 1)
        z = bz + height * (f**0.92) * 0.82
        r = width * 0.5 * (1.0 - 0.5 * f**1.3) * rng.uniform(0.85, 1.08)
        off = width * lean * f * f
        x = bx + math.cos(lean_dir) * off + rng.uniform(-0.06, 0.06) * width
        y = by + math.sin(lean_dir) * off + rng.uniform(-0.06, 0.06) * width
        core.append((x, y, z, r))
    out += core
    # Cauliflower: lumps on the upper hemisphere of core spheres, a few rounds deep.
    lumps = []
    for _ in range(n * 7):
        cx, cy, cz, cr = rng.choice(core)
        th = rng.uniform(0, math.tau)
        ph = math.acos(rng.uniform(-0.35, 1.0))
        d = (math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph))
        rr = cr * rng.uniform(0.3, 0.55)
        lumps.append((cx + d[0] * cr * 0.82, cy + d[1] * cr * 0.82, cz + d[2] * cr * 0.82, rr))
    out += lumps
    for _ in range(n * 6):
        cx, cy, cz, cr = rng.choice(lumps)
        th = rng.uniform(0, math.tau)
        ph = math.acos(rng.uniform(0.0, 1.0))
        d = (math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph))
        out.append((cx + d[0] * cr * 0.8, cy + d[1] * cr * 0.8, cz + d[2] * cr * 0.8, cr * rng.uniform(0.35, 0.6)))
    # Skirt: a wide flat base that melts into the sea.
    for _ in range(10):
        a = rng.uniform(0, math.tau)
        rr = width * rng.uniform(0.28, 0.42)
        out.append((bx + math.cos(a) * width * 0.45, by + math.sin(a) * width * 0.45, bz + rr * 0.2, rr))
    return np.array(out, dtype=np.float32)


def puff_spheres(seed, size=30.0, flat=0.55):
    """A single sea puff: a low dome of lumps, flattened underneath."""
    rng = random.Random(seed)
    out = [(0.0, 0.0, 0.0, size * 0.32)]
    for _ in range(9):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.15, 0.32) * size
        out.append((math.cos(a) * d, math.sin(a) * d * 0.6, rng.uniform(-0.05, 0.08) * size, size * rng.uniform(0.18, 0.27)))
    base = list(out)
    for _ in range(40):
        cx, cy, cz, cr = rng.choice(base)
        th = rng.uniform(0, math.tau)
        ph = math.acos(rng.uniform(0.05, 1.0))
        d = (math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph))
        out.append((cx + d[0] * cr * 0.85, cy + d[1] * cr * 0.85, cz + d[2] * cr * 0.85 * flat + cr * 0.1, cr * rng.uniform(0.3, 0.55)))
    return np.array(out, dtype=np.float32)


def _value_noise(x, y, cell, seed):
    """Smooth 2D value noise in [0, 1] (numpy, vectorized)."""
    rng = np.random.default_rng(seed)
    table = rng.random((512, 512))
    gx, gy = x / cell, y / cell
    ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    fx, fy = gx - ix, gy - iy
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)

    def h(i, j):
        return table[i % 512, j % 512]

    a = h(ix, iy) * (1 - fx) + h(ix + 1, iy) * fx
    b = h(ix, iy + 1) * (1 - fx) + h(ix + 1, iy + 1) * fx
    return a * (1 - fy) + b * fy


def sea_spheres(r_in, r_out, spacing, seed, top=0.0, relief=7.0, center=(0.0, 0.0), gaps=0.18, lumps_per=3):
    """Jittered sheet of cumulus tops between two radii around `center` (Blender XY)."""
    rng = np.random.default_rng(seed)
    cx, cy = center
    n = int(math.ceil(r_out / spacing))
    gx, gy = np.meshgrid(np.arange(-n, n + 1), np.arange(-n, n + 1))
    x = cx + (gx.ravel() + rng.uniform(-0.45, 0.45, gx.size)) * spacing
    y = cy + (gy.ravel() + rng.uniform(-0.45, 0.45, gy.size)) * spacing
    d = np.hypot(x - cx, y - cy)
    keep = (d >= r_in) & (d < r_out)
    x, y = x[keep], y[keep]
    big = _value_noise(x, y, spacing * 9.0, seed + 1)
    mid = _value_noise(x, y, spacing * 3.0, seed + 2)
    keep = (big * 0.7 + mid * 0.3) > gaps
    x, y, big, mid = x[keep], y[keep], big[keep], mid[keep]
    r = spacing * rng.uniform(0.62, 1.05, x.size) * (0.8 + big * 0.5)
    tops = top + (big - 0.5) * relief * 1.6 + (mid - 0.5) * relief
    z = tops - r * 0.72
    main = np.stack([x, y, z, r], axis=1)
    # Cauliflower: a few smaller lumps riding on each dome.
    lumps = []
    for k in range(lumps_per):
        a = rng.uniform(0, math.tau, x.size)
        ph = np.arccos(rng.uniform(0.25, 1.0, x.size))
        d = np.stack([np.sin(ph) * np.cos(a), np.sin(ph) * np.sin(a), np.cos(ph)], axis=1)
        rr = r * rng.uniform(0.28, 0.45, x.size)
        c = main[:, :3] + d * (r * 0.8)[:, None]
        lumps.append(np.concatenate([c, rr[:, None]], axis=1))
    return np.concatenate([main, *lumps]).astype(np.float32)


def volume_settings(sc, bounces=6):
    c = sc.cycles
    c.volume_bounces = bounces
    c.max_bounces = max(c.max_bounces, bounces + 2)
    for attr, v in (("volume_step_rate", 1.0), ("volume_max_steps", 256)):
        if hasattr(c, attr):
            setattr(c, attr, v)


def tint(hex_color):
    return lin(hex_color)
