# Doors + museum handoff (scenes `doors` and `museum`)

## Doors (`art/worlds/doors/`: `build.py`, `build.sh`, `arches.py`, `classic.py`, `robust.py`)
- Done: the `arches` step, a `rail`, and day and night previews at low sample counts; the look is good in both.
- Public assets (`public/worlds/doors/`): `hi/arches.glb` (4.6 MB, optimized), `hi/layout.json`, `hi/corridor-day.glb` (1.2 MB, from a low-res preview bake with older geometry).
- Stale: `rails.json` predates the last change to the camera keys; rerun the rail step.
- Still to run: `bake --variant both`, `rail`, `layers`, `pano`, `mini`, then everything after `blend ... arches,bake,rail` in `build.sh`. The full bake was killed partway, with no output.
- Runtime in `src/worlds/scenes/doors/`: `index.tsx`, `Corridor.tsx`, `Doors.tsx`, `CameraFx.tsx`, `Sky.tsx`, `Spill.tsx`, `portal.ts`, `layout.ts`, and `shared/` (floor, pano environment, dust, baked-material helpers, Low Resources glints). `tsc` and eslint were clean before a small later edit to `Dust.tsx` (recheck).
- NEVER VIEWED IN A BROWSER.

## Museum (`art/worlds/museum/`: `build.py`, `gallery.py`; runtime in `src/worlds/scenes/museum/`)
- Build script and runtime are written but have NEVER been run or type-checked. No assets at all yet: no `covers.json`, `hall-*.glb`, `gallery.glb`, `layout.json`, rail, layers, pano or mini. Until they exist the homepage reel chapter fails to load, so get a first complete asset set out early.
- No `build.sh` yet. Intended order: `blend museum --steps covers,gallery,bake,rail`, optimize `gallery.glb` and `hall-{day,night}.glb` into `hi/`, then `layers,pano,mini`.
- The owner's words for this chapter: "camera glides along the hall" of a marble museum showing the featured projects.

## Gotchas
- Rail offset: both rails run 0.15 ahead of scene time, covering s from -0.15 to 1.15. The runtime adds the offset back, and the `layers` step rewrites each manifest's `s` to scene time.
- `robust.py` patches `ddd.render.still` and the bake operator to retry a failed GPU render once, then fall back to CPU.
- Bakes at 2048 px and 200 samples are very slow; on CPU use `--samples 96`-`128` and denoise.
- Floors are baked as white irradiance-only lightmaps. The runtime floor shader draws the marble pattern and shows a mirrored copy of the scene (`scale y = -1`) through a Fresnel blend, so render order and the custom blending matter.
- Door portals sample other worlds' `pano-*.webp`. Cycles stills bake in whichever panos exist at render time, so render doors `layers` and `pano` last. At runtime the portals HEAD-check each pano and fall back to an animated palette gradient. Other worlds' panos are being produced on other branches right now: rely on the runtime fallback, and note in the report that doors layers should be re-rendered once all panos exist.
- The museum build adds `art/worlds/doors` to `sys.path` for `classic` and `robust`; its runtime imports from `scenes/doors/shared`.
- The museum appends Poly Haven models (`marble_bust_01`, `horse_head`, `gothic_statue`, 1k). Re-fetch them on the VM with `node art/fetch/polyhaven.mjs model <id> 1k`.
