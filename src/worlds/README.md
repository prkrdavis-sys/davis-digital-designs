# Worlds (runtime)

Every page has a **world** (`src/lib/worlds.ts`): a palette, a list of scroll chapters, and the **scene** each chapter plays. Scenes are the renderable 3D units in `src/worlds/scenes/<scene>/`. The engine (`src/components/three/engine/`) mounts scenes, drives their cameras from scroll, and composites them.

The DNA world (`scenes/dna/`, `art/worlds/dna/`) is the reference implementation of everything below.

## Scene module contract

`src/worlds/scenes/<scene>/index.tsx` default-exports a component receiving `{ variant: "day" | "night", quality: "hi" | "lo", mode: "tour" | "parked" }` and may export `preload()`.

- **hi**: the real-time scene. **lo**: the Low Resources scene, normally `<LayerStack scene="<scene>" variant={variant}>` plus a few cheap live particles.
- **tour**: follow the scroll rail. **parked**: project pages; hold a calm view (`RailCamera remap`) and show `<CoverPanel />` (the project cover) somewhere lovely.
- Render inside your own portal scene: plain R3F children. `useThree().camera` is your scene's camera.

## Hooks (from `engine/slot.tsx`)

| Hook | Use |
| --- | --- |
| `useSceneTime()` | Mutable `{ s, velocity, weight, visible }`. `s` is scene-local chapter time (0 = start of this scene's first chapter). Read in `useFrame`. |
| `useLook({ exposure, tone, seam, grain, vignette })` | Compositor settings. `tone`: `"agx" | "aces" | "neutral" | "none"` (`none` for pre-tone-mapped Cycles layers). |
| `usePostFX(({ camera, scene }) => Effect[], deps)` | pmndrs `postprocessing` effects, run in HDR before tone mapping. |

## Cameras, assets

- `useRail("/worlds/<scene>/rails.json")` + `<RailCamera rail={...} />`: Blender-authored camera path sampled at `s`, with pointer parallax. `remap` lets parked views hold still.
- `useWorldGLTF(scene, file, quality)`: meshopt + KTX2 GLBs from `public/worlds/<scene>/<quality>/`. Positions are **quantized**: use `<primitive object={gltf.scene} />` (keeps node transforms) or `firstMeshGeometry()` / `bakedGeometry()` when you need raw geometry.
- `useColorTextures([...])` for plain images (covers, sprites).
- Dynamic near/far: if your scale changes a lot along the rail, adjust `camera.near/far` per frame (see `dna/index.tsx` `DepthRange`).

## Low Resources layers

`art/lib/ddd/render.py` `layers()` renders RGBA depth bands from rail positions; `art/images.mjs layers <scene>` writes `public/worlds/<scene>/layers/*.webp`, per-tag manifests, and `posters/`. `LayerStack` stacks them on planes at their real depths and flies through them. Tags are `<day|night>-s<NNN>` where NNN is `s * 100`.

## Cursor, audio, extras

- Cursor themes live in `src/components/cursor/themes.tsx`, keyed by scene id.
- Scenes can publish values for their cursor through `cursorBridge` (`components/cursor/core.ts`).
- Every world also provides, for the homepage:
  - `public/worlds/<scene>/pano-day.webp` and `pano-night.webp`: 4096x2048 equirect from a signature viewpoint, used by the doors corridor.
  - `public/worlds/<scene>/lo/mini.glb`: a small hero miniature, used by the diorama.

## Checklist for a new world

1. Blender build (`art/worlds/<scene>/build.py` + `build.sh`): meshes/bakes -> GLBs, `rails.json`, layers (day + night), pano, mini.
2. `scenes/<scene>/index.tsx`: hi + lo + parked, `useLook`, `usePostFX`, `preload`.
3. Chapter ids in `src/lib/worlds.ts` match the page's `data-chapter` sections; the rail's `s` range covers them (+0.2 margin).
4. Readable text: keep the subject off the left text column (aim the camera so the subject sits right of centre).
5. `npx tsc --noEmit`, `npm run lint`, then screenshots at each chapter in day and night, hi and lo.
