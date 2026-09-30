"""Art-directed skies as equirect radiance maps (Blender environment mapping, Z up).

day_sky(): desert sunset. Deep blue zenith, a dusty orange horizon that cools to
lavender and the pink Belt of Venus away from the sun, the Earth's shadow rising
opposite, a wide Mie glow and thin wind-combed cirrus lit from below.
night_sky(): moonlit. Airglow gradient, a Milky Way with dust lanes, stars, the moon.

The sun/moon disc itself is not in these maps (the renderers add it for camera rays).
Used by build.py (Cycles world + runtime sky textures); preview with plain python3:
    python3 art/worlds/dunes/sky.py day|night out.png
"""

import math
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import dunes_model as dm  # noqa: E402


def srgb_to_lin(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return np.array([x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c])


def equirect_dirs(w, h):
    u = (np.arange(w) + 0.5) / w
    v = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(u, v)
    lon = (U - 0.5) * 2 * np.pi  # Blender: u = atan2(y, -x) / 2pi + 0.5
    lat = (V - 0.5) * np.pi
    return np.stack([-np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)


def dir_to_uv(d, w, h):
    u = np.arctan2(d[..., 1], -d[..., 0]) / (2 * np.pi) + 0.5
    v = np.arctan2(d[..., 2], np.hypot(d[..., 0], d[..., 1])) / np.pi + 0.5
    return u * w, v * h


def light_dir(elevation=None):
    az = math.radians(dm.SUN_AZIMUTH)
    el = math.radians(dm.SKY_ELEVATION if elevation is None else elevation)
    return np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])


def day_sky(w=2048, h=1024):
    D = equirect_dirs(w, h)
    el = np.arcsin(np.clip(D[..., 2], -1, 1))
    S = light_dir()
    cs = np.clip(D @ S, -1, 1)
    # Horizontal angle to the sun: 0 toward it, 1 away.
    hs = np.array([S[0], S[1], 0.0])
    hs /= np.linalg.norm(hs)
    hd = D.copy()
    hd[..., 2] = 0
    hd /= np.linalg.norm(hd, axis=-1, keepdims=True) + 1e-9
    away = (1 - np.clip(hd @ hs, -1, 1)) / 2
    e = np.clip(el, 0, None)

    zenith = srgb_to_lin("#2a5898")
    upper = srgb_to_lin("#7ea2c8")
    band_sun = srgb_to_lin("#ff8c3a")
    band_side = srgb_to_lin("#f6a070")
    band_away = srgb_to_lin("#cf9cb6")
    shadow_blue = srgb_to_lin("#6a7fb0")
    near = (1 - away) ** 2

    # vertical structure: zenith -> upper sky -> glowing horizon band
    t_up = np.clip(e / (math.pi / 2), 0, 1) ** 0.55
    sky = upper[None, None] * (1 - t_up)[..., None] + zenith[None, None] * t_up[..., None]
    # The low sky on the sun's side turns gold well above the band.
    warm = near * np.exp(-e / 0.45) * 0.55
    sky = sky * (1 - warm)[..., None] + srgb_to_lin("#f0b27a")[None, None] * warm[..., None]
    band_col = band_sun[None, None] * np.clip(1 - away * 2, 0, 1)[..., None] + band_side[None, None] * (1 - np.abs(away * 2 - 1))[..., None] + band_away[None, None] * np.clip(away * 2 - 1, 0, 1)[..., None]
    band = np.exp(-e / (0.1 + 0.2 * near))
    sky = sky * (1 - band)[..., None] + band_col * band[..., None]
    # Earth's shadow rising opposite the sun, Belt of Venus just above it.
    anti = np.clip(away * 2 - 1, 0, 1) ** 2
    shadow = np.exp(-(e / 0.035) ** 2) * anti
    belt = np.exp(-(((e - 0.09) / 0.05) ** 2)) * anti
    sky = sky * (1 - 0.55 * shadow)[..., None] + shadow_blue * 0.55 * shadow[..., None] + srgb_to_lin("#ffb3c6") * 0.35 * belt[..., None]
    # brightness: brighter toward the horizon and the sun
    lum = 0.5 + 0.85 * band + 0.45 * near
    sky *= lum[..., None]
    # Mie glow around the sun: a hot golden core inside a wide orange aureole.
    g = np.clip(cs, 0, 1)
    low = np.clip(1.2 - e * 2, 0.2, 1)[..., None]
    sky += srgb_to_lin("#ffd08e")[None, None] * (2.4 * g**90 + 0.7 * g**20)[..., None] * low
    sky += srgb_to_lin("#ff8f45")[None, None] * (0.55 * g**6 + 0.22 * g**2)[..., None] * low
    # Thin cirrus, combed by the wind, lit warm near the sun and pink away from it.
    lon = np.arctan2(D[..., 1], -D[..., 0])
    # project onto a flat cloud deck so streaks converge at the horizon
    deck = 1.0 / np.maximum(np.sin(e), 0.035)
    px_, py_ = D[..., 0] * deck, D[..., 1] * deck
    ang = math.radians(75)
    cu = px_ * math.cos(ang) + py_ * math.sin(ang)
    cv = -px_ * math.sin(ang) + py_ * math.cos(ang)
    streak = dm.fbm(cu * 0.35, cv * 2.6, 5)
    streak = np.clip((streak - 0.12) * 2.4, 0, 1) ** 1.6
    patch = np.clip(dm.fbm(cu * 0.12 + 4.0, cv * 0.18, 3) * 1.8 + 0.1, 0, 1)
    cloud = streak * patch * np.clip((e - 0.03) / 0.08, 0, 1) * np.clip(1 - e / 1.0, 0, 1)
    ccol = srgb_to_lin("#ffcf9a")[None, None] * (0.6 + 2.6 * g**6)[..., None] * np.clip(1 - away, 0.25, 1)[..., None] + srgb_to_lin("#e79fb5")[None, None] * 0.55 * away[..., None]
    sky = sky * (1 - 0.65 * cloud)[..., None] + ccol * 1.4 * cloud[..., None]
    _ = lon
    # below the horizon: warm dusty haze, darkening downward
    below = el < 0
    haze = band_col * (0.9 + 1.2 * np.clip(1 - away, 0, 1))[..., None] * np.exp(el / 0.25)[..., None]
    sky[below] = haze[below]
    return (sky * 0.9).astype(np.float32)


