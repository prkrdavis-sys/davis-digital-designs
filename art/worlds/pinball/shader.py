"""A tiny expression layer over Blender shader nodes.

    g = Graph(material)
    x, y = g.xy()
    r = g.length(x - 0.4, y - 6.9)
    rays = g.gt(g.sin(g.atan2(y - 6.9, x - 0.4) * 16), 0)
    col = g.mix(base, (1, 0.3, 0.6), rays * g.smooth(5.0, 1.2, r))

Arithmetic on `S` builds Math nodes; colors are 3-tuples or color sockets.
"""

import bpy
from ddd import mat


class S:
    """A float or color socket that supports arithmetic."""

    def __init__(self, g, sock):
        self.g = g
        self.sock = sock

    def _bin(self, op, other, swap=False):
        a, b = (other, self) if swap else (self, other)
        return self.g.math(op, a, b)

    def __add__(self, o):
        return self._bin("ADD", o)

    def __radd__(self, o):
        return self._bin("ADD", o, True)

    def __sub__(self, o):
        return self._bin("SUBTRACT", o)

    def __rsub__(self, o):
        return self._bin("SUBTRACT", o, True)

    def __mul__(self, o):
        return self._bin("MULTIPLY", o)

    def __rmul__(self, o):
        return self._bin("MULTIPLY", o, True)

    def __truediv__(self, o):
        return self._bin("DIVIDE", o)

    def __rtruediv__(self, o):
        return self._bin("DIVIDE", o, True)

    def __neg__(self):
        return self.g.math("MULTIPLY", self, -1.0)


class Graph:
    def __init__(self, material, clear=True):
        if hasattr(material, "use_nodes"):
            material.use_nodes = True
        self.m = material
        self.nt = material.node_tree
        if clear:
            self.nt.nodes.clear()
        self._coord = None

    def node(self, kind, **attrs):
        n = self.nt.nodes.new(kind)
        for k, v in attrs.items():
            setattr(n, k, v)
        return n

    def feed(self, sock, v):
        if isinstance(v, S):
            self.nt.links.new(v.sock, sock)
        elif isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        elif isinstance(v, (tuple, list)) and sock.type == "RGBA" and len(v) == 3:
            sock.default_value = (*v, 1.0)
        else:
            sock.default_value = v

    # --- coordinates
    def coord(self, kind="Object"):
        if self._coord is None:
            self._coord = self.node("ShaderNodeTexCoord")
        return self._coord.outputs[kind]

    def xy(self, kind="Object"):
        sep = self.node("ShaderNodeSeparateXYZ")
        self.nt.links.new(self.coord(kind), sep.inputs[0])
        return S(self, sep.outputs["X"]), S(self, sep.outputs["Y"])

    def vec(self, x, y, z=0.0):
        c = self.node("ShaderNodeCombineXYZ")
        self.feed(c.inputs["X"], x)
        self.feed(c.inputs["Y"], y)
        self.feed(c.inputs["Z"], z)
        return c.outputs[0]

    # --- math
    def math(self, op, a, b=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return S(self, n.outputs[0])

    def sin(self, a):
        return self.math("SINE", a)

    def cos(self, a):
        return self.math("COSINE", a)

    def atan2(self, y, x):
        return self.math("ARCTAN2", y, x)

    def sqrt(self, a):
        return self.math("SQRT", a)

    def abs(self, a):
        return self.math("ABSOLUTE", a)

    def fract(self, a):
        return self.math("FRACT", a)

    def floor(self, a):
        return self.math("FLOOR", a)

    def min(self, a, b):
        return self.math("MINIMUM", a, b)

    def max(self, a, b):
        return self.math("MAXIMUM", a, b)

    def gt(self, a, b):
        return self.math("GREATER_THAN", a, b)

    def lt(self, a, b):
        return self.math("LESS_THAN", a, b)

    def clamp01(self, a):
        return self.math("ADD", a, 0.0, clamp=True)

    def inside(self, a, lo, hi):
        return self.gt(a, lo) * self.lt(a, hi)

    def length(self, dx, dy):
        return self.sqrt(dx * dx + dy * dy)

    def smooth(self, e0, e1, x):
        """smoothstep(e0, e1, x); e0 > e1 gives a falling edge."""
        n = self.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP", clamp=True)
        self.feed(n.inputs["Value"], x)
        lo, hi, a, b = (e0, e1, 0.0, 1.0) if e0 < e1 else (e1, e0, 1.0, 0.0)
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        n.inputs["To Min"].default_value = a
        n.inputs["To Max"].default_value = b
        return S(self, n.outputs["Result"])

    # --- color
    def mix(self, a, b, fac, blend="MIX"):
        n = self.node("ShaderNodeMixRGB", blend_type=blend, use_clamp=True)
        self.feed(n.inputs["Fac"], self.clamp01(fac) if isinstance(fac, S) else fac)
        self.feed(n.inputs["Color1"], a)
        self.feed(n.inputs["Color2"], b)
        return n.outputs["Color"]

    def ramp(self, fac, stops, interpolation="LINEAR"):
        n = self.node("ShaderNodeValToRGB")
        n.color_ramp.interpolation = interpolation
        els = n.color_ramp.elements
        while len(els) < len(stops):
            els.new(0.5)
        for e, (pos, col) in zip(els, stops):
            e.position = pos
            e.color = (*col, 1.0)
        self.feed(n.inputs["Fac"], fac)
        return n.outputs["Color"]

    def image(self, path, vector=None, colorspace="sRGB", extension="REPEAT"):
        n = self.node("ShaderNodeTexImage")
        img = bpy.data.images.load(str(path), check_existing=True)
        img.colorspace_settings.name = colorspace
        n.image = img
        n.extension = extension
        if vector is not None:
            self.feed(n.inputs["Vector"], vector)
        return n.outputs["Color"]

    def voronoi(self, vector, scale):
        n = self.node("ShaderNodeTexVoronoi")
        self.feed(n.inputs["Vector"], vector)
        n.inputs["Scale"].default_value = scale
        return S(self, n.outputs["Distance"]), n.outputs["Color"]

    def noise(self, vector, scale, detail=4.0):
        n = self.node("ShaderNodeTexNoise")
        self.feed(n.inputs["Vector"], vector)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        return S(self, n.outputs["Fac"])

    def red(self, color):
        n = self.node("ShaderNodeSeparateColor")
        self.feed(n.inputs[0], color)
        return S(self, n.outputs[0])

    # --- outputs
    def emit(self, color, strength=1.0):
        e = self.node("ShaderNodeEmission")
        self.feed(e.inputs["Color"], color)
        self.feed(e.inputs["Strength"], strength)
        out = self.node("ShaderNodeOutputMaterial")
        self.nt.links.new(e.outputs[0], out.inputs["Surface"])
        return e

    def principled(self, **inputs):
        b = self.node("ShaderNodeBsdfPrincipled")
        for k, v in inputs.items():
            name = mat._ALIASES.get(k, k)
            sock = b.inputs.get(name)
            if sock is not None:
                self.feed(sock, v)
        out = self.node("ShaderNodeOutputMaterial")
        self.nt.links.new(b.outputs[0], out.inputs["Surface"])
        return b
