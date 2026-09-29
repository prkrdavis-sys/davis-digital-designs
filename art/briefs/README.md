# Brief for building one 3D world on a cloud VM (read fully before starting)

You are building ONE scroll-driven HD 3D world for a portfolio site (Next.js 16 App Router + React Three Fiber v9 + three r186 + pmndrs `postprocessing`). The site owner asked for: "really cool HD 3D backgrounds, go crazy with the details, like the Figma UI advertisements; scrolling should really change the camera perspective or scenery in a smooth way; every page has detailed backgrounds; real stock images/CC0 assets only if needed; polished and amazing." Each page has its own world with its own style, a night variant (dark mode), and a designed Low Resources version.

This work started on the owner's laptop, which ran out of memory, so it moved to cloud VMs. A previous agent already did part of your world: read `art/briefs/<your world>.handoff.md` for exactly what exists, what is stale and what remains. Continue from that state; do not start over. Re-run any step whose inputs changed.

## Read first (in this order)
1. `art/briefs/<your world>.md` (the design spec) and `art/briefs/<your world>.handoff.md` (current status)
2. `art/README.md` (asset pipeline, conventions, output contract)
3. `src/worlds/README.md` (runtime scene contract, hooks, checklist)
4. The reference world, which is complete and working:
   - `art/worlds/dna/build.py`, `art/worlds/dna/dna_model.py`, `art/worlds/dna/build.sh`
   - `src/worlds/scenes/dna/index.tsx`, `Helix.tsx`, `Proteins.tsx`, `Medium.tsx`, `materials.ts`, `LoBokeh.tsx`
