# Greenhouse handoff (scene `greenhouse`)

## Done
- Build steps `rail`, `meta` (30 day and 14 night light shafts, 735 bulbs, 6 lantern flames, 5 panels), `live` and `mini` ran.
- Cycles previews at several rail positions look good: sunrise haze and shafts down the nave, the rotunda with palms, the lantern oculus, sunrise through the dome, the bench view.
- Scripts in `art/worlds/greenhouse/`: `build.py` (steps bake, live, rail, meta, sky, preview, layers, pano, mini), `gh_model.py` (architecture), `gh_plants.py` (Poly Haven plants plus procedural palms, ivy, pothos), `gh_mat.py`, `mesh.py`, `web.mjs`, `build.sh` (full pipeline).
- Runtime in `src/worlds/scenes/greenhouse/`: `index.tsx`, `data.ts`, `materials.ts`, `Architecture.tsx`, `Foliage.tsx`, `Atmosphere.tsx`, `Panels.tsx`, `NightLights.tsx`, `LoMotes.tsx`.
- Real assets in `public/worlds/greenhouse/`: `rails.json`, `hi/greenhouse.json`, `hi/live.glb` (5.0 MB), `hi/tile-{albedo,normal,rough}.webp`, `lo/mini.glb`.

## Placeholders (overwritten by the next bake/sky/web.mjs run)
- `hi/arch.glb` is a draft without bake UVs; `hi/lm-*`, `hi/sky-*` and `hi/env-*` are flat 64 px colours.

## Not done
- `bake` (was killed partway through the day iron atlas; no lightmaps exist), `sky` (sky and env panoramas), `layers` + posters (day and night), panos, the `web.mjs` conversion of lightmaps/sky/env.
- NEVER VIEWED IN A BROWSER. `tsc` was clean before the latest shader edit (leaf wind shader); eslint hasn't run.
- Run `bash art/worlds/greenhouse/build.sh` (or `blend greenhouse --steps bake,sky --variant both`, optimize `arch.glb`, run `web.mjs`, then layers and pano), then check every chapter in the browser (day, night, lo) and tune the look.
- Poly Haven plant models must be re-fetched on the VM (cache starts empty); `gh_plants.py` knows which ones.

## Gotchas
- Bakes are slow: the iron atlas alone ran for over 12 minutes on the laptop GPU (2048 px, 320 samples; day and night share one UV). On CPU drop to ~96-128 samples with denoise, and use about 40 samples and ~7 tags per variant for layers (the default list has 9).
- Payload is about 13 MB, a little over the 12 MB target. Trimming arcade scroll tubes or foliage would fix it.
- The parked view sits past the tour on the rail, at s = 4.45 to 4.9 (`sMax` 4.9); the parked camera holds around s = 4.6.
- Sun direction verified at 62 deg azimuth and 15 deg elevation (the HDRI is tilted about 7 deg). Sky and env equirects come from `render.panorama` with yaw 0, which matches three's equirect mapping.
- The leaf wind shader offsets in world space after projection, because meshopt quantizes positions. This last edit is not type-checked yet.
