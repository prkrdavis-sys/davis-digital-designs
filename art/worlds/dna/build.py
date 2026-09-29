"""DNA under the microscope.

Steps (run with --steps a,b,...):
  data        atoms.bin / frames.bin / dna.json for the runtime shader
  proteins    PDB structures via Molecular Nodes -> decimated GLBs
  chromosome  procedural X chromosome GLB
  rail        camera rail -> rails.json
  preview     quick Cycles check of the helix at a given --s
  layers      Low Resources depth layers + posters for every tag (day/night)

Units are nanometers. The model math lives in dna_model.py (shared with the
runtime); this file only stages it in Blender.
"""

import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import dna_model as dm  # noqa: E402
from ddd import cli, export, geo, mat, rails, render, scene  # noqa: E402

SCENE_ID = "dna"


def extra_args(p):
    p.add_argument("--s", type=float, default=0.3)
    p.add_argument("--tags", default="")


args = cli.parse([extra_args])
OUT, PUB = cli.scene_dirs(SCENE_ID)


def b(v):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return (v[0], -v[2], v[1])


# --------------------------------------------------------------------------
# Palettes, kept identical to the runtime (Helix.tsx, materials.ts, Medium.tsx).
# Day: colorized electron micrograph. Night: fluorescence on black.
def lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


PALETTE = {
    "day": {
        "groups": [lin(c) for c in ["#e8563f", "#f5b98a", "#2fbf8f", "#7f5ce6", "#3f86f2", "#f5b43a"]],
        "bg": lin("#ece4ec"),
        "proteins": {k: lin(v) for k, v in {"histone": "#ffb8cf", "pcna": "#9de8d4", "helicase": "#ffcf8a", "polymerase": "#b3c3ff", "groel": "#e9e6f2"}.items()},
        "chromosome": lin("#f29ac2"),
    },
    "night": {
        "groups": [lin(c) for c in ["#3f7dff", "#2b52e6", "#1d44c9", "#1c3bb8", "#2350d8", "#2046c4"]],
        "bg": lin("#020410"),
        "proteins": {k: lin(v) for k, v in {"histone": "#ff3f8e", "pcna": "#3dff8b", "helicase": "#4dff9a", "polymerase": "#ff4f9a", "groel": "#5566dd"}.items()},
        "chromosome": lin("#ff4fa0"),
    },
}


