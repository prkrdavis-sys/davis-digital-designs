# Paper planes handoff (scene `planes`)

## Done
- Build steps `print` (paper designs), `plane`, `mini`, `rail`, plus the optimized files in `public/`.
- `atlas` is PARTIAL: 7 of 12 clouds had their light passes cached as EXRs in `art/out/planes/` on the laptop. That cache is NOT on the VM, so the atlas must be rendered from scratch (keep samples modest on CPU).
- Blender scripts in `art/worlds/planes/`: `build.py`, `pl_common.py` (sky, palette), `pl_clouds.py` (volumetric clouds), `pl_atlas.py` (cloud atlas), `pl_paper.py` (plane mesh and paper), `pl_flock.py` (formation and rail). Converters: `build.sh`, `atlas.mjs`.
- Public assets: `rails.json`, `hi/plane.glb`, `hi/paper.webp`, `hi/paper-normal.webp`, `lo/mini.glb` (2.1 MB; re-optimize with `--size 512`).
- Runtime in `src/worlds/scenes/planes/`: `index.tsx` (hi, lo, parked), sky, clouds, wisps, flock, flock sim (`sim.ts`), paper material, god rays, Low Resources overlay, the `launch.ts` event bus, and `world.json` (shared by Blender and the runtime). `tsc` passes.

## Not done
- Render `atlas`, convert with `node art/worlds/planes/atlas.mjs`, then `layers`, `pano`, `node art/images.mjs layers planes` plus the pano webps (all in `build.sh`).
- In `index.tsx` the clouds are disabled with `{false && <Clouds …/>}`. Restore that once `hi/clouds.webp` and `hi/clouds.json` exist.
- NEVER VIEWED IN A BROWSER. Tune the cloud relight colours and the flock's bank direction. Run eslint.
- The one allowed edit to `src/components/contact/ContactForm.tsx`: call `launchPlane()` (imported from `@/worlds/scenes/planes/launch`) in the existing effect when `state.status` is `"sent"` or `"fallback"`. This is the ONLY file outside your folders you may touch.
- Screenshots and the final report.

## Gotchas
- A 960x600 frame at 16 samples took ~90 s on the laptop CPU fallback; volumetric clouds are expensive, so keep cloud sprites small and samples low, and denoise.
- `flock.ts` clashed with `Flock.tsx` on a case-insensitive filesystem, so the sim module is `sim.ts`. Keep it that way (the owner's Mac is case-insensitive).
- The cloud atlas stores lighting passes (left light, right light, ambient, coverage) as square roots scaled by `vmax`, not colours. It must stay lossless WebP and load as an ImageBitmap with no premultiplication or colour conversion.
- The paper texture uses `flipY = false` to match the glTF UVs.
