# Snow globe handoff (scene `snowglobe`)

## Done
- Build scripts in `art/worlds/snowglobe/`: `build.py`, `sg_model.py` (layout, camera path, glow table), `sg_parts.py` (all geometry and materials), `build.sh`, `lightmaps.mjs` (lightmap PNG to webp), `optimize-lm.mjs`.
- Camera path done: `rails.json` and `hi/snowglobe.json` generated.
- Lighting bake and model export ran only at PREVIEW quality (512 px, 48 samples).
- Blender stills look good at preview quality, day only: the desk and globe, the path through the glass, the village inside.
- Runtime in `src/worlds/scenes/snowglobe/`: hi, lo (layers plus falling snow) and parked mode (the project cover replaces the big billboard). `tsc` and eslint are clean.

## Public assets right now (preview quality, incomplete)
- `desk.glb` (6.5 MB) and `village.glb` (5 MB) from an older export, `env-day.hdr`, `bg-day.hdr`, `sparkle.bin`, 7 of 8 lightmap webps. `lm-village-night.webp` and both night HDRs are missing. The hi payload (19 MB now) must come down toward 12 MB.

## Not done, in order
1. `blend snowglobe --steps bake` at full quality (on CPU: ~1024-2048 px, 96-128 samples + denoise).
2. `lightmaps.mjs`, then `optimize-lm.mjs` on both models (with `--tex mixed`), then `--steps env --variant both`.
3. `layers`, then `node art/images.mjs layers snowglobe`, then `pano,mini` (all in `build.sh`).
4. NEVER VIEWED IN A BROWSER. Check day, night, hi and lo; tune.
5. Screenshots and the report.

## Gotchas
- Lightmaps sit on a second UV set, which the shared `art/optimize.mjs` strips. Use `optimize-lm.mjs` for `desk.glb` and `village.glb`.
- The runtime loads lightmaps as `hi/lm-<group>-<variant>.webp` with the scale from `snowglobe.json`, and patches the material shader so the environment map doesn't add a second layer of diffuse light.
- `gpu_retry` redoes a render on the CPU after a GPU out-of-memory error.
- The full layers step is 28 stills; keep samples modest on CPU.
- The glass pass-through effect must stay FIRST in the post-processing list (it distorts UVs, and the library rejects that once a convolution effect like DOF is already in the chain).
- `build.py` uses fonts from `/System/Library/Fonts/Supplemental`, which don't exist on Linux: switch to `public/worlds/everest/fonts/*.ttf` or `/usr/share/fonts` so text meshes don't silently fall back to Blender's default font.
- Only two Create project covers exist, so the screens reuse them.
