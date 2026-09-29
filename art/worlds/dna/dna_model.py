"""B-DNA model shared by the Blender build and the runtime shader.

Units are nanometers in three.js coordinates (Y up). Base pair i sits at
y = -i * RISE on the helix axis and is rotated by Ry(-i * TWIST), which makes
a right-handed helix running down -Y. Strand 0 runs 5'->3' downward, strand 1
is its antiparallel partner (180 degree rotation about the base pair's dyad,
the +X axis, which points into the minor groove).

The runtime (src/worlds/scenes/dna/model.ts) reads atoms.bin, frames.bin and
dna.json written here, and re-implements only the analytic parts:
straight frames, the replication-fork opening, and the blend to the wrapped
(nucleosome) frames. Keep those formulas identical in both places.
"""

import json
import math
import struct

import numpy as np

RISE = 0.338  # nm per base pair
TWIST = 2 * math.pi / 10.5  # radians per base pair
N_BP = 760

# Vdw radii (nm) and component groups for coloring.
RADIUS = {"C": 0.17, "N": 0.155, "O": 0.152, "P": 0.18}
G_PHOSPHATE, G_SUGAR, G_A, G_T, G_G, G_C = 0, 1, 2, 3, 4, 5
ELEMENT_ID = {"C": 0, "N": 1, "O": 2, "P": 3}

# Encoded in the sequence, two bits per base: an easter egg for anyone who reads DNA.
MESSAGE = "DAVIS DIGITAL DESIGNS * "
BASES = "ATGC"


def sequence(n=N_BP):
    bits = []
    for ch in MESSAGE:
        b = ord(ch)
        bits += [(b >> 6) & 3, (b >> 4) & 3, (b >> 2) & 3, b & 3]
    return [BASES[bits[i % len(bits)]] for i in range(n)]


def cyl(r, phi_deg, y):
    """Cylindrical (Angstrom, degrees) -> bp-frame cartesian (nm)."""
    p = math.radians(phi_deg)
    return np.array([r * math.cos(p), y, r * math.sin(p)]) * 0.1


# --- Backbone + sugar for a strand-0 nucleotide (Angstrom / degrees). ------
# P sits "behind" the sugar (further from the minor-groove dyad) and 2.2 A up,
# which gives a ~130 degree minor groove between the two phosphate helices.
BACKBONE = [
    ("P", G_PHOSPHATE, (8.9, -88.0, 2.2)),
    ("O", G_PHOSPHATE, (10.3, -89.0, 1.7)),  # OP1
    ("O", G_PHOSPHATE, (9.2, -97.0, 3.3)),  # OP2
    ("O", G_PHOSPHATE, (8.4, -80.0, 3.0)),  # O5'
    ("C", G_SUGAR, (8.2, -78.0, 1.5)),  # C5'
    ("C", G_SUGAR, (7.6, -72.0, 0.7)),  # C4'
    ("O", G_SUGAR, (6.6, -70.0, 1.1)),  # O4'
    ("C", G_SUGAR, (5.9, -63.0, 0.0)),  # C1'
    ("C", G_SUGAR, (6.7, -58.0, -0.9)),  # C2'
    ("C", G_SUGAR, (7.7, -64.0, -0.6)),  # C3'
    ("O", G_SUGAR, (8.1, -57.0, -1.2)),  # O3' -> next P
]

C1P = cyl(5.9, -63.0, 0.0)
C1P_PARTNER = cyl(5.9, 63.0, 0.0)


def _ring(center, radius, n, start_angle):
    return [center + radius * np.array([math.cos(start_angle + 2 * math.pi * k / n), math.sin(start_angle + 2 * math.pi * k / n)]) for k in range(n)]


