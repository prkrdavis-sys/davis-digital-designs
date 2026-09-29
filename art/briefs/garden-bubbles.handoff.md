# Garden + bubbles handoff (scenes `garden` and `bubbles`)

## Garden (hero chapter)
- Done: 18 inflated sculptures, day GI bake of the clay plinths, runtime GLB (`hi/garden.glb`, 0.55 MB, 20 named nodes), `hi/plinths-day.glb`, `hi/studio.hdr`, `rails.json` (s 0 to 1.2), `lo/mini.glb`. Test renders per variant (s = 0, 0.64, 1.0) looked good; a later rail re-key and night tweaks haven't been re-rendered.
- Remaining: night bake, optimized into `hi/plinths-night.glb`; layers and posters (tags s = 0, 0.5, 1.0); both panoramas; browser checks.
- Scripts: `art/worlds/garden/build.py`, `toy.py` (shared inflatable helpers), `build.sh`.
- Runtime in `src/worlds/scenes/garden/`: `index`, `palette`, `materials`, `Pool` (mirror reflection with cursor ripples), `Sky`, `Sculptures` (jiggle, parting, cursor boops), `Motes`.
- The inflated shapes were stored in `art/out/garden/shapes/` (one file per sculpture) on the laptop; that cache is NOT on the VM, so the layers/pano steps need the sculptures re-inflated first. `--only name` re-inflates a single piece.

## Bubbles (voices chapter)
- Done: `art/worlds/bubbles/build.py` and `build.sh`, plus runtime in `src/worlds/scenes/bubbles/` (`index`, `palette`, `materials`, `layout`, `Flock` spring physics, `Clouds`).
- Remaining: EVERY build step (shapes, clouds, export, rail, layers, pano, mini). Until `bubbles.glb`, `layout.json`, the cloud webps and `rails.json` exist, the scene fails to load, which breaks the homepage voices chapter. Do this first.

## Checks
- `tsc` and eslint are clean for both folders. NEITHER scene has been viewed in a browser.

## Gotchas
- Bake materials: the shared `bake_group` only reads mesh-data materials, so the plinths use `mat.assign`. With object-linked slots the bake comes out black.
- Instancing: the optimizer turns five or more identical meshes into one GPU-instanced node and drops their names. The garden export scales each copy by a tiny amount to keep them unique.
- Bubbles rail offset: its rail starts at s = -0.2 (offset 0.2) because the homepage fades it in before its chapter. The layer manifests are rewritten to real scene time after rendering.
- Bubbles uses the garden's `hi/studio.hdr` for reflections.
- Tone mapping: day uses Khronos PBR Neutral in Cycles and `neutral` at runtime. AgX made the pastels look grey.
- A 2048 px, 256-sample bake took about 25 minutes on the contended laptop GPU; on CPU use ~96-128 samples + denoise.
