# Greenhouse handoff (scene `greenhouse`)

Branch `cursor/greenhouse-world-70d3` (cloud VM, CPU-only Cycles, 4 cores, ~5 GB free RAM).

## Pipeline (art/worlds/greenhouse/)
- `build.py` steps: `stats` (tris per model function), `sunvis`, `bake`, `live`, `rail`, `meta`, `sky`, `preview`, `layers`, `pano`, `mini`. `build.sh` runs everything in order.
- `mesh.py` MeshBuilder records lightmap UVs per primitive (tube/bar/lathe = one strip island, box face = one island, soil height-fields grouped with `mb.island()`); `pack_atlas()` shelf-packs a group's islands into one atlas (iron 53, masonry 64 texels/m at 2048).
- Sweeps used to wind inward (every tube and bar was inside-out: black in bakes, culled in three.js). Fixed in `MeshBuilder.sweep`; any GLB built before commit 1 of this branch is stale.
- `oidn.py`: OpenImageDenoise via ctypes from Blender's bundled lib; bakes are denoised with albedo + normal aux passes.
- Bake exposures are chosen per atlas (99.7th percentile) and written to `art/out/greenhouse/lightmaps/lightmaps.json` and `greenhouse.json` `lm`; `meta` keeps `lm` and `sunvis`.
- `sunvis`: 25 cm grid, 6 jittered rays per voxel toward the sun (moon) against iron, masonry and plants (BVH), z-slices tiled 8 per row in a grayscale PNG. Runtime turns it into a Data3DTexture.
- `web.mjs lightmaps|sky|sunvis|tiles` converts to `public/worlds/greenhouse/hi/`.

## Runtime (src/worlds/scenes/greenhouse/)
- `Architecture.tsx` assigns materials by exported material name: `lm_paint`, `lm_gilt` (iron), `lm_masonry`, `rt_wire`, `rt_glass`, `rt_floor`.
- `Haze.ts`: `HazeEffect` ray-marches the visibility grid per pixel (volumetric shafts, Henyey-Greenstein toward the sun), replacing scene fog; `GradeEffect` restores the Cycles "Medium High Contrast" punch before the shared AgX.
- `sunvis.ts`: loader (falls back to fully lit if the PNG is missing), GLSL `sunVisibility()`. Foliage and the baked set's live sun specular are shadowed by it (`withSunShadow`, `patchLeaf`).
- Sun/moon intensity and colour come from `greenhouse.json` (Cycles units x glass transmission), so live plants and lightmaps share one exposure.

## Status
- Done: packed UVs, winding fix, iron trim (412k -> 276k tris), wires split, gilt baked as diffuse gold, sky + env panoramas, outro rail pulled back across the dome.
- In progress: full bake (2048, 96 spp, both variants), then `sunvis`, `live`, `mini` rebuilds (winding), look tuning in the browser, layers + posters, panos, screenshots.

## Gotchas
- Headless Chrome on this VM: `hardwareConcurrency <= 4` auto-selects Low Resources; set `localStorage['ddd:low-power']='false'` for hi checks.
- The parked view sits past the tour on the rail, at s = 4.45 to 4.9 (`sMax` 4.9); the parked camera holds around s = 4.6.
- Sun direction verified at 62 deg azimuth and 15 deg elevation (the HDRI is tilted about 7 deg). Sky and env equirects come from `render.panorama` with yaw 0, which matches three's equirect mapping.
- Leaf wind offsets are applied in world space after projection, because meshopt quantizes positions.
- Timing on this VM: full-scene build ~15 s; 960x600 preview at 24 spp ~55 s; 2048 atlas bake at 96 spp ~9 min.