def base_atoms(kind):
    """Planar base atoms in a (u, v) frame with the glycosidic N at u=1.47 A.

    u points from this strand's C1' toward the partner C1', bent 25 degrees
    toward the major groove; v is perpendicular in the base plane.
    """
    atoms = []
    if kind in "TC":
        # Pyrimidine: one hexagon attached at N1.
        center = np.array([2.86, 0.0])
        ring = _ring(center, 1.39, 6, math.pi)  # vertex 0 = N1 on the C1' side
        names = ["N", "C", "N", "C", "C", "C"]  # N1 C2 N3 C4 C5 C6
        atoms += list(zip(names, ring))
        out = lambda k, d: ring[k] + (ring[k] - center) / np.linalg.norm(ring[k] - center) * d  # noqa: E731
        atoms.append(("O", out(1, 1.23)))  # O2
        if kind == "T":
            atoms.append(("O", out(3, 1.23)))  # O4
            atoms.append(("C", out(4, 1.50)))  # C5 methyl
        else:
            atoms.append(("N", out(3, 1.34)))  # N4
    else:
        # Purine: pentagon at N9 fused with a hexagon on the C4-C5 edge. The
        # pentagon is turned so the hexagon reaches toward the partner base,
        # with N9 held at the glycosidic bond length from C1'.
        start = math.radians(108.0)
        n9 = np.array([1.47, 0.0])
        c5 = n9 - 1.19 * np.array([math.cos(start), math.sin(start)])
        pent = _ring(c5, 1.19, 5, start)  # N9 C8 N7 C5 C4 (vertex 0 = N9)
        edge_mid = (pent[3] + pent[4]) / 2
        away = edge_mid - c5
        away /= np.linalg.norm(away)
        c6 = edge_mid + away * 1.2
        a0 = math.atan2(pent[4][1] - c6[1], pent[4][0] - c6[0])
        hexr = _ring(c6, 1.39, 6, a0)
        # Keep the four hexagon atoms not shared with the pentagon (N3 C2 N1 C6), in ring order from C4.
        shared = [pent[3], pent[4]]
        own = [p for p in hexr if min(np.linalg.norm(p - q) for q in shared) > 0.2]
        if np.linalg.norm(own[0] - pent[4]) > np.linalg.norm(own[-1] - pent[4]):
            own = own[::-1]
        hexr = [pent[4], *own, pent[3]]  # C4 N3 C2 N1 C6 C5
        atoms += list(zip(["N", "C", "N", "C", "C"], pent))
        atoms += list(zip(["N", "C", "N", "C"], hexr[1:5]))
        out = lambda k, d: hexr[k] + (hexr[k] - c6) / np.linalg.norm(hexr[k] - c6) * d  # noqa: E731
        if kind == "A":
            atoms.append(("N", out(4, 1.34)))  # N6
        else:
            atoms.append(("O", out(4, 1.23)))  # O6
            atoms.append(("N", out(2, 1.34)))  # N2
    return atoms


# Regular-polygon rings overshoot real base lengths slightly; pull them in so
# partner bases meet at hydrogen-bond distance instead of interpenetrating.
BASE_REACH = 0.82


def base_to_bp(uv):
    """(u, v) Angstrom in the base frame -> bp-frame nm, anchored at strand-0 C1'."""
    uv = (uv[0] * BASE_REACH, uv[1])
    d = C1P_PARTNER - C1P
    d /= np.linalg.norm(d)
    # Rotate 25 degrees toward the major groove (-X) within the base plane.
    a = math.radians(25.0)
    u = np.array([d[0] * math.cos(a) - d[2] * math.sin(a), 0.0, d[0] * math.sin(a) + d[2] * math.cos(a)])
    u /= np.linalg.norm(u)
    v = np.array([-u[2], 0.0, u[0]])
    return C1P + (u * uv[0] + v * uv[1]) * 0.1


def dyad(p):
    """Strand 0 -> strand 1: 180 degrees about +X in the bp frame."""
    return np.array([p[0], -p[1], -p[2]])


def nucleotide_template(base, strand):
    """List of (element, group, local_xyz_nm) for one nucleotide."""
    group = {"A": G_A, "T": G_T, "G": G_G, "C": G_C}[base]
    atoms = [(el, g, cyl(*rpy)) for el, g, rpy in BACKBONE]
    atoms += [(el, group, base_to_bp(uv)) for el, uv in base_atoms(base)]
    if strand == 1:
        atoms = [(el, g, dyad(p)) for el, g, p in atoms]
    return atoms