5. Engine: `src/components/three/engine/slot.tsx`, `rails.tsx`, `assets.ts`, `CoverPanel.tsx`, `compositor.ts`, `WorldDirector.tsx`, `timeline.ts`; `src/worlds/lo/LayerStack.tsx`; `art/lib/ddd/*.py`
6. `src/lib/worlds.ts` (your world's chapters and palette), the page that hosts your world (to see its `data-chapter` sections), `src/components/cursor/themes.tsx` (your scene's cursor theme, already built).
7. Read `node_modules/next/dist/docs/` only if you touch Next.js APIs (you shouldn't need to).

## Setup (once)
- `bash art/setup-cloud.sh` installs Blender 5.2.2 (to `~/.local/blender`), KTX-Software 4.4.2 (to `~/.local/ktx`), system libraries and `npm ci`, then prints the Cycles device it found.
- `art/.cache/` (downloads) and `art/out/` (intermediate renders) are gitignored and start EMPTY on your VM. The fetchers re-download what you need: `node art/fetch/polyhaven.mjs hdri|texture|model|search ...`, `node art/fetch/ambientcg.mjs <assetId> [2K]` / `search <term>`, `node art/fetch/geo.mjs dem|s2|osm ...`. If a build step expects a cached file, run the matching fetcher or the earlier build step first.
- macOS system fonts (`/System/Library/Fonts/...`) don't exist here. Use `public/worlds/everest/fonts/*.ttf` (Geist, OFL) or `/usr/share/fonts` (DejaVu, Liberation).

## Rendering on this VM
- Blender headless: `source art/env.sh && blend <scene> --steps a,b --variant day|night|both [--preview] [--samples N]`.
- `ddd.scene.use_gpu()` picks Metal, OptiX, CUDA, HIP or oneAPI if present, otherwise the CPU (`DDD_DEVICE=CPU` forces the CPU). Expect the CPU. Budget accordingly:
  - Look iterations: `--preview` (half res), 16-32 samples, OpenImageDenoise on.
  - Lightmap bakes: 1024-2048 px, 64-128 samples, then denoise. Keep one shared UV atlas per group.
  - Layers and posters: 1920x1200, 32-64 samples with denoise. Panoramas: 4096x2048, 32-64 samples.
- Long Blender runs: start them with the Shell tool in background mode and poll the log; don't block on them. Only one Blender process at a time; it can use all cores.
- Read your own Blender renders (PNG) with the Read tool to judge the look. Iterate on the look at least 2-3 times until it is genuinely beautiful and HD.

## Tools
- `node art/optimize.mjs in.glb out.glb [--tex mixed|webp|none] [--size 2048]` (meshopt + KTX2). `node art/images.mjs layers <scene>` (layers to webp + posters), `node art/images.mjs pano in.png out.webp`.
- Shared bpy helpers: `ddd.scene` (reset, cycles, view, world_color/hdri/sky, lights, camera), `ddd.mat` (principled, pbr, glass, chrome, clay, inflatable, emission, noise ramps), `ddd.geo` (primitives, tube, modifiers, apply_all, join, displace_noise, decimate), `ddd.inflate` (cloth-pressure inflatables), `ddd.bake` (bake_group: Cycles diffuse GI to an emissive atlas), `ddd.export.glb`, `ddd.rails` (key camera, export rails.json), `ddd.render` (still, layers, panorama).
- Web search: the `WebSearch` / `WebFetch` tools, for references and accurate data.

## Checking the site in a browser
- Start your own dev server: `npx next dev -p 3456` in the background (it hot-reloads).
- Use the browser available to you (the desktop / computer-use browser if you have one). If none is available, take screenshots with headless Chromium via `npx -y playwright@1 screenshot` or a tiny `npx -y playwright@1` script with `--use-angle=swiftshader --enable-unsafe-swiftshader` (don't add Playwright to package.json). A software-rendered frame is slow, so wait longer for it.
- Page hooks: `window.__ddd.scrollToT(t)` jumps to chapter time t (wait ~2.5 s for damping). `window.__ddd.engine` and `window.__ddd.slots.get('<scene>')` expose engine state.
- Dark mode: `localStorage.setItem('ddd:theme','dark'); location.reload()` (use `'light'` to restore). Low Resources: `localStorage.setItem('ddd:low-power','true'); location.reload()` (remove the key after).
- Save 4-8 of your best screenshots as JPEG (quality ~80, max 1600 px wide) to `art/briefs/shots/<scene>/`, named `<chapter>-<day|night|lo>.jpg`. The owner reviews them there.

## File ownership (strict)
You may create/modify ONLY:
- `art/worlds/<your scene>/**`
- `src/worlds/scenes/<your scene>/**`
- `public/worlds/<your scene>/**`
- `art/briefs/shots/<your scene>/**` and `art/briefs/<your world>.handoff.md` (update the handoff as you go, so another agent could resume)

Anything else (engine, store, `src/lib/worlds.ts`, cursor themes, layout, pages, package.json, `art/lib`, `art/optimize.mjs`, `art/images.mjs`) is shared: do NOT edit it. If you need a shared change, put the exact proposed diff in your final report and work around it locally meanwhile (e.g. copy a helper into your own folder). No new npm dependencies. Other agents are building the other worlds in parallel on their own branches, so any shared edit would conflict.

## Git
- Work on the branch you were given. Commit early and often (after each finished step), with clear messages, and push, so progress survives if the VM stops.
- Never commit `art/.cache/` or `art/out/` (gitignored), `.blend` files, or anything larger than 25 MB. Keep the hi payload of your world ideally at or under 12 MB.

## What to deliver
1. Reproducible Blender build: `art/worlds/<scene>/build.py` (steps) + `build.sh` (fetch, blend, optimize, images). Outputs per the contract: `public/worlds/<scene>/hi/*.glb` (plus textures and data), `rails.json`, `layers/` + `posters/` (day AND night, one tag per interesting rail position, at least one per chapter), `pano-day.webp` + `pano-night.webp` (4096x2048 equirect from a signature viewpoint), `lo/mini.glb` (a small hero miniature for the homepage diorama, ~2-8k tris, nice materials, sitting on its base at the origin, ~1 unit tall).
2. Scene module `src/worlds/scenes/<scene>/index.tsx` (+ files): hi (real-time, detailed, lit well, `useLook` + `usePostFX` tuned), lo (`LayerStack` + a few cheap live particles), parked mode (a calm camera via `RailCamera remap`, plus `<CoverPanel/>` placed beautifully in the world), `preload()`. Day and night variants.
3. The rail `s` range must cover every chapter of your page (chapter k spans s in [k, k+1)) plus ~0.2 margin at the end. Camera moves should be cinematic and change a lot with scroll (orbit, dolly, crane, reveal), smooth, with the subject framed right of centre so the page's left text column stays readable.
4. Quality bar: HD. Real materials (PBR, clearcoat, transmission, sheen), baked GI where static (`bake.bake_group`), good lighting, atmosphere (fog, particles, light shafts), depth of field or bloom where it helps. Details everywhere. It should look like a polished motion-design ad frame in every chapter, day and night.
5. Priorities if time runs short, in order: (a) every asset the runtime loads exists, so the scene never fails to load; (b) the hi scene renders correctly in the browser in every chapter, day and night; (c) Low Resources layers and posters; (d) pano and mini; (e) look polish.
6. Verify: `npx tsc --noEmit` and `npx eslint src/worlds/scenes/<scene>` are clean, and `npx next build` succeeds. Screenshot every chapter in day and night (hi), plus one lo screenshot.
7. Final report (your last message): what you built (short), chapter-by-chapter description, asset sizes (`du -sh public/worlds/<scene>/*`), the screenshot paths, any proposed shared diffs, known issues, and the final commit hash on your branch.