MW_A = None


def night_sky(w=4096, h=2048):
    D = equirect_dirs(w, h)
    el = D[..., 2]
    horizon = srgb_to_lin("#23385e") * 0.55
    zenith = srgb_to_lin("#050b1f") * 0.5
    t = np.clip(el, 0, 1) ** 0.45
    col = horizon[None, None] * (1 - t)[..., None] + zenith[None, None] * t[..., None]
    col = np.where((el < 0)[..., None], horizon[None, None] * 0.35 * np.exp(el / 0.3)[..., None], col)

    def azel(az, e):
        a, b = math.radians(az), math.radians(e)
        return np.array([math.cos(b) * math.sin(a), math.cos(b) * math.cos(a), math.sin(b)])

    A = azel(-25, 2)
    B = azel(95, 62)
    pole = np.cross(A, B)
    pole /= np.linalg.norm(pole)
    b = np.arcsin(np.clip(D @ pole, -1, 1))
    e1 = A / np.linalg.norm(A)
    e2 = np.cross(pole, e1)
    l = np.arctan2(D @ e2, D @ e1)
    core = np.exp(-((l / 0.8) ** 2))
    width = 0.075 + 0.08 * core
    band = np.exp(-((b / width) ** 2)) + 0.35 * np.exp(-((b / (width * 2.6)) ** 2))
    clouds = np.clip(0.35 + 0.8 * dm.fbm(l * 7.0, b * 7.0, 5), 0, None)
    fine = np.clip(0.4 + 0.9 * dm.fbm(l * 38.0 + 3, b * 38.0, 3), 0, None)
    lane_w = 0.02 + 0.018 * core
    lane = 1.0 - 0.85 * np.exp(-(((b - 0.012 * np.sin(l * 4)) / lane_w) ** 2)) * np.clip(0.4 + dm.fbm(l * 10 + 7, b * 10, 3), 0, 1)
    mw = band * clouds * lane * (0.5 + 1.1 * core) * (0.6 + 0.5 * fine)
    mw_col = np.array([0.55, 0.65, 0.95])[None, None] * (1 - core)[..., None] + np.array([1.0, 0.8, 0.58])[None, None] * core[..., None]
    col = col + mw[..., None] * mw_col * 0.16
    # stars
    rng = np.random.default_rng(11)
    n = 22000
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    mag = rng.power(0.14, n)
    bright = 0.03 + mag * 2.4
    bright[np.abs(v @ pole) < 0.2] *= 1.25
    temp = rng.uniform(0, 1, n)
    scol = np.stack([0.78 + 0.22 * temp, 0.86 + 0.1 * np.sin(temp * 3), 1.0 - 0.4 * temp], 1)
    su, sv = dir_to_uv(v, w, h)
    xi = su.astype(int) % w
    yi = np.clip(sv.astype(int), 0, h - 1)
    np.add.at(col, (yi, xi), scol * bright[:, None])
    big = bright > 0.8
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        np.add.at(col, (np.clip(yi[big] + dy, 0, h - 1), (xi[big] + dx) % w), scol[big] * bright[big, None] * 0.22)
    # moon halo (the disc itself is drawn by the renderers)
    md = light_dir(dm.SUN_ELEVATION)
    ang = np.arccos(np.clip(D @ md, -1, 1))
    col = col + np.exp(-ang / 0.06)[..., None] * srgb_to_lin("#9fb4e0") * 0.4 + np.exp(-ang / 0.4)[..., None] * srgb_to_lin("#3c5282") * 0.16
    return col.astype(np.float32)


def display(col, exposure=1.0):
    x = col * exposure
    x = x / (1 + x)
    return np.clip(x * 1.25, 0, 1) ** (1 / 2.2)


if __name__ == "__main__":
    from PIL import Image

    kind = sys.argv[1] if len(sys.argv) > 1 else "day"
    out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/dunes_sky_{kind}.png"
    col = day_sky(1024, 512) if kind == "day" else night_sky(2048, 1024)
    img = (display(col, 1.0 if kind == "day" else 3.0)[::-1] * 255).astype(np.uint8)
    Image.fromarray(img).save(out)
    print("saved", out, float(col.max()), float(np.median(col)))