def complement(b):
    return {"A": "T", "T": "A", "G": "C", "C": "G"}[b]


def build_atoms(n_bp=N_BP):
    """Array rows: bp, strand, lx, ly, lz, radius, group, element, ao."""
    seq = sequence(n_bp)
    rows = []
    for i, b in enumerate(seq):
        for strand, base in ((0, b), (1, complement(b))):
            for el, g, p in nucleotide_template(base, strand):
                rows.append([i, strand, p[0], p[1], p[2], RADIUS[el], g, ELEMENT_ID[el], 1.0])
    atoms = np.array(rows, dtype=np.float32)
    # Cheap per-atom ambient occlusion from neighbor density in the straight duplex.
    world = straight_positions(atoms)
    ao = np.ones(len(atoms), dtype=np.float32)
    window = 60
    for i in range(len(atoms)):
        lo, hi = max(0, i - window), min(len(atoms), i + window)
        d = np.linalg.norm(world[lo:hi] - world[i], axis=1)
        crowd = np.count_nonzero(d < 0.55) - 1
        ao[i] = 1.0 - min(0.65, max(0.0, (crowd - 3) / 14.0))
    atoms[:, 8] = ao
    return atoms


def ry(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def straight_frame(i):
    """Origin and 3x3 basis (columns x, y, z) of base pair i in the straight duplex."""
    return np.array([0.0, -i * RISE, 0.0]), ry(-i * TWIST)


def straight_positions(atoms):
    out = np.zeros((len(atoms), 3), dtype=np.float32)
    for k, a in enumerate(atoms):
        o, m = straight_frame(a[0])
        out[k] = o + m @ a[2:5]
    return out


# --- Replication bubble ----------------------------------------------------
# Two forks: the strands part at `fork` and rejoin BUBBLE_LEN base pairs lower.
# The camera rides the upper fork looking down into the open bubble.
FORK_WIDTH = 14.0  # bp over which the strands peel apart (and close again)
FORK_MAX_SEP = 3.4  # nm, max half-separation of the two strands
BUBBLE_LEN = 90.0  # bp between the two forks


def _smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def bubble_open(i, fork):
    if fork <= 0:
        return 0.0
    return _smooth((i - fork) / FORK_WIDTH) * (1.0 - _smooth((i - fork - BUBBLE_LEN + FORK_WIDTH) / FORK_WIDTH))


def fork_offset(i, strand, fork):
    """Separation of a strand at base pair i with the upper fork at bp `fork`.

    The strands part along a direction that slowly rotates with depth, so the
    bubble twists instead of opening flat.
    """
    o = bubble_open(i, fork)
    if o <= 0:
        return np.zeros(3)
    ang = i * 0.018
    d = np.array([math.cos(ang), 0.0, math.sin(ang)])
    return d * FORK_MAX_SEP * o * (1 if strand == 0 else -1)


# --- Nucleosomes (beads on a string) ---------------------------------------
NUC_START = 470  # first wrapped base pair
NUC_BP = 147  # base pairs per nucleosome core
NUC_LINKER = 38
NUC_COUNT = 2
NUC_RADIUS = 4.18  # nm, DNA superhelix radius around the octamer
NUC_TURNS = 1.65
NUC_PITCH = 2.39  # nm rise per superhelical turn


def wrapped_centerline(n_bp=N_BP):
    """Centerline points and nucleosome placements for the compacted state.

    Unwrapped stretches continue as straight linkers from the previous exit.
    Nucleosome axes are horizontal and alternate direction for a zig-zag fiber.
    """
    pts = np.zeros((n_bp, 3))
    nucs = []
    pos = np.array([0.0, -NUC_START * RISE, 0.0])
    heading = np.array([0.0, -1.0, 0.0])
    for i in range(NUC_START):
        pts[i] = np.array([0.0, -i * RISE, 0.0])
    i = NUC_START
    n = 0
    while i < n_bp:
        if n < NUC_COUNT:
            # Build the superhelix in a local frame, then place it tangent to the incoming heading.
            axis = np.array([1.0, 0.0, 0.0]) if n % 2 == 0 else np.array([0.0, 0.0, 1.0])
            side = np.cross(heading, axis)
            side /= np.linalg.norm(side)
            center = pos + side * NUC_RADIUS
            for k in range(NUC_BP):
                if i + k >= n_bp:
                    break
                a = -2 * math.pi * NUC_TURNS * k / NUC_BP  # left-handed wrap
                radial = -side * math.cos(a) + np.cross(axis, -side) * math.sin(a)
                along = axis * (NUC_PITCH * NUC_TURNS * (k / NUC_BP - 0.5))
                pts[i + k] = center + radial * NUC_RADIUS + along
            last = min(n_bp - 1, i + NUC_BP - 1)
            nucs.append({"center": center.tolist(), "axis": axis.tolist(), "firstBp": i, "lastBp": last})
            i += NUC_BP
            if i >= n_bp:
                break
            heading = pts[i - 1] - pts[i - 2]
            heading /= np.linalg.norm(heading)
            # Linker leaves at a steep angle so the next bead sits off to the side.
            heading = heading * 0.6 + np.array([0.0, -0.8, 0.0])
            heading /= np.linalg.norm(heading)
            pos = pts[i - 1]
            for k in range(NUC_LINKER):
                if i >= n_bp:
                    break
                pos = pos + heading * RISE
                pts[i] = pos
                i += 1
            n += 1
        else:
            pos = pos + heading * RISE
            pts[i] = pos
            i += 1
    return pts, nucs


def wrapped_frames(n_bp=N_BP):
    """Per base pair: origin, tangent (bp-frame Y axis), normal (bp-frame X axis) with twist."""
    pts, nucs = wrapped_centerline(n_bp)
    frames = np.zeros((n_bp, 9), dtype=np.float32)
    ref = np.array([1.0, 0.0, 0.0])
    normal = ref
    for i in range(n_bp):
        a = pts[max(0, i - 1)]
        b = pts[min(n_bp - 1, i + 1)]
        tangent = a - b  # bp-frame +Y points back up the chain (toward i-1)
        tangent /= np.linalg.norm(tangent)
        # Parallel transport the reference normal, then apply the helical twist.
        normal = normal - tangent * np.dot(normal, tangent)
        if np.linalg.norm(normal) < 1e-6:
            normal = np.cross(tangent, np.array([0.0, 0.0, 1.0]))
        normal /= np.linalg.norm(normal)
        binormal = np.cross(normal, tangent)
        th = -i * TWIST
        x_axis = normal * math.cos(th) - binormal * math.sin(th)
        frames[i, 0:3] = pts[i]
        frames[i, 3:6] = tangent
        frames[i, 6:9] = x_axis
    return frames, nucs


# --- Scroll timeline (chapter time s -> scene state) ------------------------
# Chapters: intro [0,1) close-up descent, work [1,2) replication fork,
# interlude [2,3) beads on a string, outro [3,4] pull back to the chromosome.
# The camera rail in build.py follows the same beats.
S_MAX = 4.2
TIMELINE = {
    # Replication fork position (bp) as a function of s.
    # The zipper races down from the top to meet the camera, then rides with it.
    "fork": [[0.0, 0.0], [0.9, 0.0], [1.08, 52.0], [1.45, 140.0], [2.2, 300.0], [S_MAX, 300.0]],
    # 0 = straight duplex, 1 = wrapped into nucleosomes (travelling front).
    "wrap": [[0.0, 0.0], [2.25, 0.0], [2.85, 1.0], [S_MAX, 1.0]],
    # Chromosome reveal.
    "chromosome": [[0.0, 0.0], [3.1, 0.0], [3.55, 1.0], [S_MAX, 1.0]],
    # Helix fade as we pull far back.
    "helix": [[0.0, 1.0], [3.2, 1.0], [3.65, 0.0], [S_MAX, 0.0]],
}


def sample(track, s):
    pts = TIMELINE[track]
    if s <= pts[0][0]:
        return pts[0][1]
    for (s0, v0), (s1, v1) in zip(pts, pts[1:]):
        if s <= s1:
            t = (s - s0) / (s1 - s0)
            t = t * t * (3 - 2 * t)
            return v0 + (v1 - v0) * t
    return pts[-1][1]


def wrap_amount(i, wrap):
    """Travelling wrap front: base pairs nearer NUC_START wrap first."""
    span = N_BP - NUC_START
    k = (i - NUC_START) / max(1, span)
    t = min(1.0, max(0.0, wrap * 1.6 - k * 0.6))
    return t * t * (3 - 2 * t)


def world_atoms(atoms, s, wframes=None):
    """World-space atom centers at chapter time s (same math as the shader)."""
    fork = sample("fork", s)
    wrap = sample("wrap", s)
    if wframes is None:
        wframes, _ = wrapped_frames()
    out = np.zeros((len(atoms), 3), dtype=np.float32)
    for k, a in enumerate(atoms):
        i = int(a[0])
        strand = int(a[1])
        o, m = straight_frame(i)
        o = o + fork_offset(i, strand, fork)
        w = wrap_amount(i, wrap)
        if w > 0:
            f = wframes[i]
            y = f[3:6]
            x = f[6:9]
            z = np.cross(x, y)
            mw = np.stack([x, y, z], axis=1)
            o = o * (1 - w) + f[0:3] * w
            m = m * (1 - w) + mw * w
            # Re-orthonormalize the blended basis.
            xb = m[:, 0] / np.linalg.norm(m[:, 0])
            yb = m[:, 1] - xb * np.dot(m[:, 1], xb)
            yb /= np.linalg.norm(yb)
            m = np.stack([xb, yb, np.cross(xb, yb)], axis=1)
        out[k] = o + m @ a[2:5]
    return out


ATOM_Q = 20000.0  # int16 units per nm for local coordinates (range +/-1.6 nm)
ATOM_RECORD = np.dtype([("bp", "<i2"), ("lx", "<i2"), ("ly", "<i2"), ("lz", "<i2"), ("strand", "u1"), ("radius", "u1"), ("group", "u1"), ("el", "u1"), ("ao", "u1"), ("pad", "u1")])


def quantize_atoms(atoms):
    """14 bytes per atom instead of 36. Decoded by src/worlds/scenes/dna/model.ts."""
    q = np.zeros(len(atoms), dtype=ATOM_RECORD)
    q["bp"] = atoms[:, 0].astype(np.int16)
    for k, name in ((2, "lx"), (3, "ly"), (4, "lz")):
        q[name] = np.round(atoms[:, k] * ATOM_Q).astype(np.int16)
    q["strand"] = atoms[:, 1].astype(np.uint8)
    q["radius"] = np.round(atoms[:, 5] * 1000).astype(np.uint8)
    q["group"] = atoms[:, 6].astype(np.uint8)
    q["el"] = atoms[:, 7].astype(np.uint8)
    q["ao"] = np.round(np.clip(atoms[:, 8], 0, 1) * 255).astype(np.uint8)
    return q.tobytes()


def export_runtime(out_dir):
    """atoms.bin (quantized, 14 B/atom), frames.bin (Float32 x9 per bp), dna.json."""
    atoms = build_atoms()
    frames, nucs = wrapped_frames()
    (out_dir / "atoms.bin").write_bytes(quantize_atoms(atoms))
    (out_dir / "frames.bin").write_bytes(frames.astype(np.float32).tobytes())
    meta = {
        "rise": RISE,
        "twist": TWIST,
        "nBp": N_BP,
        "atoms": int(len(atoms)),
        "stride": 9,
        "atomFormat": {"bytes": ATOM_RECORD.itemsize, "q": ATOM_Q},
        "fork": {"width": FORK_WIDTH, "maxSep": FORK_MAX_SEP, "bubble": BUBBLE_LEN},
        "nucleosomes": nucs,
        "nucStart": NUC_START,
        "timeline": TIMELINE,
        "sequence": "".join(sequence()),
    }
    (out_dir / "dna.json").write_text(json.dumps(meta))
    return atoms, frames, nucs


if __name__ == "__main__":
    import pathlib
    import sys

    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    a, f, n = export_runtime(out)
    print("atoms", len(a), "bytes", len(a) * 36, "nucleosomes", len(n))
    _ = struct
