# Dunes handoff (scene `dunes`)

## Done (but inputs changed since)
- `terrain`, `sky`, `monoliths`, `props` and `rail` ran once. The dune heights, sand drifts and sun angle were then changed and the rerun was killed mid-way. RE-RUN ALL FIVE before baking.
- Cycles previews at s=0, 0.62 and 1.0 (day) looked good. The s=1.0 frame (over the crest into the next valley) is weak: it needs a lower camera looking along the valley.
- Scripts in `art/worlds/dunes/`: `dunes_model.py` (terrain math, slab layout, camera path), `sky.py` (day and night sky maps), `build.py` (all Blender steps), `panels.mjs` (shop products to panel images plus `panels.json`), `preview_map.py` (top-down map of terrain, path and slabs; plain `python3`).
- Public assets in `public/worlds/dunes/hi/` (`field.bin`, `terrain.glb` 2.2 MB, `monoliths.glb`, `props.glb` 1.3 MB, `panels.json`) are from the OLD terrain: regenerate them.
- Runtime, partly written and NOT type-checked, in `src/worlds/scenes/dunes/`: `data.ts`, `palette.ts`, `atmosphere.ts`, `Sky.tsx`, `Terrain.tsx`, `panels.ts`, `Monoliths.tsx`, `Environment.ts`. The placeholder `index.tsx` is untouched.

## Not done
- `bake`, `layers`, `pano`, `mini` never ran. No `rails.json`, `dunes.json`, lightmaps, sky or sand webps, layers, posters, pano or `lo/mini.glb`.
- `build.sh`: should copy `dunes_meta.json` to `hi/dunes.json` and turn the sky, light and data PNGs plus the sand textures into webp.
- Runtime still to write: `index.tsx`, props, footprints, blowing sand, the heat-shimmer effect, the Low Resources version and parked mode (Shop has no project pages, but handle mode="parked" gracefully).
- Then `tsc`, eslint, the browser check and screenshots.

## Gotchas
- The owner's words for this page: "camera zooms over the dunes at a low altitude, going right by some of the monoliths".
- Blender's sky rotation uses the same compass convention as `SUN_AZIMUTH` (confirmed with a test render).
- `optimize.mjs` ignores `--size` unless converting to webp, so `build.py` shrinks the prop textures itself.
- Slab parts carry `role`, `kind` and `product` tags that the runtime reads to assign materials. Each slab's panel is 16:9 inside a portrait card.
- The terrain step needs about 3 GB of RAM (2.25M-vertex grid, then decimated to 495k triangles).
- The bake packs normals and sun shadow into `terrain-data.png`. Irradiance is stored gamma-encoded with a scale saved in the meta file. The runtime decodes both; keep the texture flip as it is.
