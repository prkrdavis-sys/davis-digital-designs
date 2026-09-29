# Everest handoff (scene `everest`)

## Done
- `geo.mjs dem`: 30 m UTM-45N grid, 1571x1844, widened to 86.60-87.08E, 27.63-28.13N (the spec's bbox ended 4.5 km past the summit). Four DEM tiles were used (re-download on the VM; `art/.cache` starts empty).
- `geo.mjs s2`: de-lit Sentinel-2 albedo (3488x4096) plus a mask texture (snow/ice, water, confidence).
- `route.mjs`: OSM trail graph routed Lukla to Base Camp, then South Col waypoints snapped to surveyed elevations. Writes the draped line, a smoothed camera spline and a draw-progress table. The Overpass result is committed at `art/.cache/geo/osm/khumbu_paths.json`.
- `build.py` steps `terrain`, `bake` (day and night, 96 spp) and `rail` ran.
- Public assets in `public/worlds/everest/`: `hi/terrain.glb` (1.2 MB), `hi/terrain-day.ktx2` (3.1 MB), `hi/terrain-night.ktx2` (3.0 MB), `hi/terrain-normal.webp`, `hi/terrain.json`, `hi/route.json`, `hi/height.bin`, `rails.json`, `fonts/` (Geist, OFL).
- Runtime in `src/worlds/scenes/everest/`: `index.tsx`, `data.ts`, `look.ts`, `Terrain.tsx`, `Sky.tsx`, `Route.tsx`, `Atmosphere.tsx`, `LoDrift.tsx`. `tsc` and eslint are clean.

## Not done
- NEVER VIEWED IN A BROWSER. Every shader and all camera framing need visual tuning (exposure, haze, route glow, labels, night).
- `preview`, `layers`, `pano` and `mini` never ran: no Low Resources layers, posters, panoramas or `lo/mini.glb`.
- `build.sh` isn't written. Order: `geo.mjs dem,s2` -> `route.mjs` -> `blend everest --steps terrain,bake,rail` -> optimize terrain with `--tex none` -> toktx (ETC1S, qlevel 230, mipmaps, sRGB) -> normal map to WebP -> `blend everest --steps layers,pano,mini` -> `node art/images.mjs layers everest`.
- The layers/pano/mini steps need the terrain in Blender, so on a fresh VM re-run the fetch and `terrain` steps first (the bake can be skipped if the KTX2 textures are kept; bakes took ~10 min per variant on the laptop GPU, so expect longer on CPU, lower samples if needed).

## Gotchas
- sharp's 16-bit handling garbles values, so the Sentinel-2 mosaic is cached as raw uint16. These COGs carry no +1000 offset: reflectance = DN / 10000.
- The main Overpass server returns 504; the `private.coffee` mirror worked.
- The UV assumes KTX2 row 0 is north, with `flipY` off on the normal map. If the terrain looks mirrored, flip V.
- Terrain colour gain is 1 / the bake scale stored in `terrain.json`. Night exposure is untuned.
- drei's `useKTX2` adds a second KTX2 loader alongside the engine's (`useWorldGLTF` in `src/components/three/engine/assets.ts` already configures one); only a console warning, but consider reusing the engine's loader.
- The cursor altimeter reads `cursorBridge.elevation` (from `@/components/cursor/core`); make sure the scene writes it every frame.
