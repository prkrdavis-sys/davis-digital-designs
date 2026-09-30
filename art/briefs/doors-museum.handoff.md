# Doors + museum handoff (scenes `doors` and `museum`)

Branch `cursor/doors-museum-scenes-fbf1` (cloud VM, 4-core CPU, Cycles on CPU).

## Doors (`art/worlds/doors/`: `build.py`, `build.sh`, `arches.py`, `classic.py`, `robust.py`)
- Done: `arches` (laptop), `hi/arches.glb`, `hi/layout.json`.
- In progress: full `bake --variant both` (2048 px, 128 spp, denoised) + `rail` rerun.
- Still to run after the bake: optimize `corridor-{day,night}.glb`, then `layers,pano,mini` and `images.mjs`.
- Runtime fix: the `steel` material's anisotropy produced NaN pixels (no tangents in the GLB) and bloom spread them into a flat grey frame; anisotropy is gone.

## Museum (`art/worlds/museum/`: `build.py`, `gallery.py`, `build.sh`; runtime in `src/worlds/scenes/museum/`)
- First complete asset set is committed: `covers.json`, `hi/{gallery,hall-day,hall-night}.glb`, `hi/layout.json`, `rails.json`, layers + posters (quick pass at 1280x800, 16 spp), `pano-{day,night}.webp` (quick 2730x1365 pass), `lo/mini.glb`.
- Verified in the browser (hi, day): the hall, artworks, frames, bust, stanchions and floor reflections all render.
- Polish in progress (edited in `build.py`, not yet rebaked): brighter "luminous" day (stronger sky, laylight area lights under each skylight, warm cove wall-washers), world-aligned floor material that matches the runtime floor shader (dark diamonds + gilt bands), denser god-ray volumes, explicit layer depths, richer mini.

## Shared helpers and workarounds
- `robust.py` (imported by both builds) now also patches `ddd.bake`:
  - `unwrap_atlas` returned a UV layer that dangles after the edit-mode toggle (`uv.name` then crashes with a UnicodeDecodeError on Linux). The patch returns only the name.
  - `save_srgb` denoises the float lightmap (firefly clamp + log-luminance cross-bilateral) before writing it.
  - Render/bake retries only apply when the device is a GPU.
- `--still-scale` on both builds scales the layer and pano resolution for quick passes.
- `src/worlds/scenes/doors/shared/Grade.ts`: log-space contrast/saturation grade (postprocessing Effect) that emulates Blender's AgX "High Contrast" looks, since the shared compositor only applies base AgX.

## Browser checks on this VM
- 4 cores means the site auto-selects Low Resources. For hi, set `localStorage['ddd:low-power'] = 'false'` explicitly.
- The canvas fades in slowly under SwiftShader; wait for `canvas[data-engine]` opacity 1 before screenshots.
- The neighbouring `bubbles` scene (voices chapter) has no assets on this branch and throws on `rails.json`, which kills the canvas. In the test harness I leave other scenes' missing asset requests pending so they suspend instead of throwing. It resolves once their branches merge.

## Gotchas
- Rail offset: both rails run 0.15 ahead of scene time, covering s from -0.15 to 1.15. The runtime adds the offset back, and the `layers` step rewrites each manifest's `s` to scene time.
- Floors are baked as white irradiance-only lightmaps. The runtime floor shader draws the marble pattern and shows a mirrored copy of the scene (`scale y = -1`) through a Fresnel blend, so render order and the custom blending matter.
- Door portals sample other worlds' `pano-*.webp`. Cycles stills bake in whichever panos exist at render time, so render doors `layers` and `pano` last; re-render them once every world's pano is merged. At runtime the portals HEAD-check each pano and fall back to an animated palette gradient.
- The museum build adds `art/worlds/doors` to `sys.path` for `classic` and `robust`; its runtime imports from `scenes/doors/shared`.
- The museum appends Poly Haven models (`marble_bust_01`, `horse_head`, `gothic_statue`, 1k): `node art/fetch/polyhaven.mjs model <id> 1k`.