def atom_cloud(name, positions, atoms, coll=None):
    """Mesh of atom centers with radius/group/ao attributes, turned into Cycles spheres by GN."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([b(p) for p in positions], [], [])
    me.update()
    for attr, col in (("radius", 5), ("group", 6), ("ao", 8), ("strand", 1)):
        a = me.attributes.new(attr, "FLOAT", "POINT")
        a.data.foreach_set("value", atoms[:, col].astype(np.float32))
    o = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(o)
    ng = bpy.data.node_groups.new(f"{name}_points", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    gi = ng.nodes.new("NodeGroupInput")
    go = ng.nodes.new("NodeGroupOutput")
    m2p = ng.nodes.new("GeometryNodeMeshToPoints")
    rad = ng.nodes.new("GeometryNodeInputNamedAttribute")
    rad.data_type = "FLOAT"
    rad.inputs["Name"].default_value = "radius"
    setmat = ng.nodes.new("GeometryNodeSetMaterial")
    ng.links.new(gi.outputs[0], m2p.inputs["Mesh"])
    ng.links.new(rad.outputs["Attribute"], m2p.inputs["Radius"])
    ng.links.new(m2p.outputs[0], setmat.inputs["Geometry"])
    ng.links.new(setmat.outputs[0], go.inputs[0])
    mod = o.modifiers.new("points", "NODES")
    mod.node_group = ng
    return o, setmat


def atom_material(variant):
    pal = PALETTE[variant]
    m = bpy.data.materials.new(f"atoms_{variant}")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    grp = nt.nodes.new("ShaderNodeAttribute")
    grp.attribute_name = "group"
    ao = nt.nodes.new("ShaderNodeAttribute")
    ao.attribute_name = "ao"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    cols = pal["groups"]
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (*cols[0], 1)
    els[1].position = 1.0 / 6
    els[1].color = (*cols[1], 1)
    for k in range(2, 6):
        e = els.new(k / 6)
        e.color = (*cols[k], 1)
    div = nt.nodes.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    div.inputs[1].default_value = 6.0
    nt.links.new(grp.outputs["Fac"], div.inputs[0])
    add = nt.nodes.new("ShaderNodeMath")
    add.inputs[1].default_value = 0.02
    nt.links.new(div.outputs[0], add.inputs[0])
    nt.links.new(add.outputs[0], ramp.inputs["Fac"])
    shade = nt.nodes.new("ShaderNodeMixRGB")
    shade.blend_type = "MULTIPLY"
    shade.inputs["Fac"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], shade.inputs[1])
    nt.links.new(ao.outputs["Fac"], shade.inputs[2])
    if variant == "day":
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(shade.outputs[0], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.42
        bsdf.inputs["Coat Weight"].default_value = 0.35
        bsdf.inputs["Coat Roughness"].default_value = 0.2
        bsdf.inputs["Subsurface Weight"].default_value = 0.15
        bsdf.inputs["Subsurface Scale"].default_value = 0.05
        bsdf.inputs["Sheen Weight"].default_value = 0.4
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    else:
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Strength"].default_value = 2.0
        nt.links.new(shade.outputs[0], em.inputs["Color"])
        # Fresnel rim glows brighter, like dye concentrated at the edges.
        fr = nt.nodes.new("ShaderNodeLayerWeight")
        fr.inputs["Blend"].default_value = 0.25
        em2 = nt.nodes.new("ShaderNodeEmission")
        em2.inputs["Color"].default_value = (*lin("#5fb8ff"), 1)
        em2.inputs["Strength"].default_value = 1.8
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fr.outputs["Facing"], mix.inputs[0])
        nt.links.new(em.outputs[0], mix.inputs[1])
        nt.links.new(em2.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return m


# --------------------------------------------------------------------------
def step_data():
    dm.export_runtime(PUB / "hi")
    cli.log("runtime data written", PUB / "hi")


PROTEINS = {
    # key: (pdb code, MDAnalysis selection, target triangles)
    "histone": ("1KX5", "protein", 36000),
    "pcna": ("1AXC", "protein", 26000),
    "helicase": ("1E0J", "protein", 28000),
    "polymerase": ("1T7P", "protein", 26000),
    "groel": ("1AON", "protein", 30000),
}


def mn_module():
    import addon_utils
    import importlib

    addon_utils.enable("bl_ext.blender_org.molecularnodes", default_set=True)
    return importlib.import_module("bl_ext.blender_org.molecularnodes")


def protein_mesh(mn, key):
    code, sel, target = PROTEINS[key]
    mol = mn.Molecule.fetch(code)
    mol.add_style("surface", selection=sel)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mol.object.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    o = bpy.data.objects.new(key, me)
    bpy.context.scene.collection.objects.link(o)
    bpy.data.objects.remove(mol.object, do_unlink=True)
    # Center on the centroid; MN already works in nanometers.
    pts = np.array([v.co[:] for v in me.vertices])
    c = pts.mean(axis=0)
    for v in me.vertices:
        v.co -= Vector(c)
    # Decimate counts triangles; MN surfaces are triangulated quads, so iterate to the target.
    for _ in range(3):
        tris = geo.triangle_count(o)
        if tris <= target * 1.1:
            break
        geo.decimate(o, target / tris)
        geo.apply_all(o)
    geo.smooth(o, 180)
    # Keep only the color attribute for export.
    keep = {"position", "Color"}
    for a in list(o.data.attributes):
        if a.name not in keep and not a.name.startswith("."):
            try:
                o.data.attributes.remove(a)
            except RuntimeError:
                pass
    if "Color" in o.data.attributes:
        o.data.color_attributes.active_color = o.data.attributes["Color"]
    m = mat.principled(f"{key}_mat", base=(1, 1, 1), rough=0.5)
    mat.assign(o, m)
    export.tag(o, protein=key, pdb=code)
    cli.log("protein", key, code, len(o.data.polygons), "faces", "extent", [round(x, 1) for x in o.dimensions])
    return o


def step_proteins():
    scene.reset()
    mn = mn_module()
    for key in PROTEINS:
        o = protein_mesh(mn, key)
        export.glb(OUT / f"{key}.glb", [o])
        bpy.data.objects.remove(o, do_unlink=True)


def chromosome_object():
    """X chromosome: two sister chromatids pinched at the centromere, with
    coiled chromatin relief from layered noise displacement."""
    parts = []
    for side in (-1, 1):
        # Each chromatid is a bent tube from top arm to bottom arm through the centromere.
        pts = []
        for k in range(41):
            t = k / 40
            y = (t - 0.5) * 2
            x = side * (0.11 + 0.22 * abs(y) ** 1.6)
            z = 0.03 * math.sin(t * math.pi * 2)
            pts.append((x, z, y * 1.05))
        radii = [0.16 * (0.55 + 0.45 * min(1.0, abs((k / 40 - 0.5) * 2) * 3.2)) * (1 - 0.35 * abs((k / 40 - 0.5) * 2) ** 6) for k in range(41)]
        parts.append(geo.tube(f"chromatid_{side}", pts, radii=radii, segments=48))
    o = geo.join(parts, "chromosome")
    geo.subsurf(o, 2)
    geo.apply_all(o)
    # Chromatin relief: big lumpy loops + fine fibrous grain.
    geo.displace_noise(o, strength=0.035, scale=0.09, detail=2, name="lumps")
    geo.displace_noise(o, strength=0.012, scale=0.025, detail=2, name="grain")
    geo.apply_all(o)
    geo.smooth(o, 180)
    # ~500 x 1000 nm, a metaphase chromosome's proportions.
    o.data.transform(Matrix.Scale(500.0, 4))
    return o


def step_chromosome():
    scene.reset()
    o = chromosome_object()
    geo.decimate(o, 0.55)
    geo.apply_all(o)
    mat.assign(o, mat.principled("chromosome", base=(1, 1, 1), rough=0.6))
    cli.log("chromosome faces", len(o.data.polygons), "dims", [round(x) for x in o.dimensions])
    export.glb(OUT / "chromosome.glb", [o])


# --------------------------------------------------------------------------
# Camera rail. Angles in degrees around the helix axis, three.js coordinates.
KEYS = [
    # s,    orbit, radius, camY,   lookY,  shift, fov, roll
    # Look-down stays near 25 degrees so the duplex fills the frame; during
    # "work" the camera rides just above the travelling replication fork.
    (0.00, 20, 3.1, -1.5, -3.0, 1.05, 52, -9),
    (0.50, 80, 3.4, -7.0, -8.6, 1.05, 50, -5),
    (1.00, 160, 4.2, -16.0, -18.0, 1.15, 46, 0),
    (1.45, 260, 7.8, -50.5, -46.5, 1.3, 46, 5),
    (1.85, 370, 8.6, -80.5, -76.0, 1.4, 46, 2),
    (2.20, 460, 9.2, -104.5, -100.0, 1.3, 46, -2),
    (2.55, 520, 22.0, -142.0, -156.0, 0.6, 42, 0),
    (2.95, 565, 48.0, -140.0, -162.0, 0.0, 40, 0),
]
PULL_START = 2.95
PULL_DIRS = [(3.1, 160), (3.3, 520), (3.5, 1500), (3.75, 2700), (dm.S_MAX, 3300)]


def orbit_pos(orbit_deg, radius, y):
    a = math.radians(orbit_deg)
    return np.array([radius * math.cos(a), y, radius * math.sin(a)])


FORK_RIDE = (1.2, 2.3)  # during "work", the camera is keyed densely from the fork track


def ride_keys():
    """Camera keys every 0.05 s that stay locked just under the replication fork."""
    out = []
    lo, hi = FORK_RIDE
    base = [k for k in KEYS if lo - 0.3 <= k[0] <= hi + 0.3]
    n = int(round((hi - lo) / 0.05))
    for j in range(n + 1):
        s = lo + j * 0.05
        fy = -dm.sample("fork", s) * dm.RISE
        # Blend orbit/radius/shift/fov/roll from the hand keys around this range.
        prev = max((k for k in base if k[0] <= s), key=lambda k: k[0], default=base[0])
        nxt = min((k for k in base if k[0] >= s), key=lambda k: k[0], default=base[-1])
        t = 0 if nxt[0] == prev[0] else (s - prev[0]) / (nxt[0] - prev[0])
        lerp = lambda a, b: a + (b - a) * t  # noqa: E731
        orb, r, shift, fov, roll = (lerp(prev[i], nxt[i]) for i in (1, 2, 5, 6, 7))
        # Ride just above the upper fork, looking down into the open bubble.
        bubble_look = fy - dm.BUBBLE_LEN * 0.3 * dm.RISE
        cy, ly = (fy + 0.5, bubble_look) if fy < -1 else (lerp(prev[3], nxt[3]), lerp(prev[4], nxt[4]))
        r = min(r, 6.2)
        out.append((s, orb, r, cy, ly, shift, fov, roll))
    return out


def rail_keys():
    keys = []
    lo, hi = FORK_RIDE
    hand = [k for k in KEYS if not (lo <= k[0] <= hi)]
    merged = sorted(hand + ride_keys(), key=lambda k: k[0])
    for s, orb, r, cy, ly, shift, fov, roll in merged:
        pos = orbit_pos(orb, r, cy)
        axis_pt = np.array([0.0, ly, 0.0])
        d = axis_pt - pos
        right = np.cross(d, np.array([0.0, 1.0, 0.0]))
        right /= np.linalg.norm(right)
        # Aim left of the subject so it sits right of centre, clear of the text column.
        look = axis_pt - right * (max(shift, 1.0) * r * 0.3)
        keys.append({"s": s, "pos": b(pos), "look": b(look), "fov": fov, "roll": roll, "_p": pos, "_l": look})
    # Pull straight back from the beads-on-a-string toward the chromosome waiting behind.
    last = keys[-1]
    view = last["_l"] - last["_p"]
    view /= np.linalg.norm(view)
    for s, dist in PULL_DIRS:
        pos = last["_l"] - view * dist
        # Drift sideways as we go, so the chromosome turns a little.
        side = np.cross(view, np.array([0.0, 1.0, 0.0]))
        side /= np.linalg.norm(side)
        k = (s - PULL_START) / (dm.S_MAX - PULL_START)
        pos = pos + side * dist * 0.18 * k
        blend = min(1.0, (s - PULL_START) / 0.4)
        c = chromosome_center()
        to_c = c - pos
        c_right = np.cross(to_c, np.array([0.0, 1.0, 0.0]))
        c_right /= np.linalg.norm(c_right)
        c_look = c - c_right * np.linalg.norm(to_c) * 0.22
        look = c_look * blend + last["_l"] * (1 - blend)
        keys.append({"s": s, "pos": b(pos), "look": b(look), "fov": 40 - k * 6, "roll": 0})
    return keys


def chromosome_center():
    last = KEYS[-1]
    pos = orbit_pos(last[1], last[2], last[3])
    look = np.array([0.0, last[4], 0.0])
    view = look - pos
    view /= np.linalg.norm(view)
    return look + view * 1300.0


def build_camera():
    cam = scene.camera(lens=30)
    cam.data.clip_start = 0.02
    cam.data.clip_end = 20000
    rails.key(cam, [{k: v for k, v in key.items() if not k.startswith("_")} for key in rail_keys()])
    return cam


def step_rail():
    scene.reset()
    cam = build_camera()
    rails.export(cam, PUB / "rails.json", dm.S_MAX)
    c = chromosome_center()
    meta_path = PUB / "hi" / "dna.json"
    if meta_path.exists():
        import json

        meta = json.loads(meta_path.read_text())
        meta["chromosome"] = {"center": [round(float(x), 3) for x in c], "scale": 1.0}
        meta_path.write_text(json.dumps(meta))
    cli.log("rail written; chromosome center", [round(float(x), 1) for x in c])


# --------------------------------------------------------------------------
# Staging for Cycles stills (Low Resources layers + posters). Placement logic
# mirrors src/worlds/scenes/dna/Proteins.tsx.
C3 = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))  # Blender -> three.js rotation


def to_blender_rot(r_three):
    return C3.inverted() @ r_three @ C3


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def protein_material(variant, key):
    pal = PALETTE[variant]
    tint = pal["chromosome"] if key == "chromosome" else pal["proteins"][key]
    m = bpy.data.materials.new(f"{key}_{variant}")
    if hasattr(m, "use_nodes"):
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    col = nt.nodes.new("ShaderNodeVertexColor")
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs["Fac"].default_value = 0.0 if key == "chromosome" else 0.35
    mix.inputs[1].default_value = (*tint, 1)
    nt.links.new(col.outputs["Color"], mix.inputs[2])
    if variant == "day":
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(mix.outputs[0], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.5
        bsdf.inputs["Coat Weight"].default_value = 0.35
        bsdf.inputs["Sheen Weight"].default_value = 0.6
        nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    else:
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.4
        body = nt.nodes.new("ShaderNodeEmission")
        body.inputs["Strength"].default_value = 1.4
        nt.links.new(mix.outputs[0], body.inputs["Color"])
        rim = nt.nodes.new("ShaderNodeEmission")
        rim.inputs["Color"].default_value = (*tint, 1)
        rim.inputs["Strength"].default_value = 3.2
        sh = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lw.outputs["Facing"], sh.inputs[0])
        nt.links.new(body.outputs[0], sh.inputs[1])
        nt.links.new(rim.outputs[0], sh.inputs[2])
        nt.links.new(sh.outputs[0], out.inputs["Surface"])
    return m


_imported = {}


def import_protein(key):
    """Import art/out/dna/<key>.glb once; return a fresh linked copy per use."""
    if key not in _imported:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUT / f"{key}.glb"))
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        src = new[0]
        src.data.transform(src.matrix_world)
        src.matrix_world = Matrix.Identity(4)
        for c in list(src.users_collection):
            c.objects.unlink(src)
        _imported[key] = src
    src = _imported[key]
    o = bpy.data.objects.new(key, src.data)
    bpy.context.scene.collection.objects.link(o)
    return o


def thin_axis_blender(obj):
    d = obj.dimensions
    i = min(range(3), key=lambda k: d[k])
    v = Vector((0, 0, 0))
    v[i] = 1.0
    return v


def place(obj, pos_three, axis_three, scale, spin=0.0):
    target = Vector(b(axis_three)).normalized()
    q = thin_axis_blender(obj).rotation_difference(target)
    from mathutils import Quaternion

    q = Quaternion(target, spin) @ q
    obj.matrix_world = Matrix.LocRotScale(Vector(b(pos_three)), q, Vector((scale, scale, scale)))


def stage_proteins(s, variant, meta_nucs):
    objs = []
    fork = dm.sample("fork", s)
    wrap = dm.sample("wrap", s)
    fade = dm.sample("helix", s)
    on = smooth(min(1.0, fork / 30.0)) * fade
    spin = s * 1.7
    if on > 0.01:
        for i, strand, sign in ((fork + 5, 0, 1), (fork + dm.BUBBLE_LEN - 5, 1, -1)):
            o = import_protein("helicase")
            p = np.array([0.0, -i * dm.RISE, 0.0]) + dm.fork_offset(i, strand, fork)
            place(o, p, (0, 1, 0), 0.5 * on, spin * sign)
            objs.append(o)
        i = fork + dm.BUBBLE_LEN * 0.5
        off = dm.fork_offset(i, 1, fork)
        p = np.array([0.0, -i * dm.RISE, 0.0]) + off
        o = import_protein("pcna")
        place(o, p, (0, 1, 0), 0.5 * on, -spin * 0.6)
        objs.append(o)
        out = off / max(1e-6, np.linalg.norm(off)) * 3.4
        o = import_protein("polymerase")
        place(o, p + out + np.array([0.0, 1.2, 0.0]), (0.3, 1, 0.2), 0.55 * on, spin * 0.3)
        objs.append(o)
    span = max(1, dm.N_BP - dm.NUC_START)
    for n in meta_nucs:
        local = min(1.0, max(0.0, wrap * 1.6 - ((n["firstBp"] - dm.NUC_START) / span) * 0.6))
        k = smooth(local) * fade
        if k > 0.01:
            o = import_protein("histone")
            place(o, n["center"], n["axis"], 0.52 * k)
            objs.append(o)
    for k, p in enumerate([(26, -30, -24), (-34, -88, 30), (30, -150, 26)]):
        o = import_protein("groel")
        place(o, p, (0.4, 1, 0.3), 0.9, s * 0.2 + k * 2.1)
        objs.append(o)
    chromo = dm.sample("chromosome", s)
    if chromo > 0.05:
        o = import_protein("chromosome")
        from mathutils import Euler

        r = to_blender_rot(Euler((0.35, 0, 0.5), "XYZ").to_matrix())
        sc = 0.85 + chromo * 0.15
        o.matrix_world = Matrix.LocRotScale(Vector(b(chromosome_center())), r.to_quaternion(), Vector((sc, sc, sc)))
        objs.append(o)
    return objs


def assign_protein_materials(objs, variant):
    """Shared meshes: set the material on the object slot, not the data."""
    for o in objs:
        key = o.name.split(".")[0]
        if not o.material_slots:
            o.data.materials.append(None)
        o.material_slots[0].link = "OBJECT"
        o.material_slots[0].material = protein_material(variant, key)


def stage(s, variant, atoms, wframes, nucs):
    """Build the full scene at chapter time s for a Cycles still."""
    scene.reset()
    _imported.clear()
    pal = PALETTE[variant]
    sc = scene.cycles(samples=args.samples or (24 if args.preview else 72), bounces=5, res=(1920, 1200))
    scene.view("AgX", look="AgX - Medium High Contrast" if variant == "day" else "AgX - High Contrast")
    scene.world_color(pal["bg"], strength=1.0 if variant == "day" else 0.0)
    cam = build_camera()
    rails.set_at(s)
    bands = {"back": [], "mid": []}

    if dm.sample("helix", s) > 0.02:
        pos = dm.world_atoms(atoms, s, wframes)
        o, setmat = atom_cloud("atoms", pos, atoms)
        setmat.inputs["Material"].default_value = atom_material(variant)
        bands["mid"].append(o)
    prots = stage_proteins(s, variant, nucs)
    assign_protein_materials(prots, variant)
    bands["mid"] += prots

    # A far backdrop card so the back layer carries the cytoplasm gradient.
    cpos = cam.matrix_world.translation
    fwd = (cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    dist = max(4.0, math.hypot(cpos.x, cpos.y))
    card = geo.primitive("grid", "backdrop", x=1, y=1, size=dist * 40)
    card.matrix_world = Matrix.LocRotScale(cpos + fwd * dist * 12, fwd.to_track_quat("Z", "Y"), Vector((1, 1, 1)))
    bm = mat.principled("backdrop", base=(0, 0, 0), emission=PALETTE[variant]["bg"], emission_strength=1.0, rough=1.0)
    ramp = mat.noise_color_node(bm, scale=0.04 / dist, detail=4, colors=(PALETTE[variant]["bg"], tuple(min(1, c * (1.25 if variant == "day" else 3.0)) for c in PALETTE[variant]["bg"])), coord="Generated")
    bm.node_tree.links.new(ramp.outputs["Color"], mat.bsdf_of(bm).inputs["Emission Color"])
    mat.assign(card, bm)
    bands["back"].append(card)

    if variant == "day":
        up = Vector((0, 0, 1))
        right = fwd.cross(up).normalized()
        scene.area_light("key", cpos + right * dist * 0.8 + up * dist * 0.9 - fwd * dist * 0.2, size=dist * 1.2, power=dist * dist * 55, color=(1.0, 0.94, 0.88))
        scene.area_light("rim", cpos + fwd * dist * 2.2 + up * dist * 0.6 - right * dist * 0.8, size=dist * 1.5, power=dist * dist * 80, color=(0.82, 0.87, 1.0))
    return sc, cam, bands


TAGS = [0.0, 0.6, 1.3, 1.75, 2.2, 2.75, 3.3, 3.95]


def step_preview():
    atoms = dm.build_atoms()
    wframes, nucs = dm.wrapped_frames()
    for variant in args.variants:
        sc, cam, bands = stage(args.s, variant, atoms, wframes, nucs)
        sc.render.resolution_x, sc.render.resolution_y = 960, 600
        render.still(OUT / f"preview-{variant}-{args.s:.2f}.png")


def step_layers():
    atoms = dm.build_atoms()
    wframes, nucs = dm.wrapped_frames()
    tags = [float(t) for t in args.tags.split(",")] if args.tags else TAGS
    for variant in args.variants:
        for s in tags:
            sc, cam, bands = stage(s, variant, atoms, wframes, nucs)
            cpos = cam.matrix_world.translation
            dist = max(4.0, math.hypot(cpos.x, cpos.y))
            render.layers(cam, s, [("back", bands["back"]), ("mid", bands["mid"])], OUT / "layers", f"{variant}-s{int(round(s * 100)):03d}", samples=sc.cycles.samples, depths={"back": dist * 12})


def step_pano():
    """360 view from inside the replication bubble, for the homepage door."""
    atoms = dm.build_atoms()
    wframes, nucs = dm.wrapped_frames()
    s = 1.75
    for variant in args.variants:
        sc, cam, bands = stage(s, variant, atoms, wframes, nucs)
        # The flat backdrop card only makes sense for a framed still.
        for o in bands["back"]:
            bpy.data.objects.remove(o, do_unlink=True)
        rails.set_at(s)
        loc = cam.matrix_world.translation.copy()
        # Face the helix axis so the bubble sits in the middle of the panorama (where the door looks).
        yaw = math.degrees(math.atan2(-loc.y, -loc.x))
        png = OUT / f"pano-{variant}.png"
        render.panorama(png, loc, res=(4096, 2048), samples=args.samples or 64, look_yaw_deg=yaw)
        cli.log("pano", variant, png)


def step_mini():
    """A sculptural double helix (~5k tris) for the homepage diorama."""
    scene.reset()
    bp = 22
    pts0, pts1, rungs = [], [], []
    for k in range(bp * 6 + 1):
        i = k / 6
        a = -i * dm.TWIST
        y = -i * 0.34
        pts0.append((math.cos(a - 1.2), -math.sin(a - 1.2), -y))
        pts1.append((math.cos(a + 1.2), -math.sin(a + 1.2), -y))
    s0 = geo.tube("strand0", pts0, radius=0.18, segments=14)
    s1 = geo.tube("strand1", pts1, radius=0.18, segments=14)
    mat.assign(s0, mat.inflatable("backbone", lin("#e8563f")))
    mat.assign(s1, mat.inflatable("backbone2", lin("#3f86f2")))
    colors = [lin(c) for c in ["#2fbf8f", "#7f5ce6", "#f5b43a", "#ff8fb8"]]
    for i in range(bp):
        a = -i * dm.TWIST
        y = i * 0.34
        p0 = Vector((math.cos(a - 1.2), -math.sin(a - 1.2), y))
        p1 = Vector((math.cos(a + 1.2), -math.sin(a + 1.2), y))
        r = geo.tube(f"rung{i}", [p0, (p0 + p1) / 2, p1], radius=0.09, segments=8)
        mat.assign(r, mat.clay(f"rung{i}", colors[i % 4]))
        rungs.append(r)
    o = geo.join([s0, s1, *rungs], "mini_dna")
    geo.smooth(o, 50)
    export.glb(OUT / "mini.glb", [o])


STEPS = {
    "data": step_data,
    "proteins": step_proteins,
    "chromosome": step_chromosome,
    "rail": step_rail,
    "preview": step_preview,
    "layers": step_layers,
    "pano": step_pano,
    "mini": step_mini,
}

for name, fn in STEPS.items():
    if cli.want(args, name) and (name not in ("preview",) or "preview" in args.steps):
        fn()
